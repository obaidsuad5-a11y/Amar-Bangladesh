const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

// অটো-নিউজ সার্ভিস ইমপোর্ট করা হলো
const startAutoNewsService = require('./autoNewsService');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection Config
// Render-এর MONGO_URI থাকলে সেটা দিয়ে ক্লাউডে কানেক্ট হবে, অন্যথায় লোকাল ডাটাবেজে কানেক্ট হবে
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/amar_bangladesh';

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('MongoDB Connected Successfully!');
    
    // ডাটাবেজ সফলভাবে কানেক্ট হওয়ার পর অটো-নিউজ সার্ভিস চালু হবে
    if (typeof startAutoNewsService === 'function') {
      startAutoNewsService();
    }
  })
  .catch((err) => {
    console.error('MongoDB Connection Error:', err.message);
  });

// Basic Route
app.get('/', (req, res) => {
  res.send('Amar Bangladesh Portal API is running...');
});

// News Routes (আপনার অ্যাপের রাউটগুলো থাকলে নিচে থাকবে)
// app.use('/api/news', require('./routes/newsRoutes'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});