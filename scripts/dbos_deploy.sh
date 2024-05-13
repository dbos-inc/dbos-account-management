#!/bin/bash

npx dbos-cloud login --with-refresh-token ${DBOS_DEPLOY_REFRESH_TOKEN}
npx dbos-cloud db status ${DBOS_APP_DB_NAME} > /dev/null
if [[ $? -ne 0 ]]; then
  npx dbos-cloud db provision ${DBOS_APP_DB_NAME} -U subscribe -W ${DBOS_DB_PASSWORD}
fi
npx dbos-cloud app status ${DBOS_APP_NAME}
if [[ $? -ne 0 ]]; then
  npx dbos-cloud app register ${DBOS_APP_NAME} -d ${DBOS_APP_DB_NAME}
fi
npx dbos-cloud app deploy ${DBOS_APP_NAME}