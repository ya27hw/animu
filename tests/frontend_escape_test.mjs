import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const app = require('../webui/app.js');

const {
  escapeHtml,
  sanitizeHtml,
  renderDiscoverCardHtml,
  renderAiringRadarItemHtml,
  renderSeasonalItemHtml,
  renderWatchingItemHtml,
  renderListEntryHtml,
  renderSearchResultHtml,
  renderSocialActivityHtml,
  renderHistoryItemHtml,
  renderNyaaCandidateHtml,
  showToastHtml,
  SUBTAB_STATUS_MAP
} = app;

test('B1 (a): escapeHtml accurately escapes &, <, >, ", and \'', () => {
  assert.equal(escapeHtml('&'), '&amp;');
  assert.equal(escapeHtml('<'), '&lt;');
  assert.equal(escapeHtml('>'), '&gt;');
  assert.equal(escapeHtml('"'), '&quot;');
  assert.equal(escapeHtml("'"), '&#39;');

  // Combined string with all 5 special characters
  const complex = '<div class="alert" data-val=\'test\' &="special">Hello</div>';
  const expected = '&lt;div class=&quot;alert&quot; data-val=&#39;test&#39; &amp;=&quot;special&quot;&gt;Hello&lt;/div&gt;';
  assert.equal(escapeHtml(complex), expected);

  // Null, undefined, numbers
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(12345), '12345');
});

test('B1 (b): Malicious title renders escaped in card title AND alt attribute across representative render paths', () => {
  const maliciousTitle = '<img src=x onerror=alert(1)>" onmouseover=alert(2)';
  const expectedEscapedTitle = '&lt;img src=x onerror=alert(1)&gt;&quot; onmouseover=alert(2)';

  const media = {
    id: 9999,
    title: {
      romaji: maliciousTitle,
      english: maliciousTitle,
      userPreferred: maliciousTitle
    },
    coverImage: {
      large: 'https://example.com/malicious.jpg'
    },
    format: 'TV',
    seasonYear: 2026,
    episodes: 12,
    averageScore: 99
  };

  // 1. Dark Discover Card
  const darkCardHtml = renderDiscoverCardHtml(media, 'dark');
  assert.ok(
    darkCardHtml.includes(`alt="${expectedEscapedTitle}"`),
    'Dark card alt attribute must contain escaped title'
  );
  assert.ok(
    darkCardHtml.includes(`title="${expectedEscapedTitle}"`),
    'Dark card title attribute must contain escaped title'
  );
  assert.ok(
    darkCardHtml.includes(`>${expectedEscapedTitle}</h4>`),
    'Dark card text node must contain escaped title'
  );
  assert.equal(
    darkCardHtml.includes('<img src=x onerror=alert(1)>'),
    false,
    'Dark card must not contain raw unescaped img tag payload'
  );

  // 2. Light Discover Card
  const lightCardHtml = renderDiscoverCardHtml(media, 'light');
  assert.ok(
    lightCardHtml.includes(`alt="${expectedEscapedTitle}"`),
    'Light card alt attribute must contain escaped title'
  );
  assert.ok(
    lightCardHtml.includes(`title="${expectedEscapedTitle}"`),
    'Light card title attribute must contain escaped title'
  );
  assert.ok(
    lightCardHtml.includes(`>${expectedEscapedTitle}</h4>`),
    'Light card text node must contain escaped title'
  );
  assert.equal(
    lightCardHtml.includes('<img src=x onerror=alert(1)>'),
    false,
    'Light card must not contain raw unescaped img tag payload'
  );

  // 3. Airing Radar Item (Dark & Light)
  const darkRadarHtml = renderAiringRadarItemHtml(media, 'dark');
  assert.ok(darkRadarHtml.includes(`alt="${expectedEscapedTitle}"`));
  assert.ok(darkRadarHtml.includes(`title="${expectedEscapedTitle}"`));
  assert.ok(darkRadarHtml.includes(`>${expectedEscapedTitle}</span>`));
  assert.equal(darkRadarHtml.includes('<img src=x onerror=alert(1)>'), false);

  const lightRadarHtml = renderAiringRadarItemHtml(media, 'light');
  assert.ok(lightRadarHtml.includes(`alt="${expectedEscapedTitle}"`));
  assert.ok(lightRadarHtml.includes(`title="${expectedEscapedTitle}"`));
  assert.ok(lightRadarHtml.includes(`>${expectedEscapedTitle}</span>`));
  assert.equal(lightRadarHtml.includes('<img src=x onerror=alert(1)>'), false);

  // 4. Seasonal Item (Dark & Light)
  const darkSeasonalHtml = renderSeasonalItemHtml(media, 'dark');
  assert.ok(darkSeasonalHtml.includes(`alt="${expectedEscapedTitle}"`));
  assert.ok(darkSeasonalHtml.includes(`title="${expectedEscapedTitle}"`));
  assert.ok(darkSeasonalHtml.includes(`>${expectedEscapedTitle}</span>`));
  assert.equal(darkSeasonalHtml.includes('<img src=x onerror=alert(1)>'), false);

  const lightSeasonalHtml = renderSeasonalItemHtml(media, 'light');
  assert.ok(lightSeasonalHtml.includes(`alt="${expectedEscapedTitle}"`));
  assert.ok(lightSeasonalHtml.includes(`title="${expectedEscapedTitle}"`));
  assert.ok(lightSeasonalHtml.includes(`>${expectedEscapedTitle}</span>`));
  assert.equal(lightSeasonalHtml.includes('<img src=x onerror=alert(1)>'), false);

  // 5. Watching Cockpit Item
  const watchingHtml = renderWatchingItemHtml({ id: 9999, name: maliciousTitle, image: 'https://example.com/cover.jpg' });
  assert.ok(watchingHtml.includes(`alt="${expectedEscapedTitle}"`));
  assert.ok(watchingHtml.includes(`>${expectedEscapedTitle}</h3>`));
  assert.equal(watchingHtml.includes('<img src=x onerror=alert(1)>'), false);

  // 6. Lists Collection Entry
  const listEntryHtml = renderListEntryHtml({ media, score: 90, progress: 5 });
  assert.ok(listEntryHtml.includes(`alt="${expectedEscapedTitle}"`));
  assert.ok(listEntryHtml.includes(`>${expectedEscapedTitle}</h4>`));
  assert.equal(listEntryHtml.includes('<img src=x onerror=alert(1)>'), false);

  // 7. Global Search Result
  const searchHtml = renderSearchResultHtml(media);
  assert.ok(searchHtml.includes(`alt="${expectedEscapedTitle}"`));
  assert.ok(searchHtml.includes(`>${expectedEscapedTitle}</h4>`));
  assert.equal(searchHtml.includes('<img src=x onerror=alert(1)>'), false);
});

