const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { User } = require('../models');
const { requireAuth, allowRoles } = require('../middleware');

const cleanText = (v, max = 500) => String(v ?? '').replace(/<[^>]*>/g, '').trim().slice(0, max);
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Create user (Admin only)
router.post('/', requireAuth, allowRoles('admin'), asyncRoute(async (req, res) => {
  const { name, email, password, role = 'reporter' } = req.body;
  if (!name || !email || !password || String(password).length < 10) {
    return res.status(400).json({ message: 'Name, email and a password of at least 10 characters are required' });
  }
  if (!['admin', 'editor', 'reporter'].includes(role)) return res.status(400).json({ message: 'Invalid role' });
  const passwordHash = await bcrypt.hash(String(password), 12);
  const user = await User.create({ name: cleanText(name, 80), email: cleanText(email, 150).toLowerCase(), passwordHash, role });
  res.status(201).json({ id: user.id, name: user.name, email: user.email, role: user.role });
}));

// Get all users (Admin only)
router.get('/', requireAuth, allowRoles('admin'), asyncRoute(async (req, res) => {
  const users = await User.find().select('-passwordHash').sort({ createdAt: -1 });
  res.json(users);
}));

// Update user (Admin only)
router.patch('/:id', requireAuth, allowRoles('admin'), asyncRoute(async (req, res) => {
  const allowed = {};
  if (['admin', 'editor', 'reporter'].includes(req.body.role)) allowed.role = req.body.role;
  if (typeof req.body.active === 'boolean') allowed.active = req.body.active;
  const user = await User.findByIdAndUpdate(req.params.id, allowed, { new: true }).select('-passwordHash');
  if (!user) return res.status(404).json({ message: 'User not found' });
  res.json(user);
}));

module.exports = router;
