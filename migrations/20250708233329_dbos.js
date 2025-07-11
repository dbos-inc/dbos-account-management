import { KnexDataSource } from '@dbos-inc/knex-datasource';

export async function up(knex) {
  await KnexDataSource.initializeDBOSSchema(knex);
}

export async function down(knex) {
  await KnexDataSource.uninitializeDBOSSchema(knex);
}
