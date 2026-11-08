const express = require('express');
const router = express.Router();
const { News, Notification, LiveUpdate, Comment, Media } = require('../models');
const { requireAuth, allowRoles } = require('../middleware');
const { getCache, setCache, clearCachePattern } = require('../services/cacheService');

const categories = ['জাতীয়','আন্তর্জাতিক','রাজনীতি','অর্থনীতি','প্রযুক্তি','খেলাধুলা','বিনোদন','শিক্ষা','স্বাস্থ্য'];
const cleanText = (v, max = 500) => String(v ?? '').replace(/<[^>]*>/g, '').trim().slice(0, max);
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const staff = (req, res, next) => allowRoles('admin', 'editor')(req, res, next);

// Public news list with Redis/In-memory Caching
router.get('/news', asyncRoute(async (req, res) => {
  const { q, category, page = 1, limit = 12, sort = 'latest' } = req.query;
  const cacheKey = `news_list_${q || ''}_${category || ''}_${page}_${limit}_${sort}`;
  
  const cachedData = await getCache(cacheKey);
  if (cachedData) {
    return res.json(cachedData);
  }

  const filter = { status: 'published' };
  if (category && categories.includes(category)) filter.category = category;
  if (q) filter.$text = { $search: cleanText(q, 100) };
  const safeLimit = Math.min(Math.max(Number(limit) || 12, 1), 30);
  const sortBy = sort === 'popular' ? { views: -1, publishedAt: -1 } : { publishedAt: -1 };
  const [items, total] = await Promise.all([
    News.find(filter).populate('author', 'name').sort(sortBy).skip((Math.max(Number(page) || 1, 1) - 1) * safeLimit).limit(safeLimit).lean(),
    News.countDocuments(filter)
  ]);

  const result = { items, total, page: Number(page) || 1, pages: Math.ceil(total / safeLimit) };
  await setCache(cacheKey, result, 120); // 2 minutes TTL
  res.json(result);
}));

// Public news by ID
router.get('/news/:id', asyncRoute(async (req, res) => {
  const item = await News.findOneAndUpdate({ _id: req.params.id, status: 'published' }, { $inc: { views: 1 } }, { new: true }).populate('author', 'name');
  if (!item) return res.status(404).json({ message: 'News not found' });
  res.json(item);
}));

// Create news
router.post('/news', requireAuth, allowRoles('admin', 'editor', 'reporter'), asyncRoute(async (req, res) => {
  const { title, titleEn, summary, summaryEn, body, bodyEn, category, image, tags = [] } = req.body;
  if (!title || !summary || !body || !categories.includes(category)) {
    return res.status(400).json({ message: 'Title, summary, body and valid category are required' });
  }
  const status = req.user.role === 'reporter' ? 'pending' : (req.body.status === 'draft' ? 'draft' : 'pending');
  const item = await News.create({
    title: cleanText(title, 180), titleEn: cleanText(titleEn, 180),
    summary: cleanText(summary, 500), summaryEn: cleanText(summaryEn, 500),
    body: cleanText(body, 30000), bodyEn: cleanText(bodyEn, 30000),
    category, image: cleanText(image, 500),
    tags: Array.isArray(tags) ? tags.slice(0, 8).map(t => cleanText(t, 30)) : [],
    author: req.user.id, status
  });
  await Notification.create({ title: 'নতুন সংবাদ জমা হয়েছে', message: item.title, type: 'editorial' });
  await clearCachePattern('news_list_');
  res.status(201).json(item);
}));

// Manage news
router.get('/manage/news', requireAuth, allowRoles('admin', 'editor', 'reporter'), asyncRoute(async (req, res) => {
  const filter = req.user.role === 'reporter' ? { author: req.user.id } : {};
  if (req.query.status && ['draft', 'pending', 'published', 'rejected'].includes(req.query.status)) filter.status = req.query.status;
  res.json(await News.find(filter).populate('author', 'name email').sort({ createdAt: -1 }).limit(200));
}));

