const config = {
  client: 'pg',
  connection: process.env.DBOS_DATABASE_URL || `postgresql://postgres:${process.env.PGPASSWORD || 'dbos'}@localhost:5432/dbos`,
  migrations: {
    directory: './migrations'
  }
};

export default config;
