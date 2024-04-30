/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { HandlerContext, ArgSource, ArgSources, PostApi, DBOSResponseError, RequiredRole, KoaMiddleware, Authentication } from '@dbos-inc/dbos-sdk';
import Stripe from 'stripe';
import jwt from "koa-jwt";
import { koaJwtSecret } from "jwks-rsa";
import { DBOSLoginDomain, stripe, Utils } from './utils';
export { Utils } from './utils';

const DBOSProPlanString = "dbospro";
const auth0JwtVerifier = jwt({
  secret: koaJwtSecret({
    jwksUri: `https://${DBOSLoginDomain}/.well-known/jwks.json`,
    cache: true,
    cacheMaxEntries: 5,
    cacheMaxAge: 600000,
  }),
  issuer: `https://${DBOSLoginDomain}/`,
  audience: 'dbos-cloud-api'
});
let lastTokenFetch = 0;

// These endpoints can only be called with an authenticated user on DBOS cloud
@Authentication(Utils.userAuthMiddleware)
@KoaMiddleware(auth0JwtVerifier)
export class CloudSubscription {
  @RequiredRole(['user'])
  @PostApi('/subscribe')
  static async subscribePlan(ctxt: HandlerContext, @ArgSource(ArgSources.BODY) plan: string) {
    if (plan !== DBOSProPlanString) { throw new DBOSResponseError("Invalid DBOS Plan", 400); }
    const auth0UserID = ctxt.authenticatedUser;
    const userEmail = ctxt.koaContext.state.user["https://dbos.dev/email"] as string;
    const sessionURL = await ctxt.invoke(Utils).createSubscription(auth0UserID, userEmail).then(x => x.getResult());
    if (!sessionURL) {
      throw new DBOSResponseError("Failed to create a checkout session!");
    }
    return { url: sessionURL };
  }

  @RequiredRole(['user'])
  @PostApi('/create-customer-portal')
  static async createCustomerPortal(ctxt: HandlerContext) {
    const auth0User = ctxt.authenticatedUser;
    const sessionURL = await ctxt.invoke(Utils).createStripeCustomerPortal(auth0User).then(x => x.getResult());
    if (!sessionURL) {
      throw new DBOSResponseError("Failed to create customer portal!", 500);
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

    // Fetch auth0 credential every 12 hours.
    // TODO: use cron job.
    try {
      const ts = Date.now();
      if ((ts - lastTokenFetch) > 43200000) {
        await ctxt.invoke(Utils).retrieveCloudCredential();
        lastTokenFetch = ts;
      }
    } catch (err) {
      ctxt.logger.error(err);
    }

    // Handle the event.
    // Use event ID as the idempotency key for the workflow, making sure once-and-only-once execution.
    // Invoke the workflow but don't wait for it to finish. Fast response to Stripe.
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.deleted':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await ctxt.invoke(Utils, event.id).stripeWebhookWorkflow(subscription.id, subscription.customer as string);
        break;
      }
      case 'checkout.session.completed': {
        const checkout = event.data.object as Stripe.Checkout.Session;
        if (checkout.mode === 'subscription') {
          await ctxt.invoke(Utils, event.id).stripeWebhookWorkflow(checkout.subscription as string, checkout.customer as string);
        }
        break;
      }
      default:
        ctxt.logger.info(`Unhandled event type ${event.type}`);
    }
  }
}