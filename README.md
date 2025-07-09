# DBOS Cloud Account Management

This repository contains code for the DBOS Cloud account management app, which is built with [DBOS Transact](https://github.com/dbos-inc/dbos-transact) and [Stripe](https://stripe.com/) and deployed on [DBOS Cloud](https://www.dbos.dev/).

## Overview

When a customer clicks "Upgrade to DBOS Pro" on the [DBOS website](https://www.dbos.dev/pricing), this app redirects them to a customized Stripe checkout page, where they enter payment information. After they pay, Stripe sends a notification to a webhook endpoint on this app. The webhook retrieves the customer's updated subscription status from Stripe, maps their Stripe customer ID to a DBOS Cloud account ID, and updates their subscription status in DBOS Cloud.

This repo demonstrates a complete production DBOS application, including cloud deployment and CI/CD, written in <500 lines of code. Specifically, it highlights:

- Use of DBOS workflows, transactions, and communicators for reliable, exactly-once execution
- Asynchronous and reliable event processing for [Stripe Webhook](https://docs.stripe.com/webhooks)
- Integration with [Stripe Billing](https://stripe.com/billing) and the [Stripe Customer Portal](https://docs.stripe.com/customer-management)
- Integration with [Auth0](https://auth0.com/) for authentication and authorization
- Using [Knex.js](https://knexjs.org/) for schema management and queries
- Automated testing and deployment with the DBOS CLI and [GitHub Actions](https://github.com/features/actions)
- Unit tests for individual functions and endpoints with [jest](https://jestjs.io/).

## Code Layout

The main source code files:

- `src/`
  - `endpoints.ts` HTTP endpoints
  - `subscription.ts` Workflows, transactions, and communicators for subscriptions
  - `subscription.test.ts` Unit tests
- `dbos-config.yaml` DBOS configuration file
- `migrations/` Schema definition in Knex.js format

Files for CI/CD:

- `scripts/`
  - `dbos_deploy.sh` Script that deploys this app to DBOS Cloud
  - `subscription_integration_test.py` Automated integration test for subscription that runs against staging and prod
- `.github/workflows/` Github Actions for deployment and testing
