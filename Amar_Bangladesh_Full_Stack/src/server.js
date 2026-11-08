require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { User, News, Poll, Vote, Subscriber, Notification, LiveUpdate, Comment, Media, Ad, PushSubscription } = require('./models');
const { requireAuth, allowRoles } = require('./middleware');

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
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, message: { message: 'Too many login attempts. Try later.' } });
app.use('/api', apiLimiter);

// International edition: live desk, comments, media, advertising, AI and web push.
const staff = (req,res,next) => allowRoles('admin','editor')(req,res,next);
const publicOrigin = () => (process.env.PUBLIC_URL || process.env.CLIENT_ORIGIN || `http://localhost:${PORT}`).split(',')[0].replace(/\/$/,'');
app.get('/api/live', asyncRoute(async (req,res) => res.json(await LiveUpdate.find({active:true}).sort({createdAt:-1}).limit(50).lean())));
app.post('/api/manage/live', requireAuth, staff, asyncRoute(async (req,res) => { const title=cleanText(req.body.title,180), body=cleanText(req.body.body,3000); if(!title||!body)return res.status(400).json({message:'Title and update are required'}); const item=await LiveUpdate.create({title,body,author:req.user.id}); res.status(201).json(item); }));
app.delete('/api/manage/live/:id', requireAuth, staff, asyncRoute(async (req,res)=>{await LiveUpdate.findByIdAndDelete(req.params.id);res.json({message:'Live update deleted'});}));
app.get('/api/news/:id/comments', asyncRoute(async(req,res)=>res.json(await Comment.find({news:req.params.id,status:'approved'}).sort({createdAt:-1}).limit(100).select('name body createdAt').lean())));
app.post('/api/news/:id/comments', asyncRoute(async(req,res)=>{ if(!await News.exists({_id:req.params.id,status:'published'}))return res.status(404).json({message:'News not found'}); const name=cleanText(req.body.name,80),body=cleanText(req.body.body,2000);if(!name||body.length<2)return res.status(400).json({message:'Name and comment are required'});const c=await Comment.create({news:req.params.id,name,body,status:'pending'});res.status(201).json({message:'Comment submitted for moderation',id:c.id}); }));
app.get('/api/manage/comments',requireAuth,staff,asyncRoute(async(req,res)=>res.json(await Comment.find().populate('news','title').sort({createdAt:-1}).limit(300).lean())));
app.patch('/api/manage/comments/:id',requireAuth,staff,asyncRoute(async(req,res)=>{if(!['approved','rejected','pending'].includes(req.body.status))return res.status(400).json({message:'Invalid status'});const c=await Comment.findByIdAndUpdate(req.params.id,{status:req.body.status},{new:true});if(!c)return res.status(404).json({message:'Comment not found'});res.json(c);}));
app.get('/api/media',asyncRoute(async(req,res)=>res.json(await Media.find({active:true,kind:['video','photo']}).sort({createdAt:-1}).limit(100).lean())));
app.post('/api/manage/media',requireAuth,staff,asyncRoute(async(req,res)=>{const kind=['video','photo'].includes(req.body.kind)?req.body.kind:null,title=cleanText(req.body.title,180),url=cleanText(req.body.url,1000);if(!kind||!title||!/^https:\/\//i.test(url))return res.status(400).json({message:'Valid type, title and HTTPS media URL required'});res.status(201).json(await Media.create({kind,title,url,caption:cleanText(req.body.caption,500),author:req.user.id}));}));
app.delete('/api/manage/media/:id',requireAuth,staff,asyncRoute(async(req,res)=>{await Media.findByIdAndDelete(req.params.id);res.json({message:'Media deleted'});}));
app.get('/api/ads',asyncRoute(async(req,res)=>{const now=new Date();const filter={active:true,$or:[{startsAt:null},{startsAt:{$lte:now}}],$and:[{$or:[{endsAt:null},{endsAt:{$gte:now}}]}]};res.json(await Ad.find(filter).select('-html').limit(30).lean());}));
app.post('/api/manage/ads',requireAuth,allowRoles('admin'),asyncRoute(async(req,res)=>{const name=cleanText(req.body.name,120),placement=['top','sidebar','in-article','footer'].includes(req.body.placement)?req.body.placement:'sidebar';if(!name||!req.body.targetUrl||!/^https:\/\//i.test(req.body.targetUrl))return res.status(400).json({message:'Ad name and HTTPS destination are required'});res.status(201).json(await Ad.create({name,placement,imageUrl:cleanText(req.body.imageUrl,1000),targetUrl:cleanText(req.body.targetUrl,1000),active:req.body.active!==false,startsAt:req.body.startsAt||null,endsAt:req.body.endsAt||null}));}));
app.get('/api/manage/ads',requireAuth,allowRoles('admin'),asyncRoute(async(req,res)=>res.json(await Ad.find().sort({createdAt:-1}).lean())));
app.patch('/api/manage/ads/:id',requireAuth,allowRoles('admin'),asyncRoute(async(req,res)=>{const a=await Ad.findByIdAndUpdate(req.params.id,{active:!!req.body.active},{new:true});if(!a)return res.status(404).json({message:'Ad not found'});res.json(a);}));
app.post('/api/ads/:id/click',asyncRoute(async(req,res)=>{await Ad.findByIdAndUpdate(req.params.id,{$inc:{clicks:1}});res.json({ok:true});}));
app.post('/api/ads/:id/impression',asyncRoute(async(req,res)=>{await Ad.findByIdAndUpdate(req.params.id,{$inc:{impressions:1}});res.json({ok:true});}));
app.post('/api/ai/assist',requireAuth,allowRoles('admin','editor','reporter'),asyncRoute(async(req,res)=>{if(!process.env.AI_API_KEY||!process.env.AI_API_URL)return res.status(503).json({message:'AI is optional. Configure AI_API_URL, AI_API_KEY and AI_MODEL in .env.'});const task=['headline','summary','proofread','translate'].includes(req.body.task)?req.body.task:'summary';const source=cleanText(req.body.text,10000);if(!source)return res.status(400).json({message:'Text is required'});const prompts={headline:'Suggest 5 accurate, non-sensational news headlines for this text.',summary:'Write a concise factual news summary of this text.',proofread:'Proofread this Bangla/English text. Preserve facts and meaning.',translate:'Translate this text into English and Bangla, clearly labeling both.'};const response=await fetch(process.env.AI_API_URL,{method:'POST',headers:{Authorization:`Bearer ${process.env.AI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.AI_MODEL||'gpt-4o-mini',messages:[{role:'system',content:'You are an editorial assistant. Never invent facts. Clearly flag uncertainty.'},{role:'user',content:`${prompts[task]}\n\n${source}`}],temperature:0.3})});const data=await response.json();if(!response.ok)return res.status(502).json({message:'AI provider request failed'});res.json({result:data.choices?.[0]?.message?.content||data.output_text||'No result'});}));
app.get('/api/push/public-key',(req,res)=>res.json({publicKey:process.env.VAPID_PUBLIC_KEY||null}));
app.post('/api/push/subscribe',asyncRoute(async(req,res)=>{const s=req.body.subscription;if(!s?.endpoint||!s?.keys?.p256dh||!s?.keys?.auth)return res.status(400).json({message:'Invalid push subscription'});await PushSubscription.updateOne({endpoint:s.endpoint},{$set:{endpoint:s.endpoint,keys:s.keys}},{upsert:true});res.status(201).json({message:'Push subscription saved'});}));
app.post('/api/manage/push',requireAuth,staff,asyncRoute(async(req,res)=>{if(!process.env.VAPID_PUBLIC_KEY||!process.env.VAPID_PRIVATE_KEY)return res.status(503).json({message:'Configure VAPID keys to send push notifications'});const webpush=require('web-push');webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:admin@example.com',process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);const subs=await PushSubscription.find();let sent=0;await Promise.all(subs.map(async s=>{try{await webpush.sendNotification({endpoint:s.endpoint,keys:s.keys},JSON.stringify({title:cleanText(req.body.title,100)||'আমার বাংলাদেশ',body:cleanText(req.body.body,180),url:'/'}));sent++;}catch(e){if(e.statusCode===404||e.statusCode===410)await s.deleteOne();}}));res.json({sent,total:subs.length});}));


const categories = ['জাতীয়','আন্তর্জাতিক','রাজনীতি','অর্থনীতি','প্রযুক্তি','খেলাধুলা','বিনোদন','শিক্ষা','স্বাস্থ্য'];
const cleanText = (v, max=500) => String(v ?? '').replace(/<[^>]*>/g, '').trim().slice(0, max);
const asyncRoute = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);

const storage = multer.diskStorage({
  destination: (req,file,cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename: (req,file,cb) => cb(null, crypto.randomBytes(12).toString('hex') + path.extname(file.originalname).toLowerCase())
});
const upload = multer({
  storage, limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req,file,cb) => {
    const ok = ['image/jpeg','image/png','image/webp','image/gif'].includes(file.mimetype);
    cb(ok ? null : new Error('Only JPG, PNG, WEBP and GIF images are allowed'), ok);
  }
});

app.get('/api/health', (req,res) => res.json({ status: 'ok', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected', time: new Date().toISOString() }));

// Authentication and role-based user management
app.post('/api/auth/login', authLimiter, asyncRoute(async (req,res) => {
  const email = cleanText(req.body.email, 150).toLowerCase();
  const user = await User.findOne({ email });
  if (!user || !user.active || !(await bcrypt.compare(String(req.body.password || ''), user.passwordHash)))
    return res.status(401).json({ message: 'Email or password is incorrect' });
  const token = jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '1d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}));
app.get('/api/auth/me', requireAuth, (req,res) => res.json({ user: req.user }));

app.post('/api/auth/register', authLimiter, asyncRoute(async(req,res)=>{const name=cleanText(req.body.name,80),email=cleanText(req.body.email,150).toLowerCase(),password=String(req.body.password||'');if(!name||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<10)return res.status(400).json({message:'Name, valid email and password of at least 10 characters required'});if(await User.exists({email}))return res.status(409).json({message:'Email already registered'});const passwordHash=await bcrypt.hash(password,12);const user=await User.create({name,email,passwordHash,role:'reader'});res.status(201).json({message:'Reader account created. Please sign in.',id:user.id});}));
app.get('/api/profile',requireAuth,(req,res)=>res.json({id:req.user.id,name:req.user.name,email:req.user.email,role:req.user.role,createdAt:req.user.createdAt}));
app.patch('/api/profile',requireAuth,asyncRoute(async(req,res)=>{const name=cleanText(req.body.name,80);if(!name)return res.status(400).json({message:'Name is required'});req.user.name=name;await req.user.save();res.json({id:req.user.id,name:req.user.name,email:req.user.email,role:req.user.role});}));

app.post('/api/users', requireAuth, allowRoles('admin'), asyncRoute(async (req,res) => {
  const { name, email, password, role='reporter' } = req.body;
  if (!name || !email || !password || String(password).length < 10) return res.status(400).json({ message: 'Name, email and a password of at least 10 characters are required' });
  if (!['admin','editor','reporter'].includes(role)) return res.status(400).json({ message: 'Invalid role' });
  const passwordHash = await bcrypt.hash(String(password), 12);
  const user = await User.create({ name: cleanText(name,80), email: cleanText(email,150).toLowerCase(), passwordHash, role });
  res.status(201).json({ id: user.id, name: user.name, email: user.email, role: user.role });
}));
app.get('/api/users', requireAuth, allowRoles('admin'), asyncRoute(async (req,res) => {
  const users = await User.find().select('-passwordHash').sort({ createdAt: -1 });
  res.json(users);
}));
app.patch('/api/users/:id', requireAuth, allowRoles('admin'), asyncRoute(async (req,res) => {
  const allowed = {};
  if (['admin','editor','reporter'].includes(req.body.role)) allowed.role = req.body.role;
  if (typeof req.body.active === 'boolean') allowed.active = req.body.active;
  const user = await User.findByIdAndUpdate(req.params.id, allowed, { new: true }).select('-passwordHash');
  if (!user) return res.status(404).json({ message: 'User not found' });
  res.json(user);
}));

// Public news endpoints
app.get('/api/news', asyncRoute(async (req,res) => {
  const { q, category, page=1, limit=12, sort='latest' } = req.query;
  const filter = { status: 'published' };
  if (category && categories.includes(category)) filter.category = category;
  if (q) filter.$text = { $search: cleanText(q,100) };
  const safeLimit = Math.min(Math.max(Number(limit)||12,1),30);
  const sortBy = sort === 'popular' ? { views: -1, publishedAt: -1 } : { publishedAt: -1 };
  const [items,total] = await Promise.all([
    News.find(filter).populate('author','name').sort(sortBy).skip((Math.max(Number(page)||1,1)-1)*safeLimit).limit(safeLimit).lean(),
    News.countDocuments(filter)
  ]);
  res.json({ items, total, page: Number(page)||1, pages: Math.ceil(total/safeLimit) });
}));
app.get('/api/news/:id', asyncRoute(async (req,res) => {
  const item = await News.findOneAndUpdate({ _id: req.params.id, status: 'published' }, { $inc: { views: 1 } }, { new: true }).populate('author','name');
  if (!item) return res.status(404).json({ message: 'News not found' });
  res.json(item);
}));
app.post('/api/news', requireAuth, allowRoles('admin','editor','reporter'), asyncRoute(async (req,res) => {
  const { title, titleEn, summary, summaryEn, body, bodyEn, category, image, tags=[] } = req.body;
  if (!title || !summary || !body || !categories.includes(category)) return res.status(400).json({ message: 'Title, summary, body and valid category are required' });
  const status = req.user.role === 'reporter' ? 'pending' : (req.body.status === 'draft' ? 'draft' : 'pending');
  const item = await News.create({ title: cleanText(title,180), titleEn:cleanText(titleEn,180), summary: cleanText(summary,500), summaryEn:cleanText(summaryEn,500), body: cleanText(body,30000), bodyEn:cleanText(bodyEn,30000), category, image: cleanText(image,500), tags: Array.isArray(tags) ? tags.slice(0,8).map(t=>cleanText(t,30)) : [], author: req.user.id, status });
  await Notification.create({ title: 'নতুন সংবাদ জমা হয়েছে', message: item.title, type: 'editorial' });
  res.status(201).json(item);
}));
app.get('/api/manage/news', requireAuth, allowRoles('admin','editor','reporter'), asyncRoute(async (req,res) => {
  const filter = req.user.role === 'reporter' ? { author: req.user.id } : {};
  if (req.query.status && ['draft','pending','published','rejected'].includes(req.query.status)) filter.status = req.query.status;
  res.json(await News.find(filter).populate('author','name email').sort({ createdAt: -1 }).limit(200));
}));
app.patch('/api/manage/news/:id', requireAuth, allowRoles('admin','editor','reporter'), asyncRoute(async (req,res) => {
  const item = await News.findById(req.params.id);
  if (!item) return res.status(404).json({ message: 'News not found' });
  if (req.user.role === 'reporter' && String(item.author) !== req.user.id) return res.status(403).json({ message: 'You can only edit your own submissions' });
  if (req.body.title) item.title = cleanText(req.body.title,180);
  if (typeof req.body.titleEn === 'string') item.titleEn = cleanText(req.body.titleEn,180);
  if (typeof req.body.summaryEn === 'string') item.summaryEn = cleanText(req.body.summaryEn,500);
  if (typeof req.body.bodyEn === 'string') item.bodyEn = cleanText(req.body.bodyEn,30000);
  if (req.body.summary) item.summary = cleanText(req.body.summary,500);
  if (req.body.body) item.body = cleanText(req.body.body,30000);
  if (categories.includes(req.body.category)) item.category = req.body.category;
  if (typeof req.body.featured === 'boolean' && ['admin','editor'].includes(req.user.role)) item.featured = req.body.featured;
  if (['draft','pending'].includes(req.body.status) && req.user.role === 'reporter') item.status = req.body.status;
  if (['published','rejected','pending','draft'].includes(req.body.status) && ['admin','editor'].includes(req.user.role)) {
    item.status = req.body.status;
    if (req.body.status === 'published' && !item.publishedAt) item.publishedAt = new Date();
  }
  await item.save();
  res.json(item);
}));
app.delete('/api/manage/news/:id', requireAuth, allowRoles('admin','editor'), asyncRoute(async (req,res) => {
  const item = await News.findByIdAndDelete(req.params.id);
  if (!item) return res.status(404).json({ message: 'News not found' });
  res.json({ message: 'News deleted' });
}));
app.post('/api/uploads', requireAuth, allowRoles('admin','editor','reporter'), upload.single('image'), (req,res) => {
  if (!req.file) return res.status(400).json({ message: 'Image is required' });
  res.status(201).json({ url: `/uploads/${req.file.filename}` });
});


const cloudUpload = multer({storage:multer.memoryStorage(),limits:{fileSize:8*1024*1024},fileFilter:(req,file,cb)=>cb(['image/jpeg','image/png','image/webp','image/gif'].includes(file.mimetype)?null:new Error('Unsupported image type'),['image/jpeg','image/png','image/webp','image/gif'].includes(file.mimetype))});
app.post('/api/uploads/cloud',requireAuth,allowRoles('admin','editor','reporter'),cloudUpload.single('image'),asyncRoute(async(req,res)=>{if(!req.file)return res.status(400).json({message:'Image required'});if(!process.env.CLOUDINARY_CLOUD_NAME||!process.env.CLOUDINARY_API_KEY||!process.env.CLOUDINARY_API_SECRET)return res.status(503).json({message:'Cloudinary is not configured; use the existing local upload endpoint'});const cloudinary=require('cloudinary').v2;cloudinary.config({cloud_name:process.env.CLOUDINARY_CLOUD_NAME,api_key:process.env.CLOUDINARY_API_KEY,api_secret:process.env.CLOUDINARY_API_SECRET});const result=await new Promise((resolve,reject)=>{const stream=cloudinary.uploader.upload_stream({folder:'amar-bangladesh'},(err,out)=>err?reject(err):resolve(out));stream.end(req.file.buffer);});res.status(201).json({url:result.secure_url,publicId:result.public_id,provider:'cloudinary'});}));

// Polls with one-vote-per-browser-key guard
app.get('/api/polls/active', asyncRoute(async (req,res) => res.json(await Poll.findOne({ active: true }).sort({ createdAt: -1 }).lean())));
app.post('/api/polls/:id/vote', asyncRoute(async (req,res) => {
  const poll = await Poll.findOne({ _id: req.params.id, active: true });
  const idx = Number(req.body.optionIndex);
  if (!poll || !Number.isInteger(idx) || idx < 0 || idx >= poll.options.length) return res.status(400).json({ message: 'Invalid poll or option' });
  const voterKey = crypto.createHash('sha256').update(String(req.ip) + ':' + cleanText(req.body.voterKey,100)).digest('hex');
  try { await Vote.create({ poll: poll.id, voterKey, optionIndex: idx }); }
  catch { return res.status(409).json({ message: 'You have already voted in this poll' }); }
  poll.options[idx].votes += 1; await poll.save();
  res.json(poll);
}));
app.post('/api/polls', requireAuth, allowRoles('admin','editor'), asyncRoute(async (req,res) => {
  const options = Array.isArray(req.body.options) ? req.body.options.slice(0,6).map(x=>({ label: cleanText(x,100), votes: 0 })).filter(x=>x.label) : [];
  if (!req.body.question || options.length < 2) return res.status(400).json({ message: 'Question and at least two options are required' });
  await Poll.updateMany({}, { active: false });
  res.status(201).json(await Poll.create({ question: cleanText(req.body.question,240), options, active: true }));
}));

// Newsletter, notification and analytics endpoints
app.post('/api/subscribers', asyncRoute(async (req,res) => {
  const email = cleanText(req.body.email,150).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: 'Enter a valid email' });
  await Subscriber.updateOne({ email }, { $set: { active: true } }, { upsert: true });
  res.status(201).json({ message: 'Subscription saved' });
}));
app.get('/api/manage/subscribers', requireAuth, allowRoles('admin','editor'), asyncRoute(async (req,res) => res.json(await Subscriber.find({ active: true }).sort({ createdAt: -1 }).lean())));
app.get('/api/manage/notifications', requireAuth, allowRoles('admin','editor'), asyncRoute(async (req,res) => res.json(await Notification.find().sort({ createdAt: -1 }).limit(50).lean())));
app.patch('/api/manage/notifications/:id/read', requireAuth, allowRoles('admin','editor'), asyncRoute(async (req,res) => res.json(await Notification.findByIdAndUpdate(req.params.id,{read:true},{new:true}))));
app.get('/api/manage/analytics', requireAuth, allowRoles('admin','editor'), asyncRoute(async (req,res) => {
  const [total,published,pending,views,byCategory,top] = await Promise.all([
    News.countDocuments(), News.countDocuments({status:'published'}), News.countDocuments({status:'pending'}),
    News.aggregate([{ $group: { _id: null, total: { $sum: '$views' } } }]),
    News.aggregate([{ $match:{status:'published'} },{ $group:{_id:'$category',count:{$sum:1}} },{ $sort:{count:-1} }]),
    News.find({status:'published'}).sort({views:-1}).limit(5).select('title views category').lean()
  ]);
  res.json({ total, published, pending, views: views[0]?.total || 0, byCategory, top });
}));

// Optional NewsAPI import. Imported stories remain pending for editorial review.
app.post('/api/manage/news/refresh', requireAuth, allowRoles('admin','editor'), asyncRoute(async (req,res) => {
  if (!process.env.NEWS_API_KEY) return res.status(503).json({ message: 'Set NEWS_API_KEY in .env to enable external news import' });
  const country = /^[a-z]{2}$/i.test(process.env.NEWS_API_COUNTRY || '') ? process.env.NEWS_API_COUNTRY : 'us';
  const response = await fetch(`https://newsapi.org/v2/top-headlines?country=${country}&pageSize=20&apiKey=${process.env.NEWS_API_KEY}`);
  const data = await response.json();
  if (!response.ok || data.status !== 'ok') return res.status(502).json({ message: 'News provider request failed' });
  let added = 0;
  for (const a of data.articles || []) {
    if (!a.title || !a.url) continue;
    const exists = await News.exists({ title: cleanText(a.title,180) });
    if (exists) continue;
    await News.create({ title: cleanText(a.title,180), summary: cleanText(a.description || a.title,500), body: cleanText(a.content || a.description || a.title,30000), category:'আন্তর্জাতিক', image: cleanText(a.urlToImage || '',500), source: cleanText(a.source?.name || 'External source',100), status:'pending' });
    added++;
  }
  res.json({ added, message: `${added} stories imported into editorial review` });
}));

app.get('/manifest.webmanifest',(req,res)=>res.type('application/manifest+json').send(JSON.stringify({name:'Amar Bangladesh',short_name:'Amar BD',start_url:'/',display:'standalone',background_color:'#f3f7f5',theme_color:'#087653'})));
app.get('/robots.txt', (req,res) => res.type('text').send('User-agent: *\\nAllow: /\\nSitemap: /sitemap.xml'));
app.get('/sitemap.xml', asyncRoute(async (req,res) => {
  const items = await News.find({status:'published'}).select('_id updatedAt').limit(5000).lean();
  const base = publicOrigin();
  const urls = items.map(n=>`<url><loc>${base}/?article=${n._id}</loc><lastmod>${new Date(n.updatedAt).toISOString()}</lastmod></url>`).join('');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
}));

app.use((err,req,res,next) => {
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
