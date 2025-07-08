export async function up(knex) {
  await knex.schema.createTable('accounts', table => {
    table.text('auth0_subject_id').primary();
    table.text('email').notNullable();
    table.text('stripe_customer_id').notNullable();
    table.bigInteger('created_at')
            .notNullable()
            .defaultTo(knex.raw('(EXTRACT(EPOCH FROM now())*1000)::bigint'));
    table.bigInteger('updated_at')
            .notNullable()
            .defaultTo(knex.raw('(EXTRACT(EPOCH FROM now())*1000)::bigint'));
    table.index('stripe_customer_id');
  });
};

export async function down(knex) {
  return knex.schema.dropTable('accounts');
};
