require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { User } = require('./models');

(async () => {
  if (!process.env.MONGODB_URI || !process.env.JWT_SECRET) throw new Error('Copy .env.example to .env and configure database + JWT_SECRET first');
  await mongoose.connect(process.env.MONGODB_URI);
  const email = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (password.length < 10) throw new Error('ADMIN_PASSWORD must be at least 10 characters');
  const passwordHash = await bcrypt.hash(password, 12);
  await User.updateOne({ email }, { $set: { name: process.env.ADMIN_NAME || 'Portal Admin', email, passwordHash, role: 'admin', active: true } }, { upsert: true });
  console.log(`Admin account ready: ${email}`);
  await mongoose.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
