// Requires MongoDB Database Tools (mongodump) installed and on PATH.
// Usage: npm run backup
require('dotenv').config();
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
const dir = path.join(__dirname, '..', 'backups');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = path.join(dir, `amar-bangladesh-${stamp}.archive.gz`);
const child = spawn('mongodump', ['--uri', process.env.MONGODB_URI, `--archive=${out}`, '--gzip'], { stdio: 'inherit' });
child.on('error', e => { console.error('Could not start mongodump. Install MongoDB Database Tools:', e.message); process.exit(1); });
child.on('exit', code => { if (code !== 0) process.exit(code || 1); console.log(`Backup created: ${out}`); });
