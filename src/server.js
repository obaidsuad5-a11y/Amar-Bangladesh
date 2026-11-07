require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const { Poll, Vote, News } = require('./models');
const { requireAuth, allowRoles } = require('./middleware');

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const newsRoutes = require('./routes/newsRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();
const PORT = process.env.PORT || 5000;
app.disable('x-powered-by');

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(compression());
app.use(cors({ origin: process.env.CLIENT_ORIGIN ? process.env.CLIENT_ORIGIN.split(',') : true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
app.use(express.static(path.join(__dirname, '..', 'public')));

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 250, standardHeaders: 'draft-7', legacyHeaders: false });
app.use('/api', apiLimiter);

// Route Modules
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api', newsRoutes);
app.use('/api', adminRoutes);

const cleanText = (v, max = 500) => String(v ?? '').replace(/<[^>]*>/g, '').trim().slice(0, max);
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const publicOrigin = () => (process.env.PUBLIC_URL || process.env.CLIENT_ORIGIN || `http://localhost:${PORT}`).split(',')[0].replace(/\/$/, '');

// File upload setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + path.extname(file.originalname).toLowerCase())
});
const upload = multer({
  storage, limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype);
    cb(ok ? null : new Error('Only JPG, PNG, WEBP and GIF images are allowed'), ok);
  }
});

app.post('/api/uploads', requireAuth, allowRoles('admin', 'editor', 'reporter'), upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Image is required' });
  res.status(201).json({ url: `/uploads/${req.file.filename}` });
});

const cloudUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 }, fileFilter: (req, file, cb) => cb(['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype) ? null : new Error('Unsupported image type'), ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype)) });
app.post('/api/uploads/cloud', requireAuth, allowRoles('admin', 'editor', 'reporter'), cloudUpload.single('image'), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Image required' });
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    return res.status(503).json({ message: 'Cloudinary is not configured; use local upload endpoint' });
  }
  const cloudinary = require('cloudinary').v2;
  cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET });
  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder: 'amar-bangladesh' }, (err, out) => err ? reject(err) : resolve(out));
    stream.end(req.file.buffer);
  });
  res.status(201).json({ url: result.secure_url, publicId: result.public_id, provider: 'cloudinary' });
}));

// Polls
app.get('/api/polls/active', asyncRoute(async (req, res) => res.json(await Poll.findOne({ active: true }).sort({ createdAt: -1 }).lean())));
app.post('/api/polls/:id/vote', asyncRoute(async (req, res) => {
  const poll = await Poll.findOne({ _id: req.params.id, active: true });
  const idx = Number(req.body.optionIndex);
  if (!poll || !Number.isInteger(idx) || idx < 0 || idx >= poll.options.length) return res.status(400).json({ message: 'Invalid poll or option' });
  const voterKey = crypto.createHash('sha256').update(String(req.ip) + ':' + cleanText(req.body.voterKey, 100)).digest('hex');
  try { await Vote.create({ poll: poll.id, voterKey, optionIndex: idx }); }
  catch { return res.status(409).json({ message: 'You have already voted in this poll' }); }
  poll.options[idx].votes += 1;
  await poll.save();
  res.json(poll);
}));
app.post('/api/polls', requireAuth, allowRoles('admin', 'editor'), asyncRoute(async (req, res) => {
  const options = Array.isArray(req.body.options) ? req.body.options.slice(0, 6).map(x => ({ label: cleanText(x, 100), votes: 0 })).filter(x => x.label) : [];
  if (!req.body.question || options.length < 2) return res.status(400).json({ message: 'Question and at least two options are required' });
  await Poll.updateMany({}, { active: false });
  res.status(201).json(await Poll.create({ question: cleanText(req.body.question, 240), options, active: true }));
}));

// System & Health
app.get('/api/health', (req, res) => res.json({ status: 'ok', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected', time: new Date().toISOString() }));
app.get('/manifest.webmanifest', (req, res) => res.type('application/manifest+json').send(JSON.stringify({ name: 'Amar Bangladesh', short_name: 'Amar BD', start_url: '/', display: 'standalone', background_color: '#f3f7f5', theme_color: '#087653' })));
app.get('/robots.txt', (req, res) => res.type('text').send('User-agent: *\nAllow: /\nSitemap: /sitemap.xml'));
app.get('/sitemap.xml', asyncRoute(async (req, res) => {
  const items = await News.find({ status: 'published' }).select('_id updatedAt').limit(5000).lean();
  const base = publicOrigin();
  const urls = items.map(n => `<url><loc>${base}/?article=${n._id}</loc><lastmod>${new Date(n.updatedAt).toISOString()}</lastmod></url>`).join('');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
}));

// Global Error Handler
app.use((err, req, res, next) => {
  console.error(err);
  if (err instanceof multer.MulterError) return res.status(400).json({ message: err.message });
  res.status(err.status || 500).json({ message: process.env.NODE_ENV === 'production' ? 'Server error' : err.message || 'Server error' });
});

async function start() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('Set JWT_SECRET (at least 32 characters) in .env');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/amar_bangladesh_news');
  app.listen(PORT, () => console.log(`Amar Bangladesh running at http://localhost:${PORT}`));
}
start().catch(err => { console.error('Startup failed:', err.message); process.exit(1); });
