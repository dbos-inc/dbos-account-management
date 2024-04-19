# This script is used to automatically deploy this subscription app to DBOS Cloud
import os
from utils import (login, run_subprocess)
from config import config
import stripe

script_dir = os.path.dirname(os.path.abspath(__file__))
app_dir = os.path.join(script_dir, "..")
stripe.api_key = config.stripe_secret_key

def test_endpoints(path: str):
    print("Testing endpoints on DBOS Cloud...")
    # Register on DBOS Cloud
    run_subprocess(['npx', 'dbos-cloud', 'register', '-u', config.test_username], path, check=False)
    login(path, is_deploy=False) # Login again because register command logs out
    run_subprocess(['npx', 'dbos-cloud', 'db', 'list'], path, check=True)
    output = run_subprocess(['npx', 'dbos-cloud', 'db', 'link', 'testlinkdb', '-H', 'localhost', '-W', 'fakepassword'], path, check=False)
    # TODO: add a real user subscription status check.
    if not "database linking is only available for paying users" in output:
        raise Exception("Free tier check failed")

    # Now, create a subscription through stripe
    customers = stripe.Customer.list(email=config.test_email, limit=1)
    if len(customers) == 0:
        raise Exception("No Stripe customer found for test email")
    customer_id = customers.data[0].id
    print(f"Customer ID: {customer_id}")
    
    subscription = stripe.Subscription.create(
        customer=customer_id,
        items=[{"price": config.stripe_pro_price}],
    )
    print(f"Subscription ID: {subscription.id}")

if __name__ == "__main__":
    login(app_dir, is_deploy=False)
    print("Successfully login to DBOS Cloud")

    test_endpoints(app_dir)
    print("Successfully tested endpoints on DBOS Cloud")