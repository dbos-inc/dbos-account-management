/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { HandlerContext, ArgSource, ArgSources, PostApi, DBOSResponseError, RequiredRole, KoaMiddleware, Authentication } from '@dbos-inc/dbos-sdk';
import Stripe from 'stripe';
import jwt from "koa-jwt";
import { koaJwtSecret } from "jwks-rsa";
import { DBOSLoginDomain, Utils } from './utils';
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
    // Verify the request is actually from Stripe.
    const req = ctxt.koaContext.request;
    const event = Utils.verifyStripeEvent(req.rawBody as string, req.headers['stripe-signature']);

    // Invoke the workflow asynchronously and quickly response to Stripe.
    // Use event.id as the workflow idempotency key to guarantee exactly once processing.
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