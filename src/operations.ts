import { HandlerContext, GetApi, ArgSource, ArgSources, PostApi, DBOSResponseError, DBOSInitializer, InitContext } from '@dbos-inc/dbos-sdk';
import Stripe from 'stripe';

const defaultUser = 'google-oauth2|116389455801740676096';
let stripe: Stripe;

// These endpoints can only be called with an authenticated user on DBOS cloud
export class CloudSubscription {
  @DBOSInitializer()
  static async init(ctxt: InitContext) {
    // Construct stripe
    stripe = new Stripe(ctxt.getConfig("STRIPE_SECRET_KEY") as string);
  }

  @GetApi('/create-customer-portal')
  static async createCustomerPortal(ctxt: HandlerContext) {
    // TODO: remove this test user, fail if we don't have an authenticated user.
    const authUser = ctxt.authenticatedUser == "" ? defaultUser : ctxt.authenticatedUser;
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

  // This function redirects user to a subscribe to DBOS Pro
  // Test pro-tier price key: 'price_1OxD4jP4cBCONpkqjBFLNraB';
  @GetApi('/subscribe/:pricekey')
  static async subscribeProPlan(ctxt: HandlerContext, @ArgSource(ArgSources.URL) pricekey: string) {
    const authUser = ctxt.authenticatedUser == "" ? defaultUser : ctxt.authenticatedUser;

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
      const prices = await stripe.prices.retrieve(pricekey);
      ctxt.logger.info(prices);
  
      const session = await stripe.checkout.sessions.create({
        customer: customerID,
        billing_address_collection: 'auto',
        line_items: [
          {
            price: prices.id,
            // For metered billing, do not pass quantity
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

  @PostApi('/stripe_webhook')
  static async stripeWebhook(ctxt: HandlerContext) {
    const req = ctxt.koaContext.request;
    const sigHeader = req.headers['stripe-signature'];
    if (typeof sigHeader !== 'string') {
      throw new DBOSResponseError("Invalid stripe request", 400);
    }

    const payload: string = req.rawBody;
    try {
      const event = stripe.webhooks.constructEvent(payload, sigHeader, ctxt.getConfig("STRIPE_WEBHOOK_SECRET") as string);
      ctxt.logger.info(event);
    } catch (err) {
      ctxt.logger.error(err);
      throw new DBOSResponseError("Webhook Error", 400);
    }
  }

}
