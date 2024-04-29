const { Knex } = require("knex");

exports.up = async function(knex) {
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
  });
};

exports.down = async function(knex) {
  return knex.schema.dropTable('accounts');
};
