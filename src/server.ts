import { DBOS } from '@dbos-inc/dbos-sdk';
import { buildEndpoints } from './subscription.js';

async function main() {
  const fastify = await buildEndpoints();
  const PORT = Number(process.env.PORT || 3000);
  DBOS.setConfig({
    name: 'dbos',
    systemDatabaseUrl: `${process.env.DBOS_DATABASE_URL}_dbos_sys`,
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
