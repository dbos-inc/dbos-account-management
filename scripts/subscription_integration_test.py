import json
import os
import time

import requests
from utils import (login, run_subprocess, get_credentials)
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

    # Test the subscribe endpoint
    credentials = get_credentials(path)
    token = credentials['token']
    url = f"https://subscribe-{config.dbos_app_name}.cloud.dbos.dev/subscribe"
    headers = {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json'
    }
    data = {
        'plan': 'dbospro'
    }
    res = requests.post(url, headers=headers, data=json.dumps(data))
    assert res.status_code == 200, f"Cloud subscribe endpoint failed: {res.status_code} - {res.text}"

    # Test customer portal endpoint
    url = f"https://subscribe-{config.dbos_app_name}.cloud.dbos.dev/create-customer-portal"
    headers = {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json'
    }
    res = requests.post(url, headers=headers)
    assert res.status_code == 200, f"Cloud create-customer-portal endpoint failed: {res.status_code} - {res.text}"

    # Look up customer ID
    customers = stripe.Customer.list(email=config.test_email, limit=1)
    if len(customers) == 0:
        raise Exception("No Stripe customer found for test email")
    customer_id = customers.data[0].id
    
    # Create a subscription that sets a trial that ends in 1 day.
    subscription = stripe.Subscription.create(
        customer=customer_id,
        items=[{"price": config.stripe_pro_price}],
        trial_period_days=1,
        trial_settings={"end_behavior": {"missing_payment_method": "cancel"}},
    )

    time.sleep(30) # Wait for subscription to take effect
    hasFailure = False
    output = run_subprocess(['npx', 'dbos-cloud', 'profile', '--json'], path, check=True)
    json_data = json.loads(output)
    if json_data['SubscriptionPlan'] != "pro":
        hasFailure = True
        print("Pro tier check failed")

    # Cancel the subscription and check we're free tier again
    stripe.Subscription.cancel(subscription.id)
    time.sleep(30) # Wait for subscription to take effect
    output = run_subprocess(['npx', 'dbos-cloud', 'profile', '--json'], path, check=True)
    json_data = json.loads(output)
    if json_data['SubscriptionPlan'] != "free":
        hasFailure = True
        print("Free tier check failed")

    return hasFailure

if __name__ == "__main__":
    login(app_dir, is_deploy=False)
    print("Successfully login to DBOS Cloud")

    hasFailure = test_endpoints(app_dir)
    if hasFailure:
        raise Exception("Failed to test endpoints on DBOS Cloud")
    print("Successfully tested endpoints on DBOS Cloud")