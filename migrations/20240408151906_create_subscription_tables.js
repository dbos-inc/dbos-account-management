const { Knex } = require("knex");

exports.up = async function(knex) {
  await knex.schema.createTable('subscriptions', table => {
    table.text('auth0_user_id').primary();
    table.text('stripe_customer_id').notNullable();
    table.text('dbos_plan').notNullable().defaultTo('free');
    table.bigInteger('created_at')
            .notNullable()
            .defaultTo(knex.raw('(EXTRACT(EPOCH FROM now())*1000)::bigint'));
    table.bigInteger('updated_at')
            .notNullable()
            .defaultTo(knex.raw('(EXTRACT(EPOCH FROM now())*1000)::bigint'));
  });
};

exports.down = async function(knex) {
  return knex.schema.dropTable('subscriptions');
};
