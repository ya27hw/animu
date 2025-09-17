#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function analyzeMemoryLogs() {
  const logFile = path.join(__dirname, 'logs', 'memory-usage.jsonl');
  
  if (!fs.existsSync(logFile)) {
    console.log('No memory logs found. Run the app with memory monitoring first.');
    return;
  }
  
  const logs = fs.readFileSync(logFile, 'utf8')
    .trim()
    .split('\n')
    .map(line => JSON.parse(line));
  
  if (logs.length === 0) {
    console.log('No memory data found.');
    return;
  }
  
  // Calculate statistics
  const rssValues = logs.map(log => log.rss);
  const heapUsedValues = logs.map(log => log.heapUsed);
  
  const stats = {
    totalSamples: logs.length,
    timeRange: {
      start: logs[0].timestamp,
      end: logs[logs.length - 1].timestamp
    },
    rss: {
      min: Math.min(...rssValues),
      max: Math.max(...rssValues),
      avg: Math.round(rssValues.reduce((a, b) => a + b, 0) / rssValues.length),
      trend: rssValues[rssValues.length - 1] - rssValues[0]
    },
    heapUsed: {
      min: Math.min(...heapUsedValues),
      max: Math.max(...heapUsedValues),
      avg: Math.round(heapUsedValues.reduce((a, b) => a + b, 0) / heapUsedValues.length),
      trend: heapUsedValues[heapUsedValues.length - 1] - heapUsedValues[0]
    }
  };
  
  console.log('\n📊 Memory Usage Analysis');
  console.log('========================');
  console.log(`Total samples: ${stats.totalSamples}`);
  console.log(`Time range: ${stats.timeRange.start} to ${stats.timeRange.end}`);
  console.log('\nRSS Memory (Total Process Memory):');
  console.log(`  Min: ${stats.rss.min}MB`);
  console.log(`  Max: ${stats.rss.max}MB`);
  console.log(`  Avg: ${stats.rss.avg}MB`);
  console.log(`  Trend: ${stats.rss.trend > 0 ? '+' : ''}${stats.rss.trend}MB`);
  
  console.log('\nHeap Memory (JavaScript Objects):');
  console.log(`  Min: ${stats.heapUsed.min}MB`);
  console.log(`  Max: ${stats.heapUsed.max}MB`);
  console.log(`  Avg: ${stats.heapUsed.avg}MB`);
  console.log(`  Trend: ${stats.heapUsed.trend > 0 ? '+' : ''}${stats.heapUsed.trend}MB`);
  
  // Memory leak detection
  if (stats.rss.trend > 50) {
    console.log('\n⚠️  POTENTIAL MEMORY LEAK DETECTED!');
    console.log(`   RSS memory increased by ${stats.rss.trend}MB over time`);
  }
  
  if (stats.heapUsed.trend > 30) {
    console.log('\n⚠️  POTENTIAL HEAP LEAK DETECTED!');
    console.log(`   Heap memory increased by ${stats.heapUsed.trend}MB over time`);
  }
  
  // Show recent memory usage
  console.log('\n📈 Recent Memory Usage (last 10 samples):');
  logs.slice(-10).forEach(log => {
    console.log(`  ${log.timestamp}: RSS=${log.rss}MB, Heap=${log.heapUsed}MB`);
  });
}

analyzeMemoryLogs();
