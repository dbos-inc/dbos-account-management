import { DBOS } from '@dbos-inc/dbos-sdk';
import { buildEndpoints } from './subscription.js';

async function main() {
  const fastify = await buildEndpoints();
  const PORT = Number(process.env.PORT || 3000);
  if (!process.env.DBOS_DATABASE_URL) {
    console.error('DBOS_DATABASE_URL not set!');
    process.exit(1);
  }
  const connectionString = new URL(process.env.DBOS_DATABASE_URL);
  const appDBName = connectionString.pathname.split('/')[1];
  connectionString.pathname = `${appDBName}_dbos_sys`; // Set the system database to 'appDBName_dbos_sys'
  DBOS.setConfig({
    name: 'dbos',
    systemDatabaseUrl: connectionString.toString(),
  });
  await DBOS.launch();
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
}

main().catch(console.log);
