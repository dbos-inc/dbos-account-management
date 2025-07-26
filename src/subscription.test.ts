import { FastifyInstance } from 'fastify';
import { DBOS } from '@dbos-inc/dbos-sdk';
import knex from 'knex';
import path from 'path';

import { buildEndpoints, findAuth0UserID, findStripeCustomerID, recordStripeCustomer, Utils } from './subscription.js';

describe('subscription-tests', () => {
  let fastify: FastifyInstance;

  beforeAll(async () => {
    // Set up the database
    if (!process.env.DBOS_DATABASE_URL) {
      console.error('DBOS_DATABASE_URL not set!');
      process.exit(1);
    }
    const connectionString = new URL(process.env.DBOS_DATABASE_URL);
    const appDBName = connectionString.pathname.split('/')[1];
    connectionString.pathname = '/postgres'; // Set the default database to 'postgres' for initial connection
    const cwd = process.cwd();
    const knexConfig = {
      client: 'pg',
      connection: connectionString.toString(),
      migrations: {
        directory: path.join(cwd, 'migrations'),
        tableName: 'knex_migrations',
      },
    };
    let knexDB = knex(knexConfig);
    try {
      // Clean up app DB
      await knexDB.raw(`DROP DATABASE IF EXISTS "${appDBName}" WITH (FORCE);`);
      await knexDB.raw(`CREATE DATABASE "${appDBName}";`);
      // Clean up system DB
      await knexDB.raw(`DROP DATABASE IF EXISTS "${appDBName}_dbos_sys" WITH (FORCE);`);
      await knexDB.raw(`CREATE DATABASE "${appDBName}_dbos_sys";`);
    } finally {
      await knexDB.destroy();
    }

    connectionString.pathname = `/${appDBName}`;
    knexConfig.connection = connectionString.toString();
    knexDB = knex(knexConfig);
    try {
      await knexDB.migrate.latest();
    } finally {
      await knexDB.destroy();
    }

    // Set up the Fastify server and DBOS
    fastify = await buildEndpoints();
    DBOS.setConfig({
      name: 'dbos',
      databaseUrl: connectionString.toString(),
    });
    await DBOS.launch();
  });

  afterAll(async () => {
    await DBOS.shutdown();
    await fastify.close();
  });

  test('account-management', async () => {
    // Check our transactions are correct
    const auth0TestID = 'testauth0123';
    const stripeTestID = 'teststripe123';
    const testEmail = 'testemail@dbos.dev';
    await expect(recordStripeCustomer(auth0TestID, stripeTestID, testEmail)).resolves.toBeFalsy(); // No error
    await expect(findStripeCustomerID(auth0TestID)).resolves.toBe(stripeTestID);
    await expect(findAuth0UserID(stripeTestID)).resolves.toBe(auth0TestID);
    await expect(findAuth0UserID('nonexistent')).rejects.toThrow(
      'Cannot find auth0 user for stripe customer nonexistent',
    ); // Non existent user
  });

  test('subscribe-cors', async () => {
    // Check the prefligth request has the correct CORS headers
    fastify.inject(
      {
        method: 'OPTIONS',
        url: '/subscribe',
        headers: {
          Origin: 'https://dbos.dev',
          'Access-Control-Request-Method': 'POST',
          Authorization: 'Bearer testtoken',
        },
      },
      (err, resp) => {
        expect(err).toBeFalsy();
        expect(resp).toBeDefined();
        expect(resp!.statusCode).toBe(204);
        expect(resp!.headers['access-control-allow-origin']).toBe('https://dbos.dev');
        expect(resp!.headers['access-control-allow-credentials']).toBe('true');
      },
    );

    // Our staging env.
    fastify.inject(
      {
        method: 'OPTIONS',
        url: '/subscribe',
        headers: {
          Origin: 'https://dbos.webflow.io',
          'Access-Control-Request-Method': 'POST',
          Authorization: 'Bearer testtoken',
        },
      },
      (err, resp) => {
        expect(err).toBeFalsy();
        expect(resp).toBeDefined();
        expect(resp!.statusCode).toBe(204);
        expect(resp!.headers['access-control-allow-origin']).toBe('https://dbos.webflow.io');
        expect(resp!.headers['access-control-allow-credentials']).toBe('true');
      },
    );

    // Cloud console
    fastify.inject(
      {
        method: 'OPTIONS',
        url: '/subscribe',
        headers: {
          Origin: 'https://console.dbos.dev',
          'Access-Control-Request-Method': 'POST',
          Authorization: 'Bearer testtoken',
        },
      },
      (err, resp) => {
        expect(err).toBeFalsy();
        expect(resp).toBeDefined();
        expect(resp!.statusCode).toBe(204);
        expect(resp!.headers['access-control-allow-origin']).toBe('https://console.dbos.dev');
        expect(resp!.headers['access-control-allow-credentials']).toBe('true');
      },
    );

    fastify.inject(
      {
        method: 'OPTIONS',
        url: '/subscribe',
        headers: {
          Origin: 'https://staging.console.dbos.dev',
          'Access-Control-Request-Method': 'POST',
          Authorization: 'Bearer testtoken',
        },
      },
      (err, resp) => {
        expect(err).toBeFalsy();
        expect(resp).toBeDefined();
        expect(resp!.statusCode).toBe(204);
        expect(resp!.headers['access-control-allow-origin']).toBe('https://staging.console.dbos.dev');
        expect(resp!.headers['access-control-allow-credentials']).toBe('true');
      },
    );
  });

  // Test retrieve cloud credentials
  test('cloud-credential', async () => {
    if (!process.env.DBOS_LOGIN_REFRESH_TOKEN || process.env.DBOS_LOGIN_REFRESH_TOKEN == 'null') {
      console.log('Skipping cloud-credentials test, no refresh token provided');
      return;
    }
    await expect(Utils.retrieveAccessToken()).resolves.toBeTruthy();
    process.env['DBOS_LOGIN_REFRESH_TOKEN'] = 'faketoken';
    await expect(Utils.retrieveAccessToken()).rejects.toThrow();
  });
});
