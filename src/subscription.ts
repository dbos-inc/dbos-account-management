import { IncomingHttpHeaders } from 'http';
import Stripe from 'stripe';
import { DBOS } from '@dbos-inc/dbos-sdk';
import axios from 'axios';
import { KnexDataSource } from '@dbos-inc/knex-datasource';
import Fastify from 'fastify';
import rawBodyPlugin from 'fastify-raw-body';
import { fastifyJwtJwks } from 'fastify-jwt-jwks';
import cors from '@fastify/cors';

const DBOSDomain = process.env.APP_DBOS_DOMAIN;
const DBOSProStripePrice = process.env.STRIPE_DBOS_PRO_PRICE ?? '';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
export const dataSource = new KnexDataSource('knex-ds', { client: 'pg', connection: process.env.DBOS_DATABASE_URL });

export const DBOSLoginDomain = DBOSDomain === 'cloud.dbos.dev' ? 'login.dbos.dev' : 'dbos-inc.us.auth0.com';

const DBOSPlans = {
  free: 'free',
  pro: 'pro',
};

// Register all DBOS workflows and steps
export const stripeEventWorkflow = DBOS.registerWorkflow(stripeEventWorkflowImpl, { name: 'stripeEventWorkflow' });
export const createSubscription = DBOS.registerWorkflow(createSubscriptionImpl, { name: 'createSubscription' });
export const createStripeCustomerPortal = DBOS.registerWorkflow(createStripeCustomerPortalImpl, {
  name: 'createStripeCustomerPortal',
});

const updateCloudEntitlement = DBOS.registerStep(updateCloudEntitlementImpl, {
  name: 'updateCloudEntitlement',
  intervalSeconds: 10,
  maxAttempts: 20,
  backoffRate: 1.2,
  retriesAllowed: true,
});

export const findStripeCustomerID = dataSource.registerTransaction(findStripeCustomerIDImpl, {
  name: 'findStripeCustomerID',
  readOnly: true,
});
export const recordStripeCustomer = dataSource.registerTransaction(recordStripeCustomerImpl, {
  name: 'recordStripeCustomer',
  readOnly: false,
});
export const findAuth0UserID = dataSource.registerTransaction(findAuth0UserIDImpl, {
  name: 'findAuth0UserID',
  readOnly: true,
});

// Workflow to process Stripe events sent to the webhook endpoint
async function stripeEventWorkflowImpl(subscriptionID: string, customerID: string) {
  // Retrieve the updated subscription from Stripe
  const status = await DBOS.runStep(() => getSubscriptionStatus(subscriptionID), {
    name: 'getSubscriptionStatus',
    retriesAllowed: true,
    maxAttempts: 5,
  });

  // Map the Stripe customer ID to DBOS Cloud user ID
  const dbosAuthID = await findAuth0UserID(customerID);

  // Send a request to the DBOS Cloud admin API to change the user's subscription status
  switch (status) {
    case 'active':
    case 'trialing':
      await updateCloudEntitlement(dbosAuthID, DBOSPlans.pro);
      break;
    case 'canceled':
    case 'unpaid':
    case 'paused':
      await updateCloudEntitlement(dbosAuthID, DBOSPlans.free);
      break;
    default:
      DBOS.logger.info(`Do nothing for ${status} status.`);
  }
}

// Retrieve the status of a subscription from Stripe
async function getSubscriptionStatus(subscriptionID: string): Promise<Stripe.Subscription.Status> {
  const subscription = await stripe.subscriptions.retrieve(subscriptionID);
  if (subscription.items.data[0].price.id !== DBOSProStripePrice) {
    throw new Error(
      `Unknown price: ${subscription.items.data[0].price.id}; customer ${subscription.customer as string}; subscription ${subscriptionID}`,
    );
  }
  DBOS.logger.info(
    `Subscription ${subscriptionID} is ${subscription.status} for customer ${subscription.customer as string}`,
  );
  return subscription.status;
}

// Find the Auth0 user ID corresponding to a Stripe customer ID
async function findAuth0UserIDImpl(stripeCustomerID: string): Promise<string> {
  const res = await dataSource
    .client<Accounts>('accounts')
    .select('auth0_subject_id')
    .where('stripe_customer_id', stripeCustomerID)
    .first();
  if (!res) {
    throw new Error(`Cannot find auth0 user for stripe customer ${stripeCustomerID}`);
  }
  return res.auth0_subject_id;
}

