let redisClient = null;
const memoryCache = new Map();

if (process.env.REDIS_URL) {
  try {
    const { createClient } = require('redis');
    redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.on('error', (err) => console.error('Redis Client Error:', err.message));
    redisClient.connect().then(() => console.log('Connected to Redis server')).catch(() => {
      console.log('Redis connection failed, falling back to In-Memory Cache.');
      redisClient = null;
    });
  } catch (e) {
    console.log('Redis package not configured or failed to initialize, using In-Memory Cache.');
  }
}

async function getCache(key) {
  if (redisClient && redisClient.isOpen) {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  }
  const cached = memoryCache.get(key);
  if (cached && cached.expiry > Date.now()) {
    return cached.data;
  }
  return null;
}

async function setCache(key, value, ttlSeconds = 120) {
  if (redisClient && redisClient.isOpen) {
    await redisClient.setEx(key, ttlSeconds, JSON.stringify(value));
    return;
  }
  memoryCache.set(key, {
    data: value,
    expiry: Date.now() + (ttlSeconds * 1000)
  });
}

async function clearCachePattern(patternKey) {
  if (redisClient && redisClient.isOpen) {
    const keys = await redisClient.keys(`${patternKey}*`);
    if (keys.length > 0) await redisClient.del(keys);
    return;
  }
  for (const k of memoryCache.keys()) {
    if (k.startsWith(patternKey)) {
      memoryCache.delete(k);
    }
  }
}

module.exports = { getCache, setCache, clearCachePattern };
