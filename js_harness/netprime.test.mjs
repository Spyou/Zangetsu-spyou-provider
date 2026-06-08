import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProvider, callProvider } from './host.mjs';

loadProvider('netprime', new URL('../providers/netprime.js', import.meta.url));

const LIVE = process.env.RUN_LIVE === '1';
const live = (name, fn) => test(name, { skip: LIVE ? false : 'set RUN_LIVE=1 to run network test' }, fn);

test('getInfo reports a movie provider', async () => {
  const info = JSON.parse(await callProvider('netprime', 'getInfo', []));
  assert.equal(info.type, 'movie');
  assert.equal(info.name, 'NetPrime');
});

live('search returns TMDB-backed cards', async () => {
  const rows = JSON.parse(await callProvider('netprime', 'search', ['inception', 1, {}]));
  assert.ok(Array.isArray(rows) && rows.length > 0, 'expected results');
  assert.match(rows[0].id, /^(movie|tv):\d+$/, 'id is type:tmdbId');
});

live('getHome returns named sections with items', async () => {
  const sections = JSON.parse(await callProvider('netprime', 'getHome', [{}]));
  assert.ok(Array.isArray(sections) && sections.length >= 1, 'expected sections');
  assert.ok(sections.some((s) => s.items.length > 0), 'at least one row has items');
});

live('getDetail returns episodes + tmdbId for a TV title', async () => {
  const rows = JSON.parse(await callProvider('netprime', 'search', ['breaking bad', 1, {}]));
  const tv = rows.find((r) => /^tv:/.test(r.id)) || rows[0];
  const detail = JSON.parse(await callProvider('netprime', 'getDetail', [tv.id, {}]));
  assert.ok(detail.title && detail.title.length > 0, 'expected title');
  assert.ok(detail.tmdbId > 0, 'expected tmdbId for tracker sync');
  assert.equal(typeof detail.tmdbIsTv, 'boolean');
  assert.ok(Array.isArray(detail.episodes) && detail.episodes.length > 0, 'expected episodes');
});

live('getDetail returns a single playable item for a movie', async () => {
  const rows = JSON.parse(await callProvider('netprime', 'search', ['inception', 1, {}]));
  const movie = rows.find((r) => /^movie:/.test(r.id)) || rows[0];
  const detail = JSON.parse(await callProvider('netprime', 'getDetail', [movie.id, {}]));
  assert.equal(detail.tmdbIsTv, false);
  assert.equal(detail.episodes.length, 1);
  assert.equal(detail.episodes[0].url, 'netprime://movie/' + detail.tmdbId + '/0/0');
});

// Playback: the six embed providers (vidnest/vidfast/vidsrc/peachify/vidcore/
// vidify) serve their streams via browser-computed signed tokens — vidnest's
// purstream API 502s server-side and its URL is IP-locked; the others are
// obfuscated SPAs with no liftable m3u8. A headless runtime (no JS sandbox /
// WebView for the embed) cannot resolve them, so this is documented-skipped per
// the design spec. getVideoSources still ATTEMPTS all six and throws cleanly
// (never returns a fake source) — see the next test.
test('getVideoSources: embed resolution (documented-skip)', { skip: 'embed hosts use browser-signed/IP-locked tokens; not resolvable headless (see spec risks)' }, () => {});

live('getVideoSources rejects cleanly when no embed yields a stream (no fake source)', async () => {
  let threw = false, sources = null;
  try {
    sources = JSON.parse(await callProvider('netprime', 'getVideoSources', ['netprime://movie/27205/0/0']));
  } catch (e) { threw = true; }
  // Either an embed happened to expose a plain m3u8 (then we got real sources),
  // or nothing resolved and it threw — but it must never return an empty/garbage list.
  if (!threw) {
    assert.ok(Array.isArray(sources) && sources.length > 0, 'if it returns, sources must be non-empty');
    assert.ok(/\.m3u8/.test(sources[0].url), 'returned source must be a real m3u8');
    console.log('[netprime] an embed resolved:', sources[0].label, sources[0].url.slice(0, 60));
  } else {
    console.log('[netprime] embeds did not resolve headless (expected; documented in spec)');
  }
});
