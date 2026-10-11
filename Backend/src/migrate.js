// migrate.js — run with `npm run migrate`. Does the same work the server does on start-up.
const pool = require('./db');
const { ensureSchema } = require('./schema');

ensureSchema()
  .then(() => console.log('✅ Schema is up to date.'))
  .catch((err) => { console.error('❌ Migration failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
