import { HandlerContext, PostApi, DBOSResponseError, RequiredRole, KoaMiddleware, Authentication } from '@dbos-inc/dbos-sdk';
import Stripe from 'stripe';
import { Utils } from './subscription';

// Stripe webhook endpoint
export class StripeWebhook {
  @PostApi('/stripe_webhook')
  static async stripeWebhook(ctxt: HandlerContext) {
    // Verify the request is actually from Stripe
    const req = ctxt.request;
    const event = Utils.verifyStripeEvent(req.rawBody, req.headers);

    switch (event.type) {
      // Handle events when a user subscribes, cancels, or updates their subscription
      case 'customer.subscription.created':
      case 'customer.subscription.deleted':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        // Start the workflow with event.id as the idempotency key without waiting for it to finish
        await ctxt.startWorkflow(Utils, event.id).stripeEventWorkflow(subscription.id, subscription.customer as string);
        break;
      }
      // Handle the event when a user completes payment for a subscription
      case 'checkout.session.completed': {
        const checkout = event.data.object as Stripe.Checkout.Session;
        if (checkout.mode === 'subscription') {
          await ctxt.startWorkflow(Utils, event.id).stripeEventWorkflow(checkout.subscription as string, checkout.customer as string);
        }
        break;
      }
      default:
        ctxt.logger.info(`Unhandled event type ${event.type}`);
    }
  }
}

// Endpoints to retrieve Stripe session URLs
@Authentication(Utils.userAuthMiddleware)
@KoaMiddleware(Utils.auth0JwtVerifier)
export class CloudSubscription {
  // Retrieve a Stripe checkout sesion URL for an authenticated customer
  @RequiredRole(['user'])
  @PostApi('/subscribe')
  static async subscribePlan(ctxt: HandlerContext) {
    const auth0UserID = ctxt.authenticatedUser;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userEmail = ctxt.koaContext.state.user["https://dbos.dev/email"] as string;
    const sessionURL = await ctxt.invokeWorkflow(Utils).createSubscription(auth0UserID, userEmail);
    if (!sessionURL) {
      throw new DBOSResponseError("Failed to create a checkout session!", 500);
    }
    return { url: sessionURL };
  }

  // Retrieve a Stripe customer portal URL for an authenticated customer
  @RequiredRole(['user'])
  @PostApi('/create-customer-portal')
  static async createCustomerPortal(ctxt: HandlerContext) {
    const auth0User = ctxt.authenticatedUser;
    const sessionURL = await ctxt.invokeWorkflow(Utils).createStripeCustomerPortal(auth0User);
    if (!sessionURL) {
      throw new DBOSResponseError("Failed to create customer portal!", 500);
    }
    return { url: sessionURL };
  }
}
