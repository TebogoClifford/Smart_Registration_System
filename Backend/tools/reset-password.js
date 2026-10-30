const pool = require('./db');
const auth = require('./auth');
const crypto = require('crypto');

async function resetPassword(email, newPassword) {
  try {
    const hashed = await auth.hashPassword(newPassword);
    const result = await pool.query(
      'UPDATE users SET password_hash = $1 WHERE email = $2 RETURNING id',
      [hashed, email.toLowerCase()]
    );
    if (result.rows.length === 0) {
      console.error(`Error: User with email ${email} not found.`);
      process.exit(1);
    }
    console.log(`✅ Password successfully reset for ${email}`);
  } catch (err) {
    console.error('Unexpected error during password reset:', err);
    process.exit(1);
  }
}

const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.log('Usage: node tools/reset-password.js <email> <new-password>');
  process.exit(1);
}

resetPassword(email, password);
