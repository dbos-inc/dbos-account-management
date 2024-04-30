/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Communicator, CommunicatorContext, DBOSResponseError, MiddlewareContext, Transaction, TransactionContext, Workflow, WorkflowContext } from "@dbos-inc/dbos-sdk";
import Stripe from "stripe";
import { Knex } from 'knex';
import axios from 'axios';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

const DBOS_DOMAIN = process.env.DBOS_DOMAIN;
export const DBOSLoginDomain = DBOS_DOMAIN === "cloud.dbos.dev" ? "login.dbos.dev" : "dbos-inc.us.auth0.com";
const DBOS_DEPLOY_REFRESH_TOKEN = process.env.DBOS_DEPLOY_REFRESH_TOKEN;
// eslint-disable-next-line no-secrets/no-secrets
const DBOSAuth0ClientID = DBOS_DOMAIN === 'cloud.dbos.dev' ? '6p7Sjxf13cyLMkdwn14MxlH7JdhILled' : 'G38fLmVErczEo9ioCFjVIHea6yd0qMZu';
const DBOSProStripePrice = process.env.STRIPE_DBOS_PRO_PRICE ?? "";

let dbosAuth0Token: string;

export class Utils {
  // eslint-disable-next-line @typescript-eslint/require-await
  static async userAuthMiddleware(ctxt: MiddlewareContext) {
    if (ctxt.requiredRole.length > 0) {
      if (!ctxt.koaContext.state.user) {
        throw new DBOSResponseError("No authenticated DBOS User!", 401);
      }
      const authenticatedUser = ctxt.koaContext.state.user["sub"] as string;
      if (!authenticatedUser) {
        throw new DBOSResponseError("No valid DBOS user found!", 401);
      }
      const userEmail = ctxt.koaContext.state.user["https://dbos.dev/email"] as string;
      if (!userEmail) {
        throw new DBOSResponseError("No email found for the authenticated user", 400);
      }
      return { authenticatedRoles: ['user'], authenticatedUser: authenticatedUser };
    }
  }

  @Workflow()
  static async stripeWebhookWorkflow(ctxt: WorkflowContext, subscriptionID: string, customerID: string) {
    // Retrieve the updated subscription from Stripe
    const subscription = await ctxt.invoke(Utils).retrieveSubscription(subscriptionID);
    if (subscription.price !== DBOSProStripePrice) {
      throw new Error(`Unknown price: ${subscription.price}; customer ${customerID}; subscription ${subscriptionID}`);
    }

    // Map the Stripe customer ID to DBOS Cloud user ID
    const dbosAuthID = await ctxt.invoke(Utils).findAuth0UserID(customerID);
    if (!dbosAuthID) {
      throw new Error(`Cannot find auth0 user for stripe customer ${customerID}`);
    }

    // Send a request to the DBOS Cloud admin API to change the user's subscription status.
    switch (subscription.status) {
      case 'active':
      case 'trialing':
        await ctxt.invoke(Utils).updateCloudEntitlement(dbosAuthID, 'pro');
        break;
      case 'canceled':
      case 'unpaid':
      case 'paused':
        await ctxt.invoke(Utils).updateCloudEntitlement(dbosAuthID, 'free');
        break;
      default:
        ctxt.logger.info(`Do nothing for ${subscription.status} status.`);
    }
  }

  @Workflow()
  static async createSubscription(ctxt: WorkflowContext, auth0UserID: string, userEmail: string): Promise<string|null> {
    // First, look up the customer from the accounts table
    let stripeCustomerID = await ctxt.invoke(Utils).findStripeCustomerID(auth0UserID);

    // If customer is not found, create a new customer in stripe, and record in our database
    if (!stripeCustomerID) {
      stripeCustomerID = await ctxt.invoke(Utils).createStripeCustomer(auth0UserID, userEmail);
      await ctxt.invoke(Utils).recordStripeCustomer(auth0UserID, stripeCustomerID, userEmail);
    }

    // Finally, create a Stripe subscription.
    const res = await ctxt.invoke(Utils).createStripeCheckout(stripeCustomerID);
    return res;
  }

  @Workflow()
  static async createStripeCustomerPortal(ctxt: WorkflowContext, auth0UserID: string): Promise<string|null> {
    const stripeCustomerID = await ctxt.invoke(Utils).findStripeCustomerID(auth0UserID);
    if (!stripeCustomerID) {
      ctxt.logger.error(`Cannot find stripe customer for user ${auth0UserID}`);
      return null;
    }
    const sessionURL = await ctxt.invoke(Utils).createStripeBillingPortal(stripeCustomerID);
    return sessionURL;
  }

  /**
   * Transactions managing user accounts
   */

  @Transaction({readOnly: true})
  static async findStripeCustomerID(ctxt: TransactionContext<Knex>, auth0UserID: string): Promise<string|undefined> {
    const client = ctxt.client;
    const res = await client<Accounts>("accounts")
      .select("stripe_customer_id")
      .where("auth0_subject_id", auth0UserID).first();
    if (!res) {
      return undefined;
    }
    return res.stripe_customer_id;
  }