test('B1 (c): sanitizeHtml strips tags then escapes remaining special characters', () => {
  const dirty = '<p>Hello <script>alert(1)</script> <b>world</b> "quote" & \'apos\'</p>';
  const sanitized = sanitizeHtml(dirty);
  assert.equal(sanitized.includes('<'), false);
  assert.equal(sanitized.includes('>'), false);
  assert.ok(sanitized.includes('&quot;quote&quot;'));
  assert.ok(sanitized.includes('&amp; &#39;apos&#39;'));
  assert.equal(sanitizeHtml(null), '');
});

test('N5: Toast messages are strictly escaped', () => {
  const maliciousToast = '<b onmouseover=alert(1)>Failed to load "file" & \'item\'</b>';
  const toastHtml = showToastHtml(maliciousToast, 'error');
  assert.ok(toastHtml.includes('&lt;b onmouseover=alert(1)&gt;Failed to load &quot;file&quot; &amp; &#39;item&#39;&lt;/b&gt;'));
  assert.equal(toastHtml.includes('<b onmouseover'), false);
});

test('N1 & N2: SUBTAB_STATUS_MAP properly maps Airing, Upcoming, TBA, and Archive', () => {
  assert.equal(SUBTAB_STATUS_MAP.Airing, 'RELEASING');
  assert.equal(SUBTAB_STATUS_MAP.Upcoming, 'NOT_YET_RELEASED');
  assert.equal(SUBTAB_STATUS_MAP.TBA, 'NOT_YET_RELEASED');
  assert.equal(SUBTAB_STATUS_MAP.Archive, 'FINISHED');
});
