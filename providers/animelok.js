// AnimeLok — anime source (animelok.online). Hindi/multi-language dubbed anime.
//
// The site is a Next.js app. Three data sources are used, each the cleanest path:
//   • search / home  -> the page's RSC flight payload (fetch with the `RSC: 1`
//     header) which lists cards as {"slug":"<name>-<anilistId>"} + an <img alt/src>.
//   • detail metadata -> AniList GraphQL, keyed by the anilistId in the slug
//     (animelok IS built on AniList ids and even serves AniList CDN covers; this
//     also yields idMal for tracker sync). The site's own detail page 404s a
//     server-side RSC fetch because the slug URL redirects to an opaque id.
//   • streams -> /api/get-vibeplayer-data?anilistId=&epNum=&type=sub|dub, which
//     returns a plain master.m3u8 + VTT subtitle tracks (no decryption).
//
// type=dub is the Hindi dub; type=sub is the original (Japanese) audio.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'animelok';

var SITE = 'https://animelok.online';
var ANILIST = 'https://graphql.anilist.co';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function getInfo() {
  return { name: 'AnimeLok', lang: 'hi', baseUrl: SITE,
    logo: SITE + '/favicon.ico', type: 'anime', version: '1.0.0' };
}

function _mode(opts) { return (opts && opts.category === 'dub') ? 'dub' : 'sub'; }
function _anilistId(s) { var m = String(s || '').match(/-(\d+)(?:[/?#].*)?$/); return m ? m[1] : null; }
function _titleFromSlug(slug) {
  return String(slug || '').replace(/-\d+$/, '').replace(/-/g, ' ')
    .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}

// Fetch a route's RSC flight payload (text/x-component). The `RSC: 1` header
// makes Next return the flight rather than full HTML.
function _flight(path) {
  return fetch(SITE + path, { headers: { 'User-Agent': UA, 'Referer': SITE + '/', 'RSC': '1' } })
    .then(function (r) { return r.body || ''; }).catch(function () { return ''; });
}

// Each card link in the flight is exactly {"slug":"<name>-<anilistId>"}, followed
// within a few hundred chars by the cover <img>'s "src" and "alt" (the title).
function _cards(flight) {
  var out = [], seen = {}, m;
  var re = /\{"slug":"([a-z0-9-]+-\d+)"\}/g;
  while ((m = re.exec(flight)) !== null) {
    var slug = m[1];
    if (seen[slug]) continue; seen[slug] = 1;
    var tail = flight.slice(m.index, m.index + 700);
    var cover = (tail.match(/"src":"(https?:\/\/[^"]+)"/) || [])[1] || null;
    var alt = (tail.match(/"alt":"([^"]*)"/) || [])[1];
    var title = (alt && alt.length) ? alt : _titleFromSlug(slug);
    out.push({ id: '/anime/' + slug, title: title, cover: cover,
      url: '/anime/' + slug, type: 'anime', sourceId: SOURCE_ID });
  }
  return out;
}

function search(query, page, opts) {
  var q = String(query || '').trim();
  if (q.length < 2) return Promise.resolve([]);
  return _flight('/search?keyword=' + encodeURIComponent(q)).then(_cards)
    .catch(function () { return []; });
}

function getHome(opts) {
  var rows = [
    { title: 'Hindi Dub', path: '/languages/hindi' },
    { title: 'Trending', path: '/home' },
    { title: 'English Dub', path: '/languages/english' },
    { title: 'Movies', path: '/movies' }
  ];
  return Promise.all(rows.map(function (r) {
    return _flight(r.path).then(function (f) { return { title: r.title, items: _cards(f) }; })
      .catch(function () { return { title: r.title, items: [] }; });
  })).then(function (out) { return out.filter(function (s) { return s.items.length; }); })
    .catch(function () { return []; });
}

// AniList metadata, keyed by the anilistId from the slug. Best-effort: any failure
// leaves a minimal detail built from the slug so the source still degrades cleanly.
var _ANILIST_GQL = 'query($id:Int){Media(id:$id,type:ANIME){idMal title{romaji english}'
  + ' episodes status seasonYear genres description(asHtml:false) coverImage{large}'
  + ' nextAiringEpisode{episode}}}';

function _statusOf(s) {
  if (s === 'RELEASING') return 'ongoing';
  if (s === 'FINISHED') return 'completed';
  return 'unknown';
}

function _epUrl(aid, cat, n) { return 'animelok://' + aid + '/' + cat + '/' + n; }

function getDetail(url, opts) {
  var aid = _anilistId(url);
  var cat = _mode(opts);
  var slug = String(url).replace(/^.*\/anime\//, '');
  var base = { id: String(url), title: _titleFromSlug(slug), url: String(url),
    cover: null, description: '', status: 'unknown', genres: [], studios: [],
    type: 'anime', sourceId: SOURCE_ID, episodes: [], subCount: 0, dubCount: 0,
    year: null, malId: null };
  if (!aid) return Promise.resolve(base);
  return fetch(ANILIST, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ query: _ANILIST_GQL, variables: { id: parseInt(aid, 10) } })
  }).then(function (r) {
    var j; try { j = JSON.parse(r.body || 'null'); } catch (e) { j = null; }
    var md = j && j.data && j.data.Media;
    if (md) {
      base.title = (md.title && (md.title.english || md.title.romaji)) || base.title;
      base.englishTitle = (md.title && md.title.english) || null;
      base.cover = (md.coverImage && md.coverImage.large) || null;
      base.description = htmlText(md.description || '');
      base.status = _statusOf(md.status);
      base.genres = (md.genres || []).slice(0, 6);
      base.year = md.seasonYear || null;
      base.malId = (md.idMal != null) ? parseInt(md.idMal, 10) : null;
    }
    var count = (md && md.episodes) ||
      (md && md.nextAiringEpisode && md.nextAiringEpisode.episode ? md.nextAiringEpisode.episode - 1 : 0);
    if (!count || count < 1) count = 0;
    var eps = [];
    for (var n = 1; n <= count; n++) {
      eps.push({ id: cat + ':' + n, number: n, title: 'Episode ' + n, url: _epUrl(aid, cat, n) });
    }
    base.episodes = eps;
    // Both audio tracks share the AniList episode count; actual availability is
    // resolved per-episode at playback (vibeplayer 404s a missing dub).
    base.subCount = eps.length; base.dubCount = eps.length;
    return base;
  }).catch(function () { return base; });
}

function getEpisodes(url, opts) { return getDetail(url, opts).then(function (d) { return d.episodes; }); }

// Returns the official stream descriptor (master.m3u8 + subtitle tracks). NOTE:
// the CDN that serves the playlist (hawk.24stream.xyz) is behind a Cloudflare WAF
// that blocks non-cleared clients, so playback depends on the player/network
// passing Cloudflare — the runtime has no WebView/CF bypass to obtain clearance.
function getVideoSources(episodeUrl) {
  var parts = String(episodeUrl).replace('animelok://', '').split('/');
  var aid = parts[0], cat = (parts[1] === 'dub') ? 'dub' : 'sub', n = parts[2];
  var u = SITE + '/api/get-vibeplayer-data?anilistId=' + encodeURIComponent(aid) +
    '&epNum=' + encodeURIComponent(n) + '&type=' + cat;
  return fetch(u, { headers: { 'User-Agent': UA, 'Referer': SITE + '/' } }).then(function (r) {
    var j; try { j = JSON.parse(r.body || 'null'); } catch (e) { j = null; }
    var srcs = (j && j.sources) || [];
    if (!srcs.length) throw new Error('AnimeLok: no sources for ep ' + n + ' (' + cat + ')');
    var subs = [];
    var tracks = (j && j.tracks) || [];
    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i];
      if (!t || !t.url) continue;
      if (t.kind && t.kind !== 'captions' && t.kind !== 'subtitles') continue;
      subs.push({ url: t.url, lang: t.lang || t.label || 'Sub', label: t.label || t.lang || 'Sub',
        format: /\.srt(\?|$)/i.test(t.url) ? 'srt' : 'vtt', 'default': !!t['default'] });
    }
    var hdrs = { 'User-Agent': UA, 'Referer': SITE + '/' };
    var out = [];
    for (var k = 0; k < srcs.length; k++) {
      var s = srcs[k]; if (!s || !s.url) continue;
      out.push({ url: s.url, quality: s.quality || 'auto',
        container: /\.m3u8(\?|$)/i.test(s.url) ? 'hls' : 'mp4',
        headers: hdrs, kind: cat, audioLang: cat === 'dub' ? 'hi' : 'ja', subtitles: subs });
    }
    if (!out.length) throw new Error('AnimeLok: no playable sources');
    return out;
  });
}
