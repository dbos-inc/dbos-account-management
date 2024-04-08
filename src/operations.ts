import { HandlerContext, ArgSource, ArgSources, PostApi, DBOSResponseError, DBOSInitializer, InitContext, RequiredRole, KoaMiddleware, Authentication, MiddlewareContext, CommunicatorContext } from '@dbos-inc/dbos-sdk';
import Stripe from 'stripe';
import jwt from "koa-jwt";
import { koaJwtSecret } from "jwks-rsa";
import { retrieveStripeCustomer } from './utils';

let stripe: Stripe;

// TODO: currently cannot use env variables in FC, so we need to switch it manually.
const DBOSLoginDomain = "dbos-inc.us.auth0.com";
// const DBOSLoginDomain = "login.dbos.dev";
let DBOSDomain: string;
const DBOSProPlanString = "dbospro";

async function userAuthMiddleware(ctxt: MiddlewareContext) {
  ctxt.logger.debug("Request: " + JSON.stringify(ctxt.koaContext.request));
  if (ctxt.requiredRole.length > 0) {
    if (!ctxt.koaContext.state.user) {
      throw new DBOSResponseError("No authenticated DBOS User!", 401);
    }
    ctxt.logger.debug(ctxt.koaContext.state.user);
    const authenticatedUser = ctxt.koaContext.state.user["sub"] as string;
    if (!authenticatedUser) {
      throw new DBOSResponseError("No valid DBOS user found!", 401);
    }
    return { authenticatedRoles: ['user'], authenticatedUser: authenticatedUser };
  }
}

const dbosJWT = jwt({
  secret: koaJwtSecret({
    jwksUri: `https://${DBOSLoginDomain}/.well-known/jwks.json`,
    cache: true,
    cacheMaxEntries: 5,
    cacheMaxAge: 600000,
  }),
  issuer: `https://${DBOSLoginDomain}/`,
  audience: 'dbos-cloud-api'
});

// These endpoints can only be called with an authenticated user on DBOS cloud
@Authentication(userAuthMiddleware)
@KoaMiddleware(dbosJWT)
export class CloudSubscription {
  @DBOSInitializer()
  static async init(ctxt: InitContext) {
    // Construct stripe
    stripe = new Stripe(ctxt.getConfig("STRIPE_SECRET_KEY") as string);
    DBOSDomain = ctxt.getConfig("DBOS_DOMAIN") as string ?? "staging.dev.dbos.dev";
  }

  @RequiredRole(['user'])
  @PostApi('/create-customer-portal')
  static async createCustomerPortal(ctxt: HandlerContext) {
    const authUser = ctxt.authenticatedUser;
    const customerID = await retrieveStripeCustomer(stripe, authUser);
  
    const session = await stripe.billingPortal.sessions.create({
      customer: customerID,
      return_url: 'https://dbos.dev'
    })
    if (!session.url) {
      ctxt.logger.error("Failed to create a customer portal!");
      throw new DBOSResponseError("Failed to create customer portal!", 500);
    }
    ctxt.koaContext.redirect(session.url);
  }

  // This function redirects user to a subscription page
  @RequiredRole(['user'])
  @PostApi('/subscribe')
  static async subscribePlan(ctxt: HandlerContext, @ArgSource(ArgSources.BODY) plan: string) {
    // Validate argument
    if (plan !== DBOSProPlanString) {
      ctxt.logger.error(`Invalid DBOS plan: ${plan}`);
      throw new DBOSResponseError("Invalid DBOS Plan", 400);
    }

    const authUser = ctxt.authenticatedUser;
    const customerID = await retrieveStripeCustomer(stripe, authUser);

    try {
      const prices = await stripe.prices.retrieve(ctxt.getConfig("STRIPE_DBOS_PRO_PRICE") as string);
      const session = await stripe.checkout.sessions.create({
        customer: customerID,
        billing_address_collection: 'auto',
        line_items: [
          {
            price: prices.id,
            quantity: 1,
          },
        ],
        mode: 'subscription',
        success_url: `https://docs.dbos.dev`,
        cancel_url: `https://www.dbos.dev/pricing`,
      });
      if (!session.url) {
        throw new Error("Failed to create a checkout session!")
      }
      ctxt.koaContext.redirect(session.url);
    } catch (err) {
      ctxt.logger.error(`Failed to create a subscription: ${(err as Error).message}`);
      throw new Error("Failed to create subscription");
    }
  }
}

