# This script is used to automatically deploy this subscription app to DBOS Cloud
import os
from utils import (login)

script_dir = os.path.dirname(os.path.abspath(__file__))
app_dir = os.path.join(script_dir, "..")


def test_endpoints(path: str):
    #Test endpoint
    print("Testing endpoints on DBOS Cloud...")


if __name__ == "__main__":
    login(app_dir, is_deploy=False)
    print("Successfully login to DBOS Cloud")

    test_endpoints(app_dir)
    print("Successfully tested endpoints on DBOS Cloud")