// Update a user's subscription status in DBOS Cloud
async function updateCloudEntitlementImpl(dbosAuthID: string, plan: string) {
  let token = Utils.dbosAuth0Token;
  const ts = Date.now();
  // Fetch an access token from Auth0 if the current token is not present or expired
  if (!token || ts - Utils.lastTokenFetch > 43200000) {
    DBOS.logger.info('Retrieving access token from Auth0');
    token = await Utils.retrieveAccessToken();
    Utils.lastTokenFetch = ts;
  }

  // Send an authenticated request to the DBOS Cloud admin API to update the user's subscription status
  const entitlementRequest = {
    method: 'POST',
    url: `https://${DBOSDomain}/admin/v1alpha1/users/update-sub`,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data: {
      subject_id: dbosAuthID,
      subscription_plan: plan,
    },
  };
  const response = await axios.request(entitlementRequest);
  DBOS.logger.info(`Update entitlement for ${dbosAuthID} to plan ${plan}, response: ${response.status}`);

  // Send a slack notification
  if (process.env.ZAZU_SLACK_TOKEN && dbosAuthID !== process.env.DBOS_TEST_USER) {
    let title = 'User subscribed to DBOS Pro :partying_face:';
    if (plan === DBOSPlans.free) {
      title = 'User canceled DBOS Pro :sadge:';
    }
    const slackRequest = {
      method: 'POST',
      url: 'https://slack.com/api/chat.postMessage',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.ZAZU_SLACK_TOKEN}`,
      },
      data: {
        channel: process.env.ZAZU_SLACK_CHANNEL,
        text: title,
        attachments: [
          { text: `User ${dbosAuthID} is using ${plan} tier. DBOS Cloud response status: ${response.status}` },
        ],
      },
    };
    const res = await axios.request(slackRequest);
    DBOS.logger.info(`Sent slack notification, response: ${res.status}`);
  }
}

// Workflow to create a Stripe checkout session
async function createSubscriptionImpl(
  auth0UserID: string,
  userEmail: string,
  successUrl: string,
  cancelUrl: string,
): Promise<string | null> {
  // First, look up the customer from the accounts table
  let stripeCustomerID = await findStripeCustomerID(auth0UserID);

  // If customer is not found, create a new customer in stripe, and record in our database
  if (!stripeCustomerID) {
    stripeCustomerID = await DBOS.runStep(() => createStripeCustomer(auth0UserID, userEmail), {
      name: 'createStripeCustomer',
      retriesAllowed: true,
      maxAttempts: 3,
      intervalSeconds: 10,
    });
    await recordStripeCustomer(auth0UserID, stripeCustomerID!, userEmail);
  }

  // Finally, create a Stripe checkout session.
  const res = await DBOS.runStep(() => createStripeCheckout(stripeCustomerID, successUrl, cancelUrl), {
    name: 'createStripeCheckout',
    retriesAllowed: true,
    maxAttempts: 3,
    intervalSeconds: 10,
  });
  return res;
}

// Find the Stripe customer ID corresponding to an Auth0 user ID
async function findStripeCustomerIDImpl(auth0UserID: string): Promise<string | undefined> {
  const res = await dataSource
    .client<Accounts>('accounts')
    .select('stripe_customer_id')
    .where('auth0_subject_id', auth0UserID)
    .first();
  return res === undefined ? undefined : res.stripe_customer_id;
}

// Create a customer in Stripe for an authenticated user
async function createStripeCustomer(auth0UserID: string, userEmail: string): Promise<string> {
  const customer = await stripe.customers.create({
    email: userEmail,
    description: 'Automatically generated by DBOS',
    metadata: {
      auth0_user_id: auth0UserID,
    },
  });
  DBOS.logger.info(`Created stripe customer ${customer.id} for user ${auth0UserID}`);
  return customer.id;
}

// Insert a mapping between a customer's Auth0 user ID and Stripe customer ID
async function recordStripeCustomerImpl(auth0UserID: string, stripeCustomerID: string, email: string): Promise<void> {
  const res = await dataSource
    .client<Accounts>('accounts')
    .insert<{ rowCount: number }>({
      auth0_subject_id: auth0UserID,
      stripe_customer_id: stripeCustomerID,
      email: email,
    })
    .onConflict('auth0_subject_id')
    .ignore();
  if (res.rowCount !== 1) {
    throw new Error(`Failed to record stripe customer ${stripeCustomerID} for user ${auth0UserID}`);
  }
}

// Create a Stripe checkout session for a customer
async function createStripeCheckout(
  stripeCustomerID: string,
  successUrl: string,
  cancelUrl: string,
): Promise<string | null> {
  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerID,
    billing_address_collection: 'auto',
    line_items: [
      {
        price: DBOSProStripePrice,
        quantity: 1,
      },
    ],
    mode: 'subscription',
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: true,
  });
  return session.url;
}

// Workflow to create a Stripe customer portal
async function createStripeCustomerPortalImpl(auth0UserID: string, returnUrl: string): Promise<string | null> {
  const stripeCustomerID = await findStripeCustomerID(auth0UserID);
  if (!stripeCustomerID) {
    DBOS.logger.error(`Cannot find stripe customer for user ${auth0UserID}`);
    return null;
  }
  const sessionURL = await DBOS.runStep(() => createStripeBillingPortal(stripeCustomerID, returnUrl), {
    name: 'createStripeBillingPortal',
    retriesAllowed: true,
    maxAttempts: 3,
    intervalSeconds: 10,
  });
  return sessionURL;
}

// Create a Stripe billing portal for a customer
async function createStripeBillingPortal(customerID: string, returnUrl: string): Promise<string | null> {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerID,
    return_url: returnUrl,
  });
  return session.url;
}

interface Accounts {
  auth0_subject_id: string;
  email: string;
  stripe_customer_id: string;
  created_at: number;
  updated_at: number;
}

interface RefreshTokenAuthResponse {
  access_token: string;
  scope: string;
  expires_in: number;
  token_type: string;
}

interface Auth0User {
  'https://dbos.dev/email': string;
  sub: string;
}

export class Utils {
  static dbosAuth0Token: string | undefined;
  static lastTokenFetch = 0;

  // Utility function verifying that a webhook event originated from Stripe
  static verifyStripeEvent(payload?: string | Buffer, reqHeaders?: IncomingHttpHeaders) {
    if (payload === undefined || reqHeaders === undefined) {
      throw new Error('Invalid stripe request, no request headers or payload');
    }
    const sigHeader = reqHeaders['stripe-signature'];
    if (typeof sigHeader !== 'string') {
      throw new Error('Invalid stripe request, no stripe-signature header');
    }
    const StripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? '';

    const event = stripe.webhooks.constructEvent(payload, sigHeader, StripeWebhookSecret);
    return event;
  }

  // Check if the request user is authenticated and has a valid Auth0 user ID
  static authorizeUser(requestUser?: Auth0User) {
    if (!requestUser) {
      throw new Error('No authenticated DBOS User!');
    }
    const authenticatedUser = requestUser.sub;
    if (!authenticatedUser) {
      throw new Error('No valid DBOS user found!');
    }
    const userEmail = requestUser['https://dbos.dev/email'];
    if (!userEmail) {
      throw new Error('No email found for the authenticated user');
    }
    DBOS.logger.info(`Authenticated user: ${authenticatedUser}, email: ${userEmail}`);
  }

  // Securely retrieve an access token from Auth0 authorizing this app to use the DBOS Cloud admin API
  static async retrieveAccessToken(): Promise<string> {
    const refreshToken = process.env.DBOS_LOGIN_REFRESH_TOKEN;
    if (!refreshToken) {
      throw new Error('No refresh token found');
    }
    const DBOSAuth0ClientID =
      DBOSDomain === 'cloud.dbos.dev' ? '6p7Sjxf13cyLMkdwn14MxlH7JdhILled' : 'G38fLmVErczEo9ioCFjVIHea6yd0qMZu';
    const loginRequest = {
      method: 'POST',
      url: `https://${DBOSLoginDomain}/oauth/token`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      data: {
        grant_type: 'refresh_token',
        client_id: DBOSAuth0ClientID,
        refresh_token: refreshToken,
      },
    };
    try {
      Utils.dbosAuth0Token = undefined;
      const response = await axios.request(loginRequest);
      const tokenResponse = response.data as RefreshTokenAuthResponse;
      Utils.dbosAuth0Token = tokenResponse.access_token;
      return tokenResponse.access_token;
    } catch (err) {
      Utils.dbosAuth0Token = undefined;
      throw err;
    }
  }
}

