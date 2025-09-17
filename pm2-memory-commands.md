# PM2 Memory Monitoring Commands

# 1. Real-time monitoring (shows CPU, Memory, etc.)
pm2 monit

# 2. Show detailed process info including memory
pm2 show Animu

# 3. List all processes with memory usage
pm2 list

# 4. Show memory usage over time (if pm2-logrotate is installed)
pm2 logs Animu --lines 100

# 5. Get memory usage in JSON format
pm2 jlist

# 6. Show process metrics
pm2 show Animu | grep -E '(memory|cpu|uptime)'

# 7. Monitor specific metrics
pm2 describe Animu | grep -E '(memory|cpu|restart)'
