# This script is used to automatically deploy this subscription app to DBOS Cloud
import os
from utils import (login, run_subprocess)
from config import config

script_dir = os.path.dirname(os.path.abspath(__file__))
app_dir = os.path.join(script_dir, "..")

def deploy(path: str):
    output = run_subprocess(['npx', 'dbos-cloud', 'database', 'status', config.db_name], path, check=False)
    if "error" in output:
        raise Exception(f"Database {config.db_name} errored!")

    # run_subprocess(['npx', 'dbos-cloud', 'applications', 'register', '--database', DB_NAME], path, check=False)
    run_subprocess(['npx', 'dbos-cloud', 'applications', 'deploy'], path)

if __name__ == "__main__":
    login(app_dir, is_deploy=True)
    print("Successfully login to DBOS Cloud, deploying app...")

    deploy(app_dir)
    print("Successfully deployed app to DBOS Cloud")