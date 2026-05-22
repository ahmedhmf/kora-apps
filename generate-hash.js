/**
 * Password Hash Generator
 * 
 * Run: node generate-hash.js
 * 
 * It will prompt you for a password, hash it with bcrypt,
 * and print the hash for you to paste into your .env file
 * as ADMIN_PASSWORD_HASH.
 */

const bcrypt = require('bcrypt');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question('Enter admin password to hash: ', async (password) => {
  if (!password || password.trim().length < 8) {
    console.error('❌ Password must be at least 8 characters.');
    rl.close();
    process.exit(1);
  }

  const hash = await bcrypt.hash(password.trim(), 12);
  console.log('\n✅ Bcrypt hash generated. Copy this into your .env file:\n');
  console.log(`ADMIN_PASSWORD_HASH=${hash}\n`);

  rl.close();
});
