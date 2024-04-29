# This script is used to automatically deploy this subscription app to DBOS Cloud
import json
import os
import time
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

    # Retrieve user profile, should be free plan
    output = run_subprocess(['npx', 'dbos-cloud', 'profile', '--json'], path, check=True)
    json_data = json.loads(output)
    if json_data['SubscriptionPlan'] != "free":
        raise Exception("Free tier check failed")

    # Look up customer ID
    customers = stripe.Customer.list(email=config.test_email, limit=1)
    if len(customers) == 0:
        raise Exception("No Stripe customer found for test email")
    customer_id = customers.data[0].id
    
    # Create a subscription that uses the default test payment
    subscription = stripe.Subscription.create(
        customer=customer_id,
        items=[{"price": config.stripe_pro_price}],
    )

    time.sleep(30) # Wait for subscription to take effect
    output = run_subprocess(['npx', 'dbos-cloud', 'profile', '--json'], path, check=True)
    json_data = json.loads(output)
    if json_data['SubscriptionPlan'] != "pro":
        raise Exception("Pro tier check failed")

    # Cancel the subscription and check we're free tier again
    stripe.Subscription.cancel(subscription.id)
    time.sleep(30) # Wait for subscription to take effect
    output = run_subprocess(['npx', 'dbos-cloud', 'profile', '--json'], path, check=True)
    json_data = json.loads(output)
    if json_data['SubscriptionPlan'] != "free":
        raise Exception("Free tier check failed")

if __name__ == "__main__":
    login(app_dir, is_deploy=False)
    print("Successfully login to DBOS Cloud")

    test_endpoints(app_dir)
    print("Successfully tested endpoints on DBOS Cloud")