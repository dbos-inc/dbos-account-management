# This script is used to automatically deploy this subscription app to DBOS Cloud
import os
from utils import (login, run_subprocess)
from config import config

script_dir = os.path.dirname(os.path.abspath(__file__))
app_dir = os.path.join(script_dir, "..")


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
    

if __name__ == "__main__":
    login(app_dir, is_deploy=False)
    print("Successfully login to DBOS Cloud")

    test_endpoints(app_dir)
    print("Successfully tested endpoints on DBOS Cloud")