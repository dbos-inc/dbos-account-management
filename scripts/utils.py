import json
import os
import subprocess

import requests

from config import config

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

def login(path: str, is_deploy: bool = False):
    # Perform an automated login using the Resource Owner Password Flow
    # https://auth0.com/docs/get-started/authentication-and-authorization-flow/resource-owner-password-flow
    auth0_domain = 'login.dbos.dev' if config.dbos_domain == 'cloud.dbos.dev' else 'dbos-inc.us.auth0.com'
    username = config.deploy_email if is_deploy else config.test_email
    password = config.deploy_password if is_deploy else config.dbos_test_password
    audience = 'dbos-cloud-api'
    client_id = 'LJlSE9iqRBPzeonar3LdEad7zdYpwKsW' if config.dbos_domain == 'cloud.dbos.dev' else 'XPMrfZwUL6O8VZjc4XQWEUHORbT1ykUm'
    client_secret = config.client_secret

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
    dbos_username = config.deploy_username if is_deploy else config.test_username
    os.makedirs(os.path.join(path, '.dbos'), exist_ok=True)
    with open(os.path.join(path, '.dbos', 'credentials'), 'w') as file:
        json.dump({'userName': dbos_username, 'token': access_token}, file)
