const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { User } = require('../models');
const { requireAuth } = require('../middleware');
const { sendPasswordResetEmail } = require('../services/emailService');

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, message: { message: 'Too many login attempts. Try later.' } });

const cleanText = (v, max = 500) => String(v ?? '').replace(/<[^>]*>/g, '').trim().slice(0, max);
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// User login
router.post('/login', authLimiter, asyncRoute(async (req, res) => {
  const email = cleanText(req.body.email, 150).toLowerCase();
  const user = await User.findOne({ email });
  if (!user || !user.active || !(await bcrypt.compare(String(req.body.password || ''), user.passwordHash))) {
    return res.status(401).json({ message: 'Email or password is incorrect' });
  }
  const token = jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '1d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}));

// Reader registration
router.post('/register', authLimiter, asyncRoute(async (req, res) => {
  const name = cleanText(req.body.name, 80);
  const email = cleanText(req.body.email, 150).toLowerCase();
  const password = String(req.body.password || '');
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10) {
    return res.status(400).json({ message: 'Name, valid email and password of at least 10 characters required' });
  }
  if (await User.exists({ email })) return res.status(409).json({ message: 'Email already registered' });
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ name, email, passwordHash, role: 'reader' });
  res.status(201).json({ message: 'Reader account created. Please sign in.', id: user.id });
}));

// Forgot Password Request
router.post('/forgot-password', authLimiter, asyncRoute(async (req, res) => {
  const email = cleanText(req.body.email, 150).toLowerCase();
  const user = await User.findOne({ email });
  if (!user) {
    return res.json({ message: 'If that email exists, a password reset link has been sent.' });
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
  user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
  await user.save();

  await sendPasswordResetEmail(user.email, resetToken);
  res.json({ message: 'If that email exists, a password reset link has been sent.' });
}));

// Reset Password
router.post('/reset-password', authLimiter, asyncRoute(async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword || String(newPassword).length < 10) {
    return res.status(400).json({ message: 'Token and a new password (min 10 characters) are required' });
  }

  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  const user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpires: { $gt: Date.now() }
  });

  if (!user) {
    return res.status(400).json({ message: 'Password reset token is invalid or has expired' });
  }

  user.passwordHash = await bcrypt.hash(String(newPassword), 12);
  user.resetPasswordToken = null;
  user.resetPasswordExpires = null;
  await user.save();

  res.json({ message: 'Password has been reset successfully. You can now log in.' });
}));

// Get current user auth
router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

// Get profile
router.get('/profile', requireAuth, (req, res) => {
  res.json({ id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role, createdAt: req.user.createdAt });
});

// Update profile
router.patch('/profile', requireAuth, asyncRoute(async (req, res) => {
  const name = cleanText(req.body.name, 80);
  if (!name) return res.status(400).json({ message: 'Name is required' });
  req.user.name = name;
  await req.user.save();
  res.json({ id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role });
}));

module.exports = router;