export async function buildEndpoints() {
  const fastify = Fastify({ logger: true });

  // Enable CORS
  await fastify.register(cors, {
    origin: ['https://dbos.webflow.io', /\.?dbos\.dev$/, /^http:\/\/localhost:\d+$/],
    methods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'PATCH', 'OPTIONS'],
    credentials: true,
  });

  // Register raw body plugin before route registration
  await fastify.register(rawBodyPlugin, {
    field: 'rawBody',
    global: false,
    runFirst: true,
  });

  // Register the JWT plugin for authentication
  await fastify.register(fastifyJwtJwks, {
    jwksUrl: `https://${DBOSLoginDomain}/.well-known/jwks.json`,
    audience: 'dbos-cloud-api',
  });

  // Stripe webhook endpoint
  fastify.post(
    '/stripe_webhook',
    {
      config: {
        rawBody: true,
      },
    },
    async function (request, reply) {
      // Verify the request is actually from Stripe
      let event: Stripe.Event;
      try {
        event = Utils.verifyStripeEvent(request.rawBody, request.headers);
      } catch (error) {
        fastify.log.error(error);
        return reply.code(400).send('Invalid Stripe signature');
      }

      switch (event.type) {
        // Handle events when a user subscribes, cancels, or updates their subscription
        case 'customer.subscription.created':
        case 'customer.subscription.deleted':
        case 'customer.subscription.updated': {
          const subscription = event.data.object as Stripe.Subscription;
          // Start the workflow with event.id as the idempotency key without waiting for it to finish
          await DBOS.startWorkflow(stripeEventWorkflow, { workflowID: event.id })(
            subscription.id,
            subscription.customer as string,
          );
          break;
        }
        // Handle the event when a user completes payment for a subscription
        case 'checkout.session.completed': {
          const checkout = event.data.object as Stripe.Checkout.Session;
          if (checkout.mode === 'subscription') {
            await DBOS.startWorkflow(stripeEventWorkflow, { workflowID: event.id })(
              checkout.subscription as string,
              checkout.customer as string,
            );
          }
          break;
        }
        default:
          DBOS.logger.info(`Unhandled event type ${event.type}`);
      }
      return reply.code(200).send({ received: true });
    },
  );

  // Retrieve a Stripe checkout session URL for an authenticated customer
  fastify.post(
    '/subscribe',
    {
      preValidation: fastify.authenticate,
      schema: {
        body: {
          type: 'object',
          properties: {
            success_url: { type: 'string', format: 'uri' },
            cancel_url: { type: 'string', format: 'uri' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              url: { type: 'string', format: 'uri' },
            },
          },
        },
      },
    },
    async function (request, reply) {
      const auth0User = request.user as Auth0User;
      try {
        Utils.authorizeUser(auth0User);
      } catch (error) {
        fastify.log.error(error);
        return reply.code(403).send('Forbidden: User not authorized');
      }

      const { success_url, cancel_url } = request.body as { success_url: string; cancel_url: string };
      const successUrl = success_url ?? 'https://console.dbos.dev';
      const cancelUrl = cancel_url ?? 'https://www.dbos.dev/pricing';
      const sessionURL = await createSubscription(
        auth0User.sub,
        auth0User['https://dbos.dev/email'],
        successUrl,
        cancelUrl,
      );
      if (!sessionURL) {
        return reply.code(500).send('Failed to create subscription session');
      }

      return reply.code(200).send({ url: sessionURL });
    },
  );

  // Retrieve a Stripe customer portal session URL for an authenticated user
  fastify.post(
    '/create-customer-portal',
    {
      preValidation: fastify.authenticate,
      schema: {
        body: {
          type: 'object',
          properties: {
            return_url: { type: 'string', format: 'uri' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              url: { type: 'string', format: 'uri' },
            },
          },
        },
      },
    },
    async function (request, reply) {
      const auth0User = request.user as Auth0User;
      try {
        Utils.authorizeUser(auth0User);
      } catch (error) {
        fastify.log.error(error);
        return reply.code(403).send('Forbidden: User not authorized');
      }

      const { return_url } = request.body as { return_url: string };
      const returnUrl = return_url ?? 'https://www.dbos.dev/pricing';
      const sessionURL = await createStripeCustomerPortal(auth0User.sub, returnUrl);

      return reply.code(200).send({ url: sessionURL });
    },
  );

  return fastify;
}
