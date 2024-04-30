# This script is used to automatically deploy this subscription app to DBOS Cloud
import os
from utils import (login, run_subprocess, generate_password)
from config import config

script_dir = os.path.dirname(os.path.abspath(__file__))
app_dir = os.path.join(script_dir, "..")

def deploy(path: str):
    output = run_subprocess(['npx', 'dbos-cloud', 'db', 'status', config.db_name], path, check=False)
    if "error" in output:
        # Provision a database
        run_subprocess(['npx', 'dbos-cloud', 'db', 'provision', config.db_name, '-U', config.deploy_username, '-W', generate_password()], path)
    run_subprocess(['npx', 'dbos-cloud', 'app', 'register', '--database', config.db_name], path, check=False)
    run_subprocess(['npx', 'dbos-cloud', 'app', 'deploy'], path)

if __name__ == "__main__":
    login(app_dir, is_deploy=True)
    print("Successfully login to DBOS Cloud, deploying app...")

    deploy(app_dir)
    print("Successfully deployed app to DBOS Cloud")