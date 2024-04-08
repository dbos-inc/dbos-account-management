import { DBOSResponseError } from "@dbos-inc/dbos-sdk";
import Stripe from "stripe";

export async function retrieveStripeCustomer(stripe: Stripe, authUser: string): Promise<string> {
  // Look up customer from stripe
  const customers = await stripe.customers.search({
    query: `metadata["auth0_user_id"]:"${authUser}"`,
  });

  let customerID = "";
  if (customers.data.length === 1) {
    customerID = customers.data[0].id;
  } else {
    throw new DBOSResponseError("Failed to look up customer from stripe", 400);
  }
  return customerID;
}