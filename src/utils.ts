import { Communicator, CommunicatorContext, DBOSInitializer, DBOSResponseError, InitContext, MiddlewareContext, Workflow, WorkflowContext } from "@dbos-inc/dbos-sdk";
import Stripe from "stripe";

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

  // TODO: It doesn't need to be a communicator. It can be invoked from within another communicator.
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
  static async createPortal(_ctxt: CommunicatorContext, customerID: string): Promise<string> {
    
    const session = await stripe.billingPortal.sessions.create({
      customer: customerID,
      return_url: 'https://dbos.dev'
    });
    return session.url;
  }

  @Communicator()
  static async createCheckout(ctxt: CommunicatorContext, customerID: string): Promise<string|null> {
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

  @Workflow()
  static async subscriptionWorkflow(ctxt: WorkflowContext, subscriptionID: string, customerID: string) {
    // Check subscription from stripe and only active the account if plan is active.
  //   const customer = await stripe.customers.retrieve(customerID);
  //   if (customer.deleted) {
  //     ctxt.logger.error(`Customer ${customerID} is deleted!`);
  //     break;
  //   }
  //   dbosAuthID = customer.metadata["auth0_user_id"];
  //   if (!dbosAuthID) {
  //     ctxt.logger.error(`Cannot find DBOS Auth ID from ${customerID}`);
  //     break;
  //   } else {
  //     ctxt.logger.info(`Found DBOS Auth ID: ${dbosAuthID}`);
  //   }
  // }
}