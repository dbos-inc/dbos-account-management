/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { HandlerContext, ArgSource, ArgSources, PostApi, DBOSResponseError, RequiredRole, KoaMiddleware, Authentication } from '@dbos-inc/dbos-sdk';
import Stripe from 'stripe';
import jwt from "koa-jwt";
import { koaJwtSecret } from "jwks-rsa";
import { DBOSLoginDomain, stripe, Utils } from './utils';
export { Utils } from './utils';

const DBOSProPlanString = "dbospro";
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
@Authentication(Utils.userAuthMiddleware)
@KoaMiddleware(dbosJWT)
export class CloudSubscription {
  @RequiredRole(['user'])
  @PostApi('/create-customer-portal')
  static async createCustomerPortal(ctxt: HandlerContext) {
    const authUser = ctxt.authenticatedUser;
    const sessionURL = await ctxt.invoke(Utils).createPortal(authUser);
    if (!sessionURL) {
      ctxt.logger.error("Failed to create a customer portal!");
      throw new DBOSResponseError("Failed to create customer portal!", 500);
    }
    return { url: sessionURL };
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
    const sessionURL = await ctxt.invoke(Utils).createCheckout(authUser);
    if (!sessionURL) {
      throw new Error("Failed to create a checkout session!");
    }
    return { url: sessionURL };
  }
}

// Webhook has to be in separate class because it's not using our auth middleware
export class StripeWebhook {
  @PostApi('/stripe_webhook')
  static async stripeWebhook(ctxt: HandlerContext) {
    // Make sure the request is actually from Stripe.
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

    // Fetch auth0 credential every 6 hours.
    const ts = Date.now();
    const uuidStr = 'authtoken-' + (ts - (ts % 21600000)).toString();
    await ctxt.invoke(Utils, uuidStr).retrieveCloudCredential();

    // Handle the event.
    // Use event ID as the idempotency key for the workflow, making sure once-and-only-once execution.
    // Invoke the workflow but don't wait for it to finish. Fast response to Stripe.
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.deleted':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await ctxt.invoke(Utils, event.id).subscriptionWorkflow(subscription.id, subscription.customer as string);
        break;
      }
      case 'checkout.session.completed': {
        const checkout = event.data.object as Stripe.Checkout.Session;
        if (checkout.mode === 'subscription') {
          await ctxt.invoke(Utils, event.id).subscriptionWorkflow(checkout.subscription as string, checkout.customer as string);
        }
        break;
      }
      default:
        ctxt.logger.info(`Unhandled event type ${event.type}`);
    }
  }
}