// Update news
router.patch('/manage/news/:id', requireAuth, allowRoles('admin', 'editor', 'reporter'), asyncRoute(async (req, res) => {
  const item = await News.findById(req.params.id);
  if (!item) return res.status(404).json({ message: 'News not found' });
  if (req.user.role === 'reporter' && String(item.author) !== req.user.id) return res.status(403).json({ message: 'You can only edit your own submissions' });
  if (req.body.title) item.title = cleanText(req.body.title, 180);
  if (typeof req.body.titleEn === 'string') item.titleEn = cleanText(req.body.titleEn, 180);
  if (typeof req.body.summaryEn === 'string') item.summaryEn = cleanText(req.body.summaryEn, 500);
  if (typeof req.body.bodyEn === 'string') item.bodyEn = cleanText(req.body.bodyEn, 30000);
  if (req.body.summary) item.summary = cleanText(req.body.summary, 500);
  if (req.body.body) item.body = req.body.body; // Preserve Quill HTML formatting
  if (categories.includes(req.body.category)) item.category = req.body.category;
  if (typeof req.body.featured === 'boolean' && ['admin', 'editor'].includes(req.user.role)) item.featured = req.body.featured;
  if (['draft', 'pending'].includes(req.body.status) && req.user.role === 'reporter') item.status = req.body.status;
  if (['published', 'rejected', 'pending', 'draft'].includes(req.body.status) && ['admin', 'editor'].includes(req.user.role)) {
    item.status = req.body.status;
    if (req.body.status === 'published' && !item.publishedAt) item.publishedAt = new Date();
  }
  await item.save();
  await clearCachePattern('news_list_');
  res.json(item);
}));

// Delete news
router.delete('/manage/news/:id', requireAuth, allowRoles('admin', 'editor'), asyncRoute(async (req, res) => {
  const item = await News.findByIdAndDelete(req.params.id);
  if (!item) return res.status(404).json({ message: 'News not found' });
  await clearCachePattern('news_list_');
  res.json({ message: 'News deleted' });
}));

// Live updates
router.get('/live', asyncRoute(async (req, res) => res.json(await LiveUpdate.find({ active: true }).sort({ createdAt: -1 }).limit(50).lean())));
router.post('/manage/live', requireAuth, staff, asyncRoute(async (req, res) => {
  const title = cleanText(req.body.title, 180), body = cleanText(req.body.body, 3000);
  if (!title || !body) return res.status(400).json({ message: 'Title and update are required' });
  const item = await LiveUpdate.create({ title, body, author: req.user.id });
  res.status(201).json(item);
}));
router.delete('/manage/live/:id', requireAuth, staff, asyncRoute(async (req, res) => {
  await LiveUpdate.findByIdAndDelete(req.params.id);
  res.json({ message: 'Live update deleted' });
}));

// Comments
router.get('/news/:id/comments', asyncRoute(async (req, res) => res.json(await Comment.find({ news: req.params.id, status: 'approved' }).sort({ createdAt: -1 }).limit(100).select('name body createdAt').lean())));
router.post('/news/:id/comments', asyncRoute(async (req, res) => {
  if (!await News.exists({ _id: req.params.id, status: 'published' })) return res.status(404).json({ message: 'News not found' });
  const name = cleanText(req.body.name, 80), body = cleanText(req.body.body, 2000);
  if (!name || body.length < 2) return res.status(400).json({ message: 'Name and comment are required' });
  const c = await Comment.create({ news: req.params.id, name, body, status: 'pending' });
  res.status(201).json({ message: 'Comment submitted for moderation', id: c.id });
}));
router.get('/manage/comments', requireAuth, staff, asyncRoute(async (req, res) => res.json(await Comment.find().populate('news', 'title').sort({ createdAt: -1 }).limit(300).lean())));
router.patch('/manage/comments/:id', requireAuth, staff, asyncRoute(async (req, res) => {
  if (!['approved', 'rejected', 'pending'].includes(req.body.status)) return res.status(400).json({ message: 'Invalid status' });
  const c = await Comment.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
  if (!c) return res.status(404).json({ message: 'Comment not found' });
  res.json(c);
}));

// Media (Video/Photo)
router.get('/media', asyncRoute(async (req, res) => res.json(await Media.find({ active: true, kind: ['video', 'photo'] }).sort({ createdAt: -1 }).limit(100).lean())));
router.post('/manage/media', requireAuth, staff, asyncRoute(async (req, res) => {
  const kind = ['video', 'photo'].includes(req.body.kind) ? req.body.kind : null, title = cleanText(req.body.title, 180), url = cleanText(req.body.url, 1000);
  if (!kind || !title || !/^https:\/\//i.test(url)) return res.status(400).json({ message: 'Valid type, title and HTTPS media URL required' });
  res.status(201).json(await Media.create({ kind, title, url, caption: cleanText(req.body.caption, 500), author: req.user.id }));
}));
router.delete('/manage/media/:id', requireAuth, staff, asyncRoute(async (req, res) => {
  await Media.findByIdAndDelete(req.params.id);
  res.json({ message: 'Media deleted' });
}));

module.exports = router;
