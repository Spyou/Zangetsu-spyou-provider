import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProvider, callProvider } from './host.mjs';

loadProvider('animesalt', new URL('../providers/animesalt.js', import.meta.url));

const LIVE = process.env.RUN_LIVE === '1';
const live = (name, fn) => test(name, { skip: LIVE ? false : 'set RUN_LIVE=1 to run network test' }, fn);

test('getInfo reports an anime provider', async () => {
  const info = JSON.parse(await callProvider('animesalt', 'getInfo', []));
  assert.equal(info.type, 'anime');
  assert.equal(info.name, 'AnimeSalt');
});

live('search returns anime cards', async () => {
  const rows = JSON.parse(await callProvider('animesalt', 'search', ['naruto', 1, {}]));
  assert.ok(Array.isArray(rows) && rows.length > 0, 'expected results');
  assert.ok(rows[0].id && rows[0].url && rows[0].title, 'card shape');
  assert.match(rows[0].url, /\/(series|movies)\//);
});

live('getHome returns named sections with items', async () => {
  const sections = JSON.parse(await callProvider('animesalt', 'getHome', [{}]));
  assert.ok(Array.isArray(sections) && sections.length >= 1, 'expected sections');
  assert.ok(sections.some((s) => s.items.length > 0), 'at least one row has items');
});

live('getDetail returns episodes across seasons (multi-season series)', async () => {
  const rows = JSON.parse(await callProvider('animesalt', 'search', ['naruto', 1, {}]));
  const series = rows.find((r) => /\/series\//.test(r.url)) || rows[0];
  const detail = JSON.parse(await callProvider('animesalt', 'getDetail', [series.url, { category: 'dub' }]));
  assert.ok(detail.title && detail.title.length > 0, 'expected title');
  assert.ok(Array.isArray(detail.episodes) && detail.episodes.length > 0, 'expected episodes');
  assert.ok(detail.episodes[0].url.indexOf('animesalt://') === 0, 'episode url scheme');
  console.log('[animesalt]', detail.title, '— episodes:', detail.episodes.length);
});

live('getVideoSources returns a directly-playable master.m3u8', async () => {
  const rows = JSON.parse(await callProvider('animesalt', 'search', ['naruto', 1, {}]));
  const series = rows.find((r) => /\/series\//.test(r.url)) || rows[0];
  const detail = JSON.parse(await callProvider('animesalt', 'getDetail', [series.url, { category: 'dub' }]));
  const sources = JSON.parse(await callProvider('animesalt', 'getVideoSources', [detail.episodes[0].url]));
  assert.ok(sources.length > 0, 'expected sources');
  assert.match(sources[0].url, /\.m3u8/, 'expected m3u8, got ' + sources[0].url);
  assert.equal(sources[0].container, 'hls');
  // as-cdn*.top is not Cloudflare-gated — the signed master must actually play.
  const m3u8 = await (await fetch(sources[0].url, { headers: sources[0].headers })).text();
  assert.ok(/#EXTM3U/.test(m3u8), 'expected a real HLS playlist, got: ' + m3u8.slice(0, 120));
  const audios = (m3u8.match(/TYPE=AUDIO/g) || []).length;
  console.log('[animesalt] master OK:', sources[0].url.slice(0, 70), '| audio tracks:', audios);
});
