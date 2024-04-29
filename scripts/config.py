import os

class Config:
    def __init__(self):
        self.dbos_domain = os.getenv('DBOS_DOMAIN', 'staging.dev.dbos.dev')
        if 'DBOS_DOMAIN' not in os.environ:
            os.environ['DBOS_DOMAIN'] = self.dbos_domain
        self.deploy_refresh_token = os.environ['DBOS_DEPLOY_REFRESH_TOKEN']
        if not self.deploy_refresh_token:
            raise Exception('DBOS_DEPLOY_REFRESH_TOKEN not set')
        self.test_refresh_token = os.environ['DBOS_TEST_REFRESH_TOKEN']
        if not self.test_refresh_token:
            raise Exception('DBOS_TEST_REFRESH_TOKEN not set')
        self.db_name = os.environ['DBOS_APP_DB_NAME']
        if not self.db_name:
            raise Exception('DBOS_APP_DB_NAME not set')
        self.stripe_pro_price = os.environ['STRIPE_DBOS_PRO_PRICE']
        if not self.stripe_pro_price:
            raise Exception('STRIPE_DBOS_PRO_PRICE not set')
        self.stripe_secret_key = os.environ['STRIPE_SECRET_KEY']
        if not self.stripe_secret_key:
            raise Exception('STRIPE_SECRET_KEY not set')
        self.test_username = "testsubscription"
        self.deploy_username = "subscribe"

config = Config()
