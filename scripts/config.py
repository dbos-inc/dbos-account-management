import os

class Config:
    def __init__(self):
        self.dbos_domain = os.getenv('DBOS_DOMAIN', 'staging.dev.dbos.dev')
        if 'DBOS_DOMAIN' not in os.environ:
            os.environ['DBOS_DOMAIN'] = self.dbos_domain
        self.test_username = "testsubscription"
        self.test_email = "dbos-test-subscription@dbos.dev"
        self.deploy_username = "subscribe"
        self.deploy_email = "dbos-cloud-subscription@dbos.dev"
        self.client_secret = os.environ['DBOS_AUTH0_CLIENT_SECRET']
        if not self.client_secret:
            raise Exception('DBOS_AUTH0_CLIENT_SECRET not set')
        self.dbos_test_password = os.environ['DBOS_TEST_PASSWORD']
        if not self.dbos_test_password:
            raise Exception('DBOS_TEST_PASSWORD not set')
        self.stripe_secret_key = os.environ['STRIPE_SECRET_KEY']
        if not self.stripe_secret_key:
            raise Exception('STRIPE_SECRET_KEY not set')
        self.deploy_password = os.environ['DBOS_DEPLOY_PASSWORD']
        if not self.deploy_password:
            raise Exception('DBOS_DEPLOY_PASSWORD not set')
        self.db_name = os.environ['DBOS_APP_DB_NAME']
        if not self.db_name:
            raise Exception('DBOS_APP_DB_NAME not set')

config = Config()
