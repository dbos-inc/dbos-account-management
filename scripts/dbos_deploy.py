# This script is used to automatically deploy this subscription app to DBOS Cloud
import subprocess
import string
import zipfile
import requests
import random
import os
import json
import stat
import shutil

script_dir = os.path.dirname(os.path.abspath(__file__))
app_dir = os.path.join(script_dir, "..")

DBOS_DOMAIN = os.environ.get('DBOS_DOMAIN')
if not DBOS_DOMAIN:
    raise Exception("DBOS_DOMAIN not set")

CLIENT_SECRET = os.environ['DBOS_AUTH0_CLIENT_SECRET']
if not CLIENT_SECRET:
    raise Exception("DBOS_AUTH0_CLIENT_SECRET not set")

DEPLOY_PASSWORD = os.environ['DBOS_DEPLOY_PASSWORD']
if not DEPLOY_PASSWORD:
    raise Exception("DBOS_DEPLOY_PASSWORD not set")

DEPLOY_USERNAME = 'subscribe'
DB_NAME = os.environ['DBOS_APP_DB_NAME']
if not DB_NAME:
    raise Exception("DBOS_APP_DB_NAME not set")

def login(path: str):
    # Perform an automated login using the Resource Owner Password Flow
    # https://auth0.com/docs/get-started/authentication-and-authorization-flow/resource-owner-password-flow
    auth0_domain = 'login.dbos.dev' if DBOS_DOMAIN == 'cloud.dbos.dev' else 'dbos-inc.us.auth0.com'
    username = 'dbos-cloud-subscription@dbos.dev'
    password = DEPLOY_PASSWORD
    audience = 'dbos-cloud-api'
    client_id = 'LJlSE9iqRBPzeonar3LdEad7zdYpwKsW' if DBOS_DOMAIN == 'cloud.dbos.dev' else 'XPMrfZwUL6O8VZjc4XQWEUHORbT1ykUm'
    client_secret = CLIENT_SECRET

    url = f'https://{auth0_domain}/oauth/token'

    data = {
        'grant_type': 'password',
        'username': username,
        'password': password,
        'audience': audience,
        'scope': 'read:sample',
        'client_id': client_id,
        'client_secret': client_secret
    }

    headers = {
        'content-type': 'application/x-www-form-urlencoded'
    }

    response = requests.post(url, headers=headers, data=data)
    access_token = response.json().get('access_token', '')
    os.makedirs(os.path.join(path, '.dbos'), exist_ok=True)
    with open(os.path.join(path, '.dbos', 'credentials'), 'w') as file:
        json.dump({'userName': DEPLOY_USERNAME, 'token': access_token}, file)

def deploy(path: str):
    output = run_subprocess(['npx', 'dbos-cloud', 'database', 'status', DB_NAME], path, check=False)
    if "error" in output:
        raise Exception(f"Database {DB_NAME} errored!")

    run_subprocess(['npx', 'dbos-cloud', 'applications', 'register', '--database', DB_NAME], path, check=False)
    run_subprocess(['npx', 'dbos-cloud', 'applications', 'deploy'], path)

def run_subprocess(command, path: str, check: bool = True, silent: bool = False):
    process = subprocess.Popen(command, cwd=path, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    output = ""
    for line in iter(process.stdout.readline, ''):
        if not silent:
            print(line, end='')
        output += line
    process.wait()
    process.stdout.close()
    if check and process.returncode != 0:
        raise Exception(f"Command {command} failed with return code {process.returncode}. Output {output}")
    return output

if __name__ == "__main__":
    login(app_dir)
    print("Successfully login to DBOS Cloud, deploying app...")

    deploy(app_dir)
    print("Successfully deployed app to DBOS Cloud")