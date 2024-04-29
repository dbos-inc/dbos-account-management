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
    # Automated login using the refresh token
    refresh_token = config.deploy_refresh_token if is_deploy else config.test_refresh_token
    run_subprocess(['npx', 'dbos-cloud', 'login', '--with-refresh-token', refresh_token], path, check=True)
