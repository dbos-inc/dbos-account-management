import os

class Config:
    def __init__(self):
        dbos_domain = os.getenv('DBOS_DOMAIN', 'cloud.dbos.dev')
        print("DBOS_DOMAIN: ", dbos_domain)
        self.dbos_app_name = os.environ['DBOS_APP_NAME']
        if not self.dbos_app_name:
            raise Exception('DBOS_APP_NAME not set')
        self.test_refresh_token = os.environ['DBOS_TEST_REFRESH_TOKEN']
        if not self.test_refresh_token:
            raise Exception('DBOS_TEST_REFRESH_TOKEN not set')
        self.stripe_pro_price = os.environ['STRIPE_DBOS_PRO_PRICE']
        if not self.stripe_pro_price:
            raise Exception('STRIPE_DBOS_PRO_PRICE not set')
        self.stripe_secret_key = os.environ['STRIPE_SECRET_KEY']
        if not self.stripe_secret_key:
            raise Exception('STRIPE_SECRET_KEY not set')
        self.test_username = "testsubscription"
        self.deploy_username = "subscribe"
        self.test_email = "dbos-test-subscription@dbos.dev"

config = Config()
