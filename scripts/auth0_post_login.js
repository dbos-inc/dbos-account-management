/**
* Handler that will be called during the execution of an Auth0 PostLogin flow.
*
* @param {Event} event - Details about the user and the context in which they are logging in.
* @param {PostLoginAPI} api - Interface whose methods can be used to change the behavior of the login.
*/
exports.onExecutePostLogin = async (event, api) => {
  try {
    /**
     * Check for data integrity, if stripe_customer_id already exists, then just return
     */
    if (event.user.app_metadata.stripe_customer_id) {
      console.log(`app_metadata for new user already has stripe_customer_id property.`);
      return;
    }
    
    if (event.user.email === 'dbos-cloud-subscription@dbos.dev') {
      console.log(`skip stripe account creation for dbos-cloud-subscription user`);
      return;
    }
    
    /**
     * Initialize Stripe library
     */
    const stripe = require("stripe")(event.secrets.STRIPE_SECRET_KEY);
    
    
    /**
     * Check if existing Stripe Customer
     */
    const stripeCustomerMatchesByEmail = await stripe.customers.list({
      email: event.user.email,
    });

    if (stripeCustomerMatchesByEmail.data.length > 0) {
      // This means someone has created an account in stripe, bypassing DBOS
      const error = `Stripe Customer with email ${event.user.email} already exists.`;
      console.error(error);

      api.access.deny(
        "We could not create your payment account. Do you already have an account with the same email?\n" +
          "Please contact support for assistance."
      );
      return;
    }
    
    /**
     * Create Stripe Customer
     */
    const newStripeCustomer = await stripe.customers.create({
      email: event.user.email,
      description: "Automatically generated by an Auth0 Action",
      metadata: { auth0_user_id: event.user.user_id },
    });

    /**
     * Add Stripe Customer ID to app_metadata
     */
    api.user.setAppMetadata("stripe_customer_id", newStripeCustomer.id);
    
  } catch (error) {
    console.error(error.message);

    api.access.deny(
      "We could not login to your account.\n" +
        "Please try again or contact support for assistance."
    );
  }
};