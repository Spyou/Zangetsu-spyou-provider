import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProvider, callProvider } from './host.mjs';

loadProvider('animixstream', new URL('../providers/animixstream.js', import.meta.url));

const LIVE = process.env.RUN_LIVE === '1';
const live = (name, fn) => test(name, { skip: LIVE ? false : 'set RUN_LIVE=1 to run network test' }, fn);

test('getInfo reports an anime provider', async () => {
  const info = JSON.parse(await callProvider('animixstream', 'getInfo', []));
  assert.equal(info.type, 'anime');
  assert.equal(info.name, 'AnimixStream');
});

live('search returns anime cards', async () => {
  const rows = JSON.parse(await callProvider('animixstream', 'search', ['naruto', 1, {}]));
  assert.ok(Array.isArray(rows) && rows.length > 0, 'expected results');
  assert.ok(rows[0].id && rows[0].url && rows[0].title, 'card shape');
  assert.match(rows[0].url, /\/anime\.php\?id=\d+/);
});

live('getHome returns named sections with items', async () => {
  const sections = JSON.parse(await callProvider('animixstream', 'getHome', [{}]));
  assert.ok(Array.isArray(sections) && sections.length >= 1, 'expected sections');
  assert.ok(sections.some((s) => s.items.length > 0), 'at least one row has items');
});

live('getDetail returns episodes', async () => {
  const rows = JSON.parse(await callProvider('animixstream', 'search', ['naruto', 1, {}]));
  const detail = JSON.parse(await callProvider('animixstream', 'getDetail', [rows[0].url, {}]));
  assert.ok(detail.title && detail.title.length > 0, 'expected title');
  assert.ok(Array.isArray(detail.episodes) && detail.episodes.length > 0, 'expected episodes');
  assert.ok(detail.episodes[0].url.indexOf('animixstream://') === 0, 'episode url scheme');
  console.log('[animixstream]', detail.title, '— episodes:', detail.episodes.length);
});

live('getVideoSources returns a directly-playable master.m3u8', async () => {
  const rows = JSON.parse(await callProvider('animixstream', 'search', ['solo leveling', 1, {}]));
  const detail = JSON.parse(await callProvider('animixstream', 'getDetail', [rows[0].url, {}]));
  const sources = JSON.parse(await callProvider('animixstream', 'getVideoSources', [detail.episodes[0].url]));
  assert.ok(sources.length > 0, 'expected sources');
  assert.match(sources[0].url, /\.m3u8/, 'expected m3u8, got ' + sources[0].url);
  assert.equal(sources[0].container, 'hls');
  const m3u8 = await (await fetch(sources[0].url, { headers: sources[0].headers })).text();
  assert.ok(/#EXTM3U/.test(m3u8), 'expected a real HLS playlist, got: ' + m3u8.slice(0, 120));
  console.log('[animixstream] master OK:', sources[0].url.slice(0, 70));
});
