import Fastify from 'fastify';
import rawBodyPlugin from 'fastify-raw-body';
import { DBOS } from '@dbos-inc/dbos-sdk';
import Stripe from 'stripe';
import { verifyStripeEvent, stripeEventWorkflow } from './subscription.js';

const fastify = Fastify({logger: true});

// Register raw body plugin before route registration
await fastify.register(rawBodyPlugin, {
  field: 'rawBody',
  global: false,
  runFirst: true,
});

// Stripe webhook endpoint
fastify.post('/stripe_webhook', {
  config: {
    rawBody: true
  },
}, async function (request, reply) {
  // Verify the request is actually from Stripe
  let event: Stripe.Event;
  try {
    event = verifyStripeEvent(request.rawBody, request.headers);
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
      await DBOS.startWorkflow(stripeEventWorkflow, {workflowID: event.id})(subscription.id, subscription.customer as string);
      break;
    }
    // Handle the event when a user completes payment for a subscription
    case 'checkout.session.completed': {
      const checkout = event.data.object as Stripe.Checkout.Session;
      if (checkout.mode === 'subscription') {
        await DBOS.startWorkflow(stripeEventWorkflow, {workflowID: event.id})(checkout.subscription as string, checkout.customer as string);
      }
      break;
    }
    default:
      DBOS.logger.info(`Unhandled event type ${event.type}`);
  }
  return reply.code(200).send({ received: true });
})

// Endpoints to retrieve Stripe session URLs

// Retrieve a Stripe checkout session URL for an authenticated customer


// @Authentication(Utils.userAuthMiddleware)
// @KoaMiddleware(Utils.auth0JwtVerifier)
// export class CloudSubscription {
//   // Retrieve a Stripe checkout sesion URL for an authenticated customer
//   @RequiredRole(['user'])
//   @PostApi('/subscribe')
//   static async subscribePlan(ctxt: HandlerContext) {
//     const auth0UserID = ctxt.authenticatedUser;
//     // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
//     const userEmail = ctxt.koaContext.state.user["https://dbos.dev/email"] as string;
//     const body = ctxt.request.body as {success_url: string, cancel_url: string};
//     const successUrl = body.success_url ?? 'https://console.dbos.dev';
//     const cancelUrl = body.cancel_url ?? 'https://www.dbos.dev/pricing';
//     const sessionURL = await ctxt.invokeWorkflow(Utils).createSubscription(auth0UserID, userEmail, successUrl, cancelUrl);
//     if (!sessionURL) {
//       throw new DBOSResponseError("Failed to create a checkout session!", 500);
//     }
//     return { url: sessionURL };
//   }

//   // Retrieve a Stripe customer portal URL for an authenticated customer
//   @RequiredRole(['user'])
//   @PostApi('/create-customer-portal')
//   static async createCustomerPortal(ctxt: HandlerContext) {
//     const auth0User = ctxt.authenticatedUser;
//     const returnUrl = (ctxt.request.body as {return_url: string}).return_url ?? 'https://www.dbos.dev/pricing';
//     const sessionURL = await ctxt.invokeWorkflow(Utils).createStripeCustomerPortal(auth0User, returnUrl);
//     if (!sessionURL) {
//       throw new DBOSResponseError("Failed to create customer portal!", 500);
//     }
//     return { url: sessionURL };
//   }
// }

async function main() {
  const PORT = Number(process.env.PORT || 3000);
  DBOS.setConfig({
    name: 'dbos',
    databaseUrl: process.env.DBOS_DATABASE_URL,
  })
  await DBOS.launch();
  try {
    await fastify.listen({ port: PORT, host: "0.0.0.0" });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
}

main().catch(console.log);