// Webhook has to be in separate class because it's not using our auth middleware
export class StripeWebhook {
  @PostApi('/stripe_webhook')
  static async stripeWebhook(ctxt: HandlerContext) {
    const req = ctxt.koaContext.request;
    const sigHeader = req.headers['stripe-signature'];
    if (typeof sigHeader !== 'string') {
      throw new DBOSResponseError("Invalid stripe request", 400);
    }

    const payload: string = req.rawBody;
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(payload, sigHeader, ctxt.getConfig("STRIPE_WEBHOOK_SECRET") as string);
    } catch (err) {
      ctxt.logger.error(err);
      throw new DBOSResponseError("Webhook Error", 400);
    }

    // Handle the event
    // event.id can be used as the idempotency key for workflows
    let customerID: string;
    let customer;
    let dbosAuthID: string;
    switch (event.type) {
      case 'customer.subscription.created':
        ctxt.logger.info("User subscribed to DBOS!");
        const customerSubscriptionCreated = event.data.object;
        if (customerSubscriptionCreated.status !== "active") {
          ctxt.logger.error(`Subscription ${customerSubscriptionCreated.id} not active`);
          break;
        }
        if (customerSubscriptionCreated.items.data.length !== 1) {
          ctxt.logger.error(`Subscription ${customerSubscriptionCreated.id} has more than one data item`);
          break;
        }
        const price = customerSubscriptionCreated.items.data[0].price.id;
        ctxt.logger.info(`Subscription to price ${price}`);
        customerID = customerSubscriptionCreated.customer as string;
        customer = await stripe.customers.retrieve(customerID);
        if (customer.deleted) {
          ctxt.logger.error(`Customer ${customerID} is deleted!`);
          break;
        }
        dbosAuthID = customer.metadata["auth0_user_id"];
        if (!dbosAuthID) {
          ctxt.logger.error(`Cannot find DBOS Auth ID from ${customerID}`);
          break;
        } else {
          ctxt.logger.info(`Found DBOS Auth ID: ${dbosAuthID}`);
        }

        // Talk to DBOS Cloud
        break;
      case 'customer.subscription.deleted':
        ctxt.logger.info("User canceled DBOS subscription!");
        const customerSubscriptionDeleted = event.data.object;
        if (customerSubscriptionDeleted.status !== "active") {
          ctxt.logger.error(`Subscription ${customerSubscriptionDeleted.id} not active`);
          break;
        }
        if (customerSubscriptionDeleted.items.data.length !== 1) {
          ctxt.logger.error(`Subscription ${customerSubscriptionDeleted.id} has more than one data item`);
          break;
        }
        customerID = customerSubscriptionDeleted.customer as string;
        customer = await stripe.customers.retrieve(customerID);
        if (customer.deleted) {
          ctxt.logger.error(`Customer ${customerID} is deleted!`);
          break;
        }
        dbosAuthID = customer.metadata["auth0_user_id"];
        if (!dbosAuthID) {
          ctxt.logger.error(`Cannot find DBOS Auth ID from ${customerID}`);
          break;
        } else {
          ctxt.logger.info(`Found DBOS Auth ID: ${dbosAuthID}`);
        }
        break;
      case 'customer.subscription.updated':
        ctxt.logger.info("User updated DBOS subscription!");
        const customerSubscriptionUpdated = event.data.object;
        if (customerSubscriptionUpdated.status !== "active") {
          ctxt.logger.error(`Subscription ${customerSubscriptionUpdated.id} not active`);
          break;
        }
        if (customerSubscriptionUpdated.items.data.length !== 1) {
          ctxt.logger.error(`Subscription ${customerSubscriptionUpdated.id} has more than one data item`);
          break;
        }
        customerID = customerSubscriptionUpdated.customer as string;
        customer = await stripe.customers.retrieve(customerID);
        if (customer.deleted) {
          ctxt.logger.error(`Customer ${customerID} is deleted!`);
          break;
        }
        dbosAuthID = customer.metadata["auth0_user_id"];
        if (!dbosAuthID) {
          ctxt.logger.error(`Cannot find DBOS Auth ID from ${customerID}`);
          break;
        } else {
          ctxt.logger.info(`Found DBOS Auth ID: ${dbosAuthID}`);
        }
        break;
      // ... handle other event types
      default:
        ctxt.logger.info(`Unhandled event type ${event.type}`);
    }
  }
}