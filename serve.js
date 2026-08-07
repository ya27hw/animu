const http = require('http');
const fs = require('fs');
const path = require('path');

let host = '127.0.0.1';
let port = 4173;

for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === '--host' && process.argv[i + 1]) host = process.argv[i + 1];
  if (process.argv[i] === '--port' && process.argv[i + 1]) port = parseInt(process.argv[i + 1], 10);
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.join(__dirname, 'webui', reqPath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(filePath).pipe(res);
  } else {
    // Fallback to index.html for SPA routes
    const indexPath = path.join(__dirname, 'webui', 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(indexPath).pipe(res);
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Preview server running at http://127.0.0.1:${port}/`);
});
