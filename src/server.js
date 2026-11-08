const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

// Auto News Service Import (আপনার ফাইল পাথ অনুযায়ী)
let startAutoNewsService;
try {
  startAutoNewsService = require('./autoNewsService');
} catch (e) {
  try {
    startAutoNewsService = require('./autoNews');
  } catch (err) {
    console.log('Auto news service file path check needed.');
  }
}

const app = express();

app.use(cors());
app.use(express.json());

// MongoDB Connection String
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/amar_bangladesh';

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('MongoDB Connected Successfully!');
    if (typeof startAutoNewsService === 'function') {
      startAutoNewsService();
    }
  })
  .catch((err) => {
    console.error('MongoDB Connection Error:', err.message);
  });

app.get('/', (req, res) => {
  res.send('Amar Bangladesh Portal API is running...');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});