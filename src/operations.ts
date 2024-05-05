/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { HandlerContext, PostApi, DBOSResponseError, RequiredRole, KoaMiddleware, Authentication } from '@dbos-inc/dbos-sdk';
import Stripe from 'stripe';
import { Utils } from './utils';
export { Utils } from './utils';

// Stripe webhook endpoint
export class StripeWebhook {
  @PostApi('/stripe_webhook')
  static async stripeWebhook(ctxt: HandlerContext) {
    // Verify the request is actually from Stripe
    const req = ctxt.request;
    const event = Utils.verifyStripeEvent(req.rawBody, req.headers);

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.deleted':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        // Start the workflow with event.id as the idempotency key without waiting for it to finish
        await ctxt.invoke(Utils, event.id).stripeEventWorkflow(subscription.id, subscription.customer as string);
        break;
      }
      case 'checkout.session.completed': {
        const checkout = event.data.object as Stripe.Checkout.Session;
        if (checkout.mode === 'subscription') {
          await ctxt.invoke(Utils, event.id).stripeEventWorkflow(checkout.subscription as string, checkout.customer as string);
        }
        break;
      }
      default:
        ctxt.logger.info(`Unhandled event type ${event.type}`);
    }
  }
}

// These endpoints return Stripe URLs and can only be called with an authenticated user on DBOS cloud
@Authentication(Utils.userAuthMiddleware)
@KoaMiddleware(Utils.auth0JwtVerifier)
export class CloudSubscription {
  @RequiredRole(['user'])
  @PostApi('/subscribe')
  static async subscribePlan(ctxt: HandlerContext, plan: string) {
    if (plan !== "dbospro") { throw new DBOSResponseError("Invalid DBOS Plan", 400); }
    const auth0UserID = ctxt.authenticatedUser;
    const userEmail = ctxt.koaContext.state.user["https://dbos.dev/email"] as string;
    const sessionURL = await ctxt.invoke(Utils).createSubscription(auth0UserID, userEmail).then(x => x.getResult());
    if (!sessionURL) {
      throw new DBOSResponseError("Failed to create a checkout session!", 500);
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
