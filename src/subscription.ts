import { Communicator, CommunicatorContext, DBOSResponseError, MiddlewareContext, Transaction, TransactionContext, Workflow, WorkflowContext } from "@dbos-inc/dbos-sdk";
import { koaJwtSecret } from "jwks-rsa";
import { IncomingHttpHeaders } from "http";
import jwt from "koa-jwt";
import Stripe from "stripe";
import { Knex } from 'knex';
import axios from 'axios';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

const DBOSDomain = process.env.APP_DBOS_DOMAIN;
const DBOSLoginDomain = DBOSDomain === "cloud.dbos.dev" ? "login.dbos.dev" : "dbos-inc.us.auth0.com";
const DBOSProStripePrice = process.env.STRIPE_DBOS_PRO_PRICE ?? "";
const DBOSPlans = {
  free: 'free',
  pro: 'pro',
};

export class Utils {
  // Workflow to process Stripe events sent to the webhook endpoint
  @Workflow()
  static async stripeEventWorkflow(ctxt: WorkflowContext, subscriptionID: string, customerID: string) {
    // Retrieve the updated subscription from Stripe
    const status = await ctxt.invoke(Utils).getSubscriptionStatus(subscriptionID);

    // Map the Stripe customer ID to DBOS Cloud user ID
    const dbosAuthID = await ctxt.invoke(Utils).findAuth0UserID(customerID);

    // Send a request to the DBOS Cloud admin API to change the user's subscription status
    switch (status) {
      case 'active':
      case 'trialing':
        await ctxt.invoke(Utils).updateCloudEntitlement(dbosAuthID, DBOSPlans.pro);
        break;
      case 'canceled':
      case 'unpaid':
      case 'paused':
        await ctxt.invoke(Utils).updateCloudEntitlement(dbosAuthID, DBOSPlans.free);
        break;
      default:
        ctxt.logger.info(`Do nothing for ${status} status.`);
    }
  }

  // Workflow to create a Stripe checkout session
  @Workflow()
  static async createSubscription(ctxt: WorkflowContext, auth0UserID: string, userEmail: string): Promise<string|null> {
    // First, look up the customer from the accounts table
    let stripeCustomerID = await ctxt.invoke(Utils).findStripeCustomerID(auth0UserID);

    // If customer is not found, create a new customer in stripe, and record in our database
    if (!stripeCustomerID) {
      stripeCustomerID = await ctxt.invoke(Utils).createStripeCustomer(auth0UserID, userEmail);
      await ctxt.invoke(Utils).recordStripeCustomer(auth0UserID, stripeCustomerID, userEmail);
    }

    // Finally, create a Stripe checkout session.
    const res = await ctxt.invoke(Utils).createStripeCheckout(stripeCustomerID);
    return res;
  }

  // Workflow to create a Stripe customer portal
  @Workflow()
  static async createStripeCustomerPortal(ctxt: WorkflowContext, auth0UserID: string, returnUrl: string): Promise<string|null> {
    const stripeCustomerID = await ctxt.invoke(Utils).findStripeCustomerID(auth0UserID);
    if (!stripeCustomerID) {
      ctxt.logger.error(`Cannot find stripe customer for user ${auth0UserID}`);
      return null;
    }
    const sessionURL = await ctxt.invoke(Utils).createStripeBillingPortal(stripeCustomerID, returnUrl);
    return sessionURL;
  }


  // Find the Stripe customer ID corresponding to an Auth0 user ID
  @Transaction({readOnly: true})
  static async findStripeCustomerID(ctxt: TransactionContext<Knex>, auth0UserID: string): Promise<string|undefined> {
    const client = ctxt.client;
    const res = await client<Accounts>("accounts")
      .select("stripe_customer_id")
      .where("auth0_subject_id", auth0UserID).first();
    return res === undefined ? undefined : res.stripe_customer_id;
  }

  // Find the Auth0 user ID corresponding to a Stripe customer ID
  @Transaction({readOnly: true})
  static async findAuth0UserID(ctxt: TransactionContext<Knex>, stripeCustomerID: string): Promise<string> {
    const client = ctxt.client;
    const res = await client<Accounts>("accounts")
      .select("auth0_subject_id")
      .where("stripe_customer_id", stripeCustomerID).first();
    if (!res) {
      throw new Error(`Cannot find auth0 user for stripe customer ${stripeCustomerID}`);
    }
    return res.auth0_subject_id;
  }

  // Insert a mapping between a customer's Auth0 user ID and Stripe customer ID
  @Transaction()
  static async recordStripeCustomer(ctxt: TransactionContext<Knex>, auth0UserID: string, stripeCustomerID: string, email: string): Promise<void> {
    const client = ctxt.client;
    const res = await client<Accounts>("accounts")
      .insert<{ rowCount: number }>({
        auth0_subject_id: auth0UserID,
        stripe_customer_id: stripeCustomerID,
        email: email,
      }).onConflict("auth0_subject_id").ignore();
    if (res.rowCount !== 1) {
      throw new Error(`Failed to record stripe customer ${stripeCustomerID} for user ${auth0UserID}`);
    }
  }


  // Create a Stripe billing portal for a customer
  @Communicator({intervalSeconds: 10, maxAttempts: 2})
  static async createStripeBillingPortal(_ctxt: CommunicatorContext, customerID: string, returnUrl: string): Promise<string|null> {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerID,
      return_url: returnUrl,
    });
    return session.url;
  }

  // Create a Stripe checkout session for a customer
  @Communicator({intervalSeconds: 10, maxAttempts: 2})
  static async createStripeCheckout(_ctxt: CommunicatorContext, stripeCustomerID: string): Promise<string|null> {
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
      success_url: `https://docs.dbos.dev`,
      cancel_url: `https://www.dbos.dev/pricing`,
      allow_promotion_codes: true,
    });
    return session.url;
  }

  // Create a customer in Stripe for an authenticated user
  @Communicator({intervalSeconds: 10, maxAttempts: 2})
  static async createStripeCustomer(ctxt: CommunicatorContext, auth0UserID: string, userEmail: string): Promise<string> {
    const customer = await stripe.customers.create({
      email: userEmail,
      description: "Automatically generated by DBOS",
      metadata: {
        auth0_user_id: auth0UserID,
      },
    });
    ctxt.logger.info(`Created stripe customer ${customer.id} for user ${auth0UserID}`);
    return customer.id;
  }

  // Retrieve the status of a subscription from Stripe
  @Communicator()
  static async getSubscriptionStatus(ctxt: CommunicatorContext, subscriptionID: string): Promise<Stripe.Subscription.Status> {
    const subscription = await stripe.subscriptions.retrieve(subscriptionID);
    if (subscription.items.data[0].price.id !== DBOSProStripePrice) {
      throw new Error(`Unknown price: ${subscription.items.data[0].price.id}; customer ${subscription.customer as string}; subscription ${subscriptionID}`);
    }
    ctxt.logger.info(`Subscription ${subscriptionID} is ${subscription.status} for customer ${subscription.customer as string}`);
    return subscription.status;
  }

  // Utility function verifying that a webhook event originated from Stripe
  static verifyStripeEvent(payload?: string, reqHeaders?: IncomingHttpHeaders) {
    if (!payload || !reqHeaders) {
      throw new DBOSResponseError("Invalid stripe request, no request headers or payload", 400);
    }
    const sigHeader = reqHeaders['stripe-signature'];
    if (typeof sigHeader !== 'string') {
      throw new DBOSResponseError("Invalid stripe request, no stripe-signature header", 400);
    }
    let event: Stripe.Event;
    const StripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
    try {
      event = stripe.webhooks.constructEvent(payload, sigHeader, StripeWebhookSecret);
    } catch (err) {
      throw new DBOSResponseError("Unable to verify event from Stripe", 400);
    }
    return event;
  }

  // Update a user's subscription status in DBOS Cloud
  @Communicator({intervalSeconds: 10, maxAttempts: 20, backoffRate: 1.2}) // Configure automatic retries
  static async updateCloudEntitlement(ctxt: CommunicatorContext, dbosAuthID: string, plan: string) {
    let token = Utils.dbosAuth0Token;
    const ts = Date.now();
    // Fetch an access token from Auth0 if the current token is not present or expired
    if (!token || (ts - Utils.lastTokenFetch) > 43200000) {
      ctxt.logger.info("Retrieving access token from Auth0");
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
      }
    };
    const response = await axios.request(entitlementRequest);
    ctxt.logger.info(`Update entitlement for ${dbosAuthID} to plan ${plan}, response: ${response.status}`);

    // Send a slack notification
    if (process.env.ZAZU_SLACK_TOKEN && dbosAuthID !== process.env.DBOS_TEST_USER) {
      let title = "User subscribed to DBOS Pro :partying_face:";
      if (plan === DBOSPlans.free) {
        title = "User canceled DBOS Pro :sadge:";
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
          attachments: [ {text: `User ${dbosAuthID} is using ${plan} tier. DBOS Cloud response status: ${response.status}`} ]
        },
      };
      const res = await axios.request(slackRequest);
      ctxt.logger.info(`Sent slack notification, response: ${res.status}`);
    }
  }

  static dbosAuth0Token: string|undefined;
  static lastTokenFetch = 0;
  // Securely retrieve an access token from Auth0 authorizing this app to use the DBOS Cloud admin API
  static async retrieveAccessToken(): Promise<string> {
    const refreshToken = process.env.DBOS_LOGIN_REFRESH_TOKEN;
    if (!refreshToken) {
      throw new Error("No refresh token found");
    }
    // eslint-disable-next-line no-secrets/no-secrets
    const DBOSAuth0ClientID = DBOSDomain === 'cloud.dbos.dev' ? '6p7Sjxf13cyLMkdwn14MxlH7JdhILled' : 'G38fLmVErczEo9ioCFjVIHea6yd0qMZu';
    const loginRequest = {
      method: 'POST',
      url: `https://${DBOSLoginDomain}/oauth/token`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      data: {
        grant_type: "refresh_token",
        client_id: DBOSAuth0ClientID,
        refresh_token: refreshToken
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

  static auth0JwtVerifier = jwt({
    secret: koaJwtSecret({
      jwksUri: `https://${DBOSLoginDomain}/.well-known/jwks.json`,
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 600000,
    }),
    issuer: `https://${DBOSLoginDomain}/`,
    audience: 'dbos-cloud-api'
  });

  // Middleware authenticating requests using JWT tokens
  static async userAuthMiddleware(ctxt: MiddlewareContext) {
    if (ctxt.requiredRole.length > 0) {
      /* eslint-disable @typescript-eslint/no-unsafe-member-access */
      if (!ctxt.koaContext.state.user) {
        throw new DBOSResponseError("No authenticated DBOS User!", 401);
      }
      const authenticatedUser = ctxt.koaContext.state.user["sub"] as string;
      if (!authenticatedUser) {
        throw new DBOSResponseError("No valid DBOS user found!", 401);
      }
      const userEmail = ctxt.koaContext.state.user["https://dbos.dev/email"] as string;
      if (!userEmail) {
        throw new DBOSResponseError("No email found for the authenticated user", 400);
      }
      return Promise.resolve({ authenticatedRoles: ['user'], authenticatedUser: authenticatedUser });
    }
  }
}

interface RefreshTokenAuthResponse {
  access_token: string;
  scope: string;
  expires_in: number;
  token_type: string;
}

interface Accounts {
  auth0_subject_id: string;
  email: string;
  stripe_customer_id: string;
  created_at: number;
  updated_at: number;
}
