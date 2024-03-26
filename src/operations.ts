import { HandlerContext, ArgSource, ArgSources, PostApi, DBOSResponseError, DBOSInitializer, InitContext, RequiredRole, KoaMiddleware, Authentication, MiddlewareContext } from '@dbos-inc/dbos-sdk';
import Stripe from 'stripe';
import jwt from "koa-jwt";
import { koaJwtSecret } from "jwks-rsa";

// const DBOSLoginDomain = "dbos-inc.us.auth0.com"; // TODO: currently cannot use env variables in FC.
const DBOSLoginDomain = "login.dbos.dev";
let stripe: Stripe;
let DBOSDomain: string;
const DBOSPRoPlanString = "dbospro";

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
    // Look up customer from stripe
    const customers = await stripe.customers.search({
      query: `metadata["auth0_user_id"]:"${authUser}"`,
    });

    let customerID = "";
    if (customers.data.length === 1) {
      customerID = customers.data[0].id;
    } else {
      ctxt.logger.error(`Unexpected number of customer records: ${customers.data.length}`);
      throw new DBOSResponseError("Failed to look up customer from stripe", 400);
    }

    ctxt.logger.info(`Creating customer portal for ${customerID}`);

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
    // Currently, we only support DBOS Pro
    if (plan !== DBOSPRoPlanString) {
      ctxt.logger.error(`Invalid DBOS plan: ${plan}`);
      throw new DBOSResponseError("Invalid DBOS Plan", 400);
    }

    const authUser = ctxt.authenticatedUser;
    // Look up customer from stripe
    const customers = await stripe.customers.search({
      query: `metadata["auth0_user_id"]:"${authUser}"`,
    });

    let customerID = "";
    if (customers.data.length === 1) {
      customerID = customers.data[0].id;
    } else {
      ctxt.logger.error(`Unexpected number of customer records: ${customers.data.length}`);
      throw new DBOSResponseError("Failed to look up customer from stripe", 400);
    }

    ctxt.logger.info(`Subscribing to DBOS pro for ${customerID}`);
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
        ctxt.logger.error("Failed to create a checkout session!")
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
    switch (event.type) {
      case 'customer.subscription.created':
        const customerSubscriptionCreated = event.data.object;
        // Then define and call a function to handle the event customer.subscription.created
        ctxt.logger.info(customerSubscriptionCreated);
        break;
      case 'customer.subscription.deleted':
        const customerSubscriptionDeleted = event.data.object;
        // Then define and call a function to handle the event customer.subscription.deleted
        ctxt.logger.info(customerSubscriptionDeleted);
        break;
      case 'customer.subscription.paused':
        const customerSubscriptionPaused = event.data.object;
        // Then define and call a function to handle the event customer.subscription.paused
        ctxt.logger.info(customerSubscriptionPaused)
        break;
      case 'customer.subscription.pending_update_applied':
        const customerSubscriptionPendingUpdateApplied = event.data.object;
        // Then define and call a function to handle the event customer.subscription.pending_update_applied
        ctxt.logger.info(customerSubscriptionPendingUpdateApplied)
        break;
      case 'customer.subscription.pending_update_expired':
        const customerSubscriptionPendingUpdateExpired = event.data.object;
        // Then define and call a function to handle the event customer.subscription.pending_update_expired
        ctxt.logger.info(customerSubscriptionPendingUpdateExpired)
        break;
      case 'customer.subscription.resumed':
        const customerSubscriptionResumed = event.data.object;
        // Then define and call a function to handle the event customer.subscription.resumed
        ctxt.logger.info(customerSubscriptionResumed)
        break;
      case 'customer.subscription.trial_will_end':
        const customerSubscriptionTrialWillEnd = event.data.object;
        // Then define and call a function to handle the event customer.subscription.trial_will_end
        ctxt.logger.info(customerSubscriptionTrialWillEnd)
        break;
      case 'customer.subscription.updated':
        const customerSubscriptionUpdated = event.data.object;
        // Then define and call a function to handle the event customer.subscription.updated
        ctxt.logger.info(customerSubscriptionUpdated)
        break;
      // ... handle other event types
      default:
        ctxt.logger.info(`Unhandled event type ${event.type}`);
    }
  }
}