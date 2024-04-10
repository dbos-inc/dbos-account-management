import { Communicator, CommunicatorContext, DBOSInitializer, DBOSResponseError, InitContext, MiddlewareContext, Transaction, TransactionContext, Workflow, WorkflowContext } from "@dbos-inc/dbos-sdk";
import Stripe from "stripe";
import { Knex } from 'knex';

export let stripe: Stripe;

export class Utils {
  static async userAuthMiddleware(ctxt: MiddlewareContext) {
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

  @DBOSInitializer()
  static async init(ctxt: InitContext) {
    // Construct stripe
    stripe = new Stripe(ctxt.getConfig("STRIPE_SECRET_KEY") as string);
  }

  @Communicator()  
  static async retrieveStripeCustomer(ctxt: CommunicatorContext, authUser: string): Promise<string> {
    // Look up customer from stripe
    const customers = await stripe.customers.search({
      query: `metadata["auth0_user_id"]:"${authUser}"`,
    });

    let customerID = "";
    if (customers.data.length === 1) {
      customerID = customers.data[0].id;
    } else {
      ctxt.logger.error(`Failed to look up customer from stripe: ${customers.data.length}`);
      throw new DBOSResponseError("Failed to look up customer from stripe", 400);
    }
    return customerID;
  }

  @Communicator()
  static async createPortal(ctxt: CommunicatorContext, authUser: string): Promise<string> {
    const customerID = await Utils.retrieveStripeCustomer(ctxt, authUser); // Directly invoke another communicator
    const session = await stripe.billingPortal.sessions.create({
      customer: customerID,
      return_url: 'https://dbos.dev'
    });
    return session.url;
  }

  @Communicator()
  static async createCheckout(ctxt: CommunicatorContext, authUser: string): Promise<string|null> {
    const customerID = await Utils.retrieveStripeCustomer(ctxt, authUser); // Directly invoke another communicator
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
      return session.url;
  }

  // Find the Auth0 user info from stripe customer
  @Communicator()
  static async findAuth0User(ctxt: CommunicatorContext, customerID: string): Promise<string> {
    const customer = await stripe.customers.retrieve(customerID) as Stripe.Customer;
    const dbosAuthID = customer.metadata["auth0_user_id"];
    if (!dbosAuthID) {
      ctxt.logger.error(`Cannot find DBOS Auth ID from ${customerID}`);
      throw new Error(`Cannot find DBOS Auth ID for customer ${customerID}`);
    }
    return dbosAuthID;
  }

  @Communicator()
  static async retrieveSubscription(ctxt: CommunicatorContext, subscriptionID: string): Promise<StripeSubscription> {
    const subscription = await stripe.subscriptions.retrieve(subscriptionID);
    return {
      id: subscriptionID,
      customer: subscription.customer as string,
      price: subscription.items.data[0].price.id as string,
      status: subscription.status,
    };
  }

  @Transaction()
  static async updateDBRecord(ctxt: TransactionContext<Knex>, dbosAuthID: string, stripeCustomerID: string, plan: string) {
    // Use knex to upsert into subscriptions table.
    const query = `INSERT INTO subscriptions (auth0_user_id, stripe_customer_id, dbos_plan, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (auth0_user_id) DO UPDATE SET dbos_plan = EXCLUDED.dbos_plan, updated_at = EXCLUDED.updated_at`;
    await ctxt.client.raw(query, [dbosAuthID, stripeCustomerID, plan, Date.now()]);
  }

  @Communicator()
  static async updateCloudEntitlement(ctxt: CommunicatorContext, dbosAuthID: string, plan: string) {
    
  }

  @Workflow()
  static async subscriptionWorkflow(ctxt: WorkflowContext, subscriptionID: string, customerID: string) {
    // Check subscription from stripe and only active the account if plan is active.
    const proPrice = ctxt.getConfig("STRIPE_DBOS_PRO_PRICE") as string;
    const dbosAuthID = await ctxt.invoke(Utils).findAuth0User(customerID);
    const subscription = await ctxt.invoke(Utils).retrieveSubscription(subscriptionID);
    if (subscription.status === 'incomplete' || subscription.status === 'incomplete_expired') {
      ctxt.logger.info(`Subscription ${subscriptionID} is incomplete. Do nothing.`);
      return;
    } else if (subscription.status === 'active' && subscription.price === proPrice) {
      ctxt.logger.info(`Subscription ${subscriptionID} is active for user ${dbosAuthID}`);
      await ctxt.invoke(Utils).updateDBRecord(dbosAuthID, customerID, 'pro');
      // Then talk to DBOS Cloud to activate the subscription.
    } else if (subscription.status === 'canceled' && subscription.price === proPrice) {
      ctxt.logger.info(`Subscription ${subscriptionID} is canceled for user ${dbosAuthID}`);
      await ctxt.invoke(Utils).updateDBRecord(dbosAuthID, customerID, 'free');
      // Then talk to DBOS Cloud to deactivate the subscription.
    } else {
      ctxt.logger.warn(`Unknown subscription status: ${subscription.status}; or price: ${subscription.price}; user ${dbosAuthID}`);
    }
  }
}

interface dbos_subscriptions {
  auth0_user_id: string;
  stripe_customer_id: string;
  dbos_plan: string;
  created_at: number;
  updated_at: number;
}

interface StripeSubscription {
  id: string;
  customer: string;
  price: string;
  status: string;
}