  @Transaction({readOnly: true})
  static async findAuth0UserID(ctxt: TransactionContext<Knex>, stripeCustomerID: string): Promise<string|undefined> {
    const client = ctxt.client;
    const res = await client<Accounts>("accounts")
      .select("auth0_subject_id")
      .where("stripe_customer_id", stripeCustomerID).first();
    if (!res) {
      return undefined;
    }
    return res.auth0_subject_id;
  }

  @Transaction()
  static async recordStripeCustomer(ctxt: TransactionContext<Knex>, auth0UserID: string, stripeCustomerID: string, email: string): Promise<void> {
    const client = ctxt.client;
    const res = await client<Accounts>("accounts")
      .insert<{ rowCount: number }>({
        auth0_subject_id: auth0UserID,
        stripe_customer_id: stripeCustomerID,
        email: email,
      }).onConflict("auth0_subject_id").ignore();
    if (res.rowCount !== 1) {
      throw new Error(`Failed to record stripe customer ${stripeCustomerID} for user ${auth0UserID}`);
    }
  }

  /**
   * Communicators interacting with Stripe
   */

  @Communicator({intervalSeconds: 10, maxAttempts: 2})
  static async createStripeBillingPortal(_ctxt: CommunicatorContext, customerID: string): Promise<string|null> {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerID,
      return_url: 'https://dbos.dev'
    });
    return session.url;
  }

  @Communicator({intervalSeconds: 10})
  static async createStripeCheckout(_ctxt: CommunicatorContext, stripeCustomerID: string): Promise<string|null> {
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerID,
      billing_address_collection: 'auto',
      line_items: [
        {
          price: DBOSProStripePrice,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `https://docs.dbos.dev`,
      cancel_url: `https://www.dbos.dev/pricing`,
    });
    return session.url;
  }

  @Communicator({intervalSeconds: 10, maxAttempts: 2})
  static async createStripeCustomer(ctxt: CommunicatorContext, auth0UserID: string, userEmail: string): Promise<string> {
    const customer = await stripe.customers.create({
      email: userEmail,
      description: "Automatically generated by DBOS",
      metadata: {
        auth0_user_id: auth0UserID,
      },
    });
    ctxt.logger.info(`Created stripe customer ${customer.id} for user ${auth0UserID}`);
    return customer.id;
  }

  @Communicator()
  static async retrieveSubscription(ctxt: CommunicatorContext, subscriptionID: string): Promise<StripeSubscription> {
    const subscription = await stripe.subscriptions.retrieve(subscriptionID);
    ctxt.logger.info(`Subscription ${subscriptionID} is ${subscription.status} for customer ${subscription.customer as string}`);
    return {
      id: subscriptionID,
      customer: subscription.customer as string,
      price: subscription.items.data[0].price.id as string,
      status: subscription.status,
    };
  }

  /**
   * Communicators interacting with DBOS Cloud
   */

  @Communicator({intervalSeconds: 10})  
  static async retrieveCloudCredential(ctxt: CommunicatorContext): Promise<string> {
    const refreshToken = DBOS_DEPLOY_REFRESH_TOKEN;
    if (!refreshToken) {
      throw new Error("No refresh token found");
    }
    const loginRequest = {
      method: 'POST',
      url: `https://${DBOSLoginDomain}/oauth/token`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      data: {
        grant_type: "refresh_token",
        client_id: DBOSAuth0ClientID,
        refresh_token: refreshToken
      },
    };
    try {
      const response = await axios.request(loginRequest);
      const tokenResponse = response.data as RefreshTokenAuthResponse;
      dbosAuth0Token = tokenResponse.access_token;
      return dbosAuth0Token;
    } catch (err) {
      ctxt.logger.error(`Failed to get access token: ${(err as Error).message}`);
      dbosAuth0Token = "";
      throw err;
    }
  }

  // This will retry the request every 10 seconds, up to 20 times, with a backoff rate of 1.2
  @Communicator({intervalSeconds: 10, maxAttempts: 20, backoffRate: 1.2})
  static async updateCloudEntitlement(ctxt: CommunicatorContext, dbosAuthID: string, plan: string) {
    const token = dbosAuth0Token;
    if (!token) {
      ctxt.logger.error("No access token found, aborting update entitlement");
      return;
    }

    // Update the user's subscription status in DBOS Cloud
    const entitlementRequest = {
      method: 'POST',
      url: `https://${DBOS_DOMAIN}/admin/v1alpha1/users/update-sub`,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        subject_id: dbosAuthID,
        subscription_plan: plan,
      }
    };
    try {
      const response = await axios.request(entitlementRequest);
      ctxt.logger.info(`Update entitlement for ${dbosAuth0Token} to plan ${plan}, response: ${response.status}`);
    } catch (err) {
      ctxt.logger.error(`Failed to update ${dbosAuth0Token} to ${plan}: ${(err as Error).message}`);
      throw err;
    }
  }
}

interface RefreshTokenAuthResponse {
  access_token: string;
  scope: string;
  expires_in: number;
  token_type: string;
}

interface Accounts {
  auth0_subject_id: string;
  email: string;
  stripe_customer_id: string;
  created_at: number;
  updated_at: number;
}

interface StripeSubscription {
  id: string;
  customer: string;
  price: string;
  status: string;
}
