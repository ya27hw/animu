#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Memory monitoring function
function logMemoryUsage() {
  const memUsage = process.memoryUsage();
  const timestamp = new Date().toISOString();
  
  const memoryData = {
    timestamp,
    rss: Math.round(memUsage.rss / 1024 / 1024), // MB
    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
    external: Math.round(memUsage.external / 1024 / 1024), // MB
    arrayBuffers: Math.round(memUsage.arrayBuffers / 1024 / 1024) // MB
  };
  
  // Log to file
  const logFile = path.join(logsDir, 'memory-usage.jsonl');
  fs.appendFileSync(logFile, JSON.stringify(memoryData) + '\n');
  
  // Log to console
  console.log(`[${timestamp}] Memory: RSS=${memoryData.rss}MB, Heap=${memoryData.heapUsed}/${memoryData.heapTotal}MB`);
  
  // Alert if memory usage is high
  if (memoryData.rss > 220) { // 400MB threshold
    console.warn(`⚠️  HIGH MEMORY USAGE: ${memoryData.rss}MB RSS`);
  }
}

// Log memory usage every 30 seconds
setInterval(logMemoryUsage, 30000);

// Initial log
logMemoryUsage();

console.log('Memory monitoring started. Logging every 30 seconds to logs/memory-usage.jsonl');
