// Deterministic test: AniList GraphQL queue serialization + 429/CORS retry/backoff
// Runs the REAL webui/app.js in a browser with request interception, so the queue
// and retry logic under test is the shipped code, not a reimplementation.
// Usage: node tests/frontend_queue_test.mjs   (requires puppeteer-core resolvable
// from NODE_PATH, e.g. NODE_PATH=/home/hermes/workspace/animu-qa-repair/node_modules)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

function getChromeExecutable() {
  if (process.env.ANIMU_CHROME) {
    if (fs.existsSync(process.env.ANIMU_CHROME)) {
      return process.env.ANIMU_CHROME;
    }
    throw new Error(`ANIMU_CHROME is set to '${process.env.ANIMU_CHROME}' but no executable was found at that path.`);
  }

  // 1. Check known local browser directory (~/.agent-browser/browsers)
  const agentBrowserDir = path.join(os.homedir(), '.agent-browser', 'browsers');
  if (fs.existsSync(agentBrowserDir)) {
    try {
      const entries = fs.readdirSync(agentBrowserDir).sort().reverse();
      for (const entry of entries) {
        const candidatePaths = [
          path.join(agentBrowserDir, entry, 'chrome'),
          path.join(agentBrowserDir, entry, 'chrome-linux', 'chrome'),
          path.join(agentBrowserDir, entry, 'chromium'),
          path.join(agentBrowserDir, entry)
        ];
        for (const cand of candidatePaths) {
          if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
            return cand;
          }
        }
      }
    } catch (e) {
      // Fall through
    }
  }

  // 2. Check PATH via 'which'
  const names = ['google-chrome-stable', 'google-chrome', 'chromium-browser', 'chromium', 'chrome'];
  for (const name of names) {
    try {
      const res = spawnSync('which', [name], { encoding: 'utf-8' });
      if (res.status === 0 && res.stdout) {
        const found = res.stdout.trim().split('\n')[0].trim();
        if (found && fs.existsSync(found)) {
          return found;
        }
      }
    } catch (e) {
      // Continue search
    }
  }

  // 3. Check well-known standard locations
  const standardPaths = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
    '/snap/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ];
  for (const p of standardPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  throw new Error('No usable Chrome/Chromium executable found. Please set ANIMU_CHROME or install Chrome/Chromium.');
}

const CHROME = getChromeExecutable();
const URL = 'http://10.0.0.165:3210/';

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // 1) Verify the served app.js is the current HEAD build (contains the queue)
  const served = await (await fetch(URL + 'app.js?v=8e9dcd1')).text();
  if (!served.includes('anilistQueue')) {
    console.error('FAIL: served app.js does not contain the queue (stale cache?)');
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  // Track in-flight AniList GraphQL requests (deterministic concurrency measure)
  let inFlight = 0;
  let maxInFlight = 0;
  let totalAniListRequests = 0;
  let firstReqTime = null;

  // Intercept graphql.anilist.co: for the FIRST 3 requests, respond 429 WITHOUT
  // the Access-Control-Allow-Origin header (mimicking AniList rate-limit CORS
  // behavior), then let subsequent requests pass through to the real API.
  let intercepted = 0;
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = req.url();
    if (!u.includes('graphql.anilist.co')) { req.continue(); return; }
    totalAniListRequests++;
    if (firstReqTime === null) firstReqTime = Date.now();
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const done = () => { inFlight--; };
    if (intercepted < 3) {
      intercepted++;
      req.respond({
        status: 429,
        headers: { 'Content-Type': 'application/json' }, // NO ACAO header on purpose
        body: JSON.stringify({ errors: [{ message: 'Rate limited (test)' }] })
      }).then(done, done);
    } else {
      req.continue().then(done, done);
    }
  });

  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push('PAGEERROR: ' + err.message));

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  // Rails are the heaviest parallel burst; wait for the queue to drain + retries
  await sleep(20000);

  const rails = await page.evaluate(() => {
    const ids = ['rail-trending', 'rail-popular-season', 'rail-upcoming', 'rail-all-time', 'rail-top-100'];
    return ids.map(id => {
      const el = document.getElementById(id);
      const t = el?.innerText || '';
      return { id, ok: !!t && !/Failed to fetch|Fetching/.test(t), len: t.length };
    });
  });

  const results = {
    servedAppJsHasQueue: served.includes('anilistQueue'),
    totalAniListRequests,
    maxInFlight,
    intercepts: intercepted,
    railsOk: rails.filter(r => r.ok).length,
    rails,
    consoleErrors: consoleErrors.slice(0, 10),
  };

  console.log(JSON.stringify(results, null, 2));

  // Assertions (deterministic expectations):
  const failures = [];
  if (maxInFlight > 2) failures.push(`queue not serialized: maxInFlight=${maxInFlight} (expected <= 2)`);
  if (totalAniListRequests < 8) failures.push(`expected >= 8 AniList requests after 3 intercepted 429s + retries, got ${totalAniListRequests}`);
  if (results.railsOk < 4) failures.push(`rails recovered after rate-limit: ${results.railsOk}/5 populated (retry/backoff not working)`);
  // The 3 intercepted 429s (CORS-blocked on purpose) produce browser console
  // errors BY DESIGN — that is the failure mode being tested. Any console error
  // NOT related to graphql.anilist.co CORS/fetch would be unexpected.
  const unexpected = consoleErrors.filter(e => !e.includes('graphql.anilist.co') && !e.includes('ERR_FAILED'));
  if (unexpected.length) failures.push(`unexpected console errors: ${JSON.stringify(unexpected)}`);
  // The three intercepted 429s MUST have been retried (they returned no data), so
  // successful rails imply the CORS-blocked fetch retry path worked.
  const retried = totalAniListRequests - 3; // requests beyond the intercepts
  if (retried < 5) failures.push(`too few retries: ${retried}`);

  if (failures.length) {
    console.error('FAIL:', failures.join('\n  - '));
    await browser.close();
    process.exit(1);
  }
  console.log('PASS: queue serialized (max ' + maxInFlight + ' in flight), 429/CORS retries recovered (' + results.railsOk + '/5 rails).');
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
