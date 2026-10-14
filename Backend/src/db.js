// db.js — shared PostgreSQL connection pool
const { Pool } = require('pg');
require('dotenv').config();

// Neon requires SSL, but a local Postgres (development/testing) does not.
// Set PGSSL=disable, or point DATABASE_URL at localhost, to turn SSL off.
const url = process.env.DATABASE_URL || '';
const isLocal = /@(localhost|127\.0\.0\.1)|host=\/|^postgres(ql)?:\/\/[^@]*\/?\?host=/.test(url);
const useSsl = process.env.PGSSL !== 'disable' && !isLocal;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});

module.exports = pool;
