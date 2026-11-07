const express = require('express');
const router = express.Router();
const { News, Subscriber, Notification, Ad, PushSubscription } = require('../models');
const { requireAuth, allowRoles } = require('../middleware');

const cleanText = (v, max = 500) => String(v ?? '').replace(/<[^>]*>/g, '').trim().slice(0, max);
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const staff = (req, res, next) => allowRoles('admin', 'editor')(req, res, next);

// Analytics
router.get('/manage/analytics', requireAuth, staff, asyncRoute(async (req, res) => {
  const [total, published, pending, views, byCategory, top] = await Promise.all([
    News.countDocuments(),
    News.countDocuments({ status: 'published' }),
    News.countDocuments({ status: 'pending' }),
    News.aggregate([{ $group: { _id: null, total: { $sum: '$views' } } }]),
    News.aggregate([{ $match: { status: 'published' } }, { $group: { _id: '$category', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    News.find({ status: 'published' }).sort({ views: -1 }).limit(5).select('title views category').lean()
  ]);
  res.json({ total, published, pending, views: views[0]?.total || 0, byCategory, top });
}));

// Ads Management
router.get('/ads', asyncRoute(async (req, res) => {
  const now = new Date();
  const filter = { active: true, $or: [{ startsAt: null }, { startsAt: { $lte: now } }], $and: [{ $or: [{ endsAt: null }, { endsAt: { $gte: now } }] }] };
  res.json(await Ad.find(filter).select('-html').limit(30).lean());
}));
router.post('/manage/ads', requireAuth, allowRoles('admin'), asyncRoute(async (req, res) => {
  const name = cleanText(req.body.name, 120), placement = ['top', 'sidebar', 'in-article', 'footer'].includes(req.body.placement) ? req.body.placement : 'sidebar';
  if (!name || !req.body.targetUrl || !/^https:\/\//i.test(req.body.targetUrl)) return res.status(400).json({ message: 'Ad name and HTTPS destination are required' });
  res.status(201).json(await Ad.create({ name, placement, imageUrl: cleanText(req.body.imageUrl, 1000), targetUrl: cleanText(req.body.targetUrl, 1000), active: req.body.active !== false, startsAt: req.body.startsAt || null, endsAt: req.body.endsAt || null }));
}));
router.get('/manage/ads', requireAuth, allowRoles('admin'), asyncRoute(async (req, res) => res.json(await Ad.find().sort({ createdAt: -1 }).lean())));
router.patch('/manage/ads/:id', requireAuth, allowRoles('admin'), asyncRoute(async (req, res) => {
  const a = await Ad.findByIdAndUpdate(req.params.id, { active: !!req.body.active }, { new: true });
  if (!a) return res.status(404).json({ message: 'Ad not found' });
  res.json(a);
}));
router.post('/ads/:id/click', asyncRoute(async (req, res) => {
  await Ad.findByIdAndUpdate(req.params.id, { $inc: { clicks: 1 } });
  res.json({ ok: true });
}));
router.post('/ads/:id/impression', asyncRoute(async (req, res) => {
  await Ad.findByIdAndUpdate(req.params.id, { $inc: { impressions: 1 } });
  res.json({ ok: true });
}));

// AI Editorial Assistant
router.post('/ai/assist', requireAuth, allowRoles('admin', 'editor', 'reporter'), asyncRoute(async (req, res) => {
  if (!process.env.AI_API_KEY || !process.env.AI_API_URL) return res.status(503).json({ message: 'AI is optional. Configure AI_API_URL, AI_API_KEY and AI_MODEL in .env.' });
  const task = ['headline', 'summary', 'proofread', 'translate'].includes(req.body.task) ? req.body.task : 'summary';
  const source = cleanText(req.body.text, 10000);
  if (!source) return res.status(400).json({ message: 'Text is required' });
  const prompts = {
    headline: 'Suggest 5 accurate, non-sensational news headlines for this text.',
    summary: 'Write a concise factual news summary of this text.',
    proofread: 'Proofread this Bangla/English text. Preserve facts and meaning.',
    translate: 'Translate this text into English and Bangla, clearly labeling both.'
  };
  const response = await fetch(process.env.AI_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.AI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.AI_MODEL || 'gpt-4o-mini',
      messages: [{ role: 'system', content: 'You are an editorial assistant. Never invent facts. Clearly flag uncertainty.' }, { role: 'user', content: `${prompts[task]}\n\n${source}` }],
      temperature: 0.3
    })
  });
  const data = await response.json();
  if (!response.ok) return res.status(502).json({ message: 'AI provider request failed' });
  res.json({ result: data.choices?.[0]?.message?.content || data.output_text || 'No result' });
}));

// Push Notifications
router.get('/push/public-key', (req, res) => res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null }));
router.post('/push/subscribe', asyncRoute(async (req, res) => {
  const s = req.body.subscription;
  if (!s?.endpoint || !s?.keys?.p256dh || !s?.keys?.auth) return res.status(400).json({ message: 'Invalid push subscription' });
  await PushSubscription.updateOne({ endpoint: s.endpoint }, { $set: { endpoint: s.endpoint, keys: s.keys } }, { upsert: true });
  res.status(201).json({ message: 'Push subscription saved' });
}));
router.post('/manage/push', requireAuth, staff, asyncRoute(async (req, res) => {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return res.status(503).json({ message: 'Configure VAPID keys to send push notifications' });
  const webpush = require('web-push');
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const subs = await PushSubscription.find();
  let sent = 0;
  await Promise.all(subs.map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ title: cleanText(req.body.title, 100) || 'আমার বাংলাদেশ', body: cleanText(req.body.body, 180), url: '/' }));
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await s.deleteOne();
    }
  }));
  res.json({ sent, total: subs.length });
}));

// Newsletter Subscribers & Notifications
router.post('/subscribers', asyncRoute(async (req, res) => {
  const email = cleanText(req.body.email, 150).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: 'Enter a valid email' });
  await Subscriber.updateOne({ email }, { $set: { active: true } }, { upsert: true });
  res.status(201).json({ message: 'Subscription saved' });
}));
router.get('/manage/subscribers', requireAuth, staff, asyncRoute(async (req, res) => res.json(await Subscriber.find({ active: true }).sort({ createdAt: -1 }).lean())));
router.get('/manage/notifications', requireAuth, staff, asyncRoute(async (req, res) => res.json(await Notification.find().sort({ createdAt: -1 }).limit(50).lean())));
router.patch('/manage/notifications/:id/read', requireAuth, staff, asyncRoute(async (req, res) => res.json(await Notification.findByIdAndUpdate(req.params.id, { read: true }, { new: true }))));

module.exports = router;
