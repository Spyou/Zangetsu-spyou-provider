import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProvider, callProvider } from './host.mjs';

loadProvider('animedrive', new URL('../providers/animedrive.js', import.meta.url));

const LIVE = process.env.RUN_LIVE === '1';
const live = (name, fn) => test(name, { skip: LIVE ? false : 'set RUN_LIVE=1 to run network test' }, fn);

test('getInfo reports an anime provider', async () => {
  const info = JSON.parse(await callProvider('animedrive', 'getInfo', []));
  assert.equal(info.type, 'anime');
  assert.equal(info.name, 'AnimeDrive');
});

live('search returns anime cards (WP REST)', async () => {
  const rows = JSON.parse(await callProvider('animedrive', 'search', ['witch hat', 1, {}]));
  assert.ok(Array.isArray(rows) && rows.length > 0, 'expected results');
  assert.ok(rows[0].id && rows[0].url && rows[0].title, 'card shape');
  assert.match(rows[0].url, /animedrive\.in/);
  console.log('[animedrive] search top:', rows[0].title);
});

live('getDetail returns episodes from the gateway', async () => {
  const rows = JSON.parse(await callProvider('animedrive', 'search', ['witch hat', 1, {}]));
  const detail = JSON.parse(await callProvider('animedrive', 'getDetail', [rows[0].url, {}]));
  assert.ok(detail.title && detail.title.length > 0, 'expected title');
  assert.ok(Array.isArray(detail.episodes) && detail.episodes.length > 0, 'expected episodes');
  assert.ok(detail.episodes[0].url.indexOf('animedrive://') === 0, 'episode url scheme');
  console.log('[animedrive]', detail.title, '— episodes:', detail.episodes.length, '| malId:', detail.malId);
});

live('getVideoSources resolves HubCloud to a direct file', async () => {
  const rows = JSON.parse(await callProvider('animedrive', 'search', ['witch hat', 1, {}]));
  const detail = JSON.parse(await callProvider('animedrive', 'getDetail', [rows[0].url, {}]));
  const sources = JSON.parse(await callProvider('animedrive', 'getVideoSources', [detail.episodes[0].url]));
  assert.ok(Array.isArray(sources) && sources.length > 0, 'expected sources');
  assert.ok(sources.some((s) => /\.(mp4|mkv|m3u8)/i.test(s.url) || /pixeldrain|workers|\/file\//i.test(s.url)),
    'expected a direct file link, got: ' + sources[0].url);
  console.log('[animedrive] sources:', sources.map((s) => s.quality + ' ' + s.label).slice(0, 6));
});
