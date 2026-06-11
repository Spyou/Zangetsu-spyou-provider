// AnimeDrive — anime source (animedrive.in). Hindi/Tamil/Telugu/English/Japanese
// multi-audio anime, download-style (direct files), so it plays AND downloads in
// the app.
//
//   search / home -> WordPress REST API (/wp-json/wp/v2/posts) — clean JSON.
//   detail        -> the post links out to a gateway (link.animedrive.in/...);
//                    that page lists, per "Episode N", HubCloud + FilePress links
//                    at 480p/720p/1080p.
//   stream/download -> resolve HubCloud (hubcloud.foo/drive/<id>) to a direct
//                    file (FSL / Buzz / Pixeldrain / S3 / 10Gbps / Mega), same
//                    chain 4K HDHub uses. Direct files => native play + download.
//   tracker       -> malId resolved best-effort from AniList by title.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'animedrive';

var SITE = 'https://animedrive.in';
var ANILIST = 'https://graphql.anilist.co';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function getInfo() {
  return { name: 'AnimeDrive', lang: 'hi', baseUrl: SITE,
    logo: SITE + '/favicon.ico', type: 'anime', version: '1.0.1' };
}

function _trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }
function _quality(s) { var m = String(s || '').match(/(\d{3,4})[pP]/); return m ? (m[1] + 'p') : null; }
function _get(url, ref) {
  return fetch(url, { headers: { 'User-Agent': UA, 'Referer': ref || SITE + '/' } })
    .then(function (r) { return r.body || ''; }).catch(function () { return ''; });
}
// Strip the trailing " ... Hindi/Multi-Audio ... Download" boilerplate from titles.
function _cleanTitle(t) {
  t = htmlText(t || '');
  t = t.replace(/\s+(Hindi|Tamil|Telugu|English|Japanese|Multi[ -]?Audio|Dual[ -]?Audio|WEB-?DL|Episodes?|Download|Free)\b.*$/i, '');
  return _trim(t) || _trim(htmlText(t));
}

// ── catalog (HTML scrape — same approach as the app-proven providers) ─────────
// Each post card is a thumbnail link carrying the title in aria-label + an <img>.
function _cards(html) {
  var out = [], seen = {}, m;
  var re = /<a[^>]+href="(https:\/\/animedrive\.in\/[a-z0-9][a-z0-9-]*\/)"[^>]*aria-label="Read:\s*([^"]*)"[^>]*>[\s\S]{0,300}?<img[^>]+src="([^"]+)"/gi;
  while ((m = re.exec(html)) !== null) {
    var url = m[1];
    if (seen[url]) continue; seen[url] = 1;
    if (/\/(category|tag|author|page|request-anime|about|contact|privacy|dmca)\b/i.test(url)) continue;
    var title = _cleanTitle(m[2]);
    if (!title) continue;
    var cover = (m[3] && m[3].indexOf('http') === 0) ? m[3] : null;
    out.push({ id: url, title: title, cover: cover, url: url, type: 'anime', sourceId: SOURCE_ID });
  }
  return out;
}

function search(query, page, opts) {
  var q = String(query || '').trim();
  if (q.length < 2) return Promise.resolve([]);
  var p = (page && page > 1) ? ('/page/' + page) : '';
  return _get(SITE + p + '/?s=' + encodeURIComponent(q), SITE + '/').then(_cards)
    .catch(function () { return []; });
}

function getHome(opts) {
  var rows = [
    { title: 'Latest', path: '/' },
    { title: 'Hindi Dubbed', path: '/category/hindi-dubbed-anime/' },
    { title: 'Anime Download', path: '/category/anime-download/' }
  ];
  return Promise.all(rows.map(function (r) {
    return _get(SITE + r.path, SITE + '/').then(function (html) {
      return { title: r.title, items: _cards(html) };
    }).catch(function () { return { title: r.title, items: [] }; });
  })).then(function (out) { return out.filter(function (s) { return s.items.length; }); })
    .catch(function () { return []; });
}

// ── detail (post -> gateway -> episodes) ──────────────────────────────────────
function _epUrl(hrefs) { return 'animedrive://' + encodeURIComponent(JSON.stringify(hrefs)); }
function _epHrefs(url) {
  try { return JSON.parse(decodeURIComponent(String(url).replace(/^animedrive:\/\//, ''))); }
  catch (e) { return []; }
}

// Parse the gateway HTML into [{ number, hrefs:[hubcloud...] }] by walking the
// "Episode N" markers and collecting the HubCloud links that follow each.
function _episodesFromGateway(html) {
  var marks = [], m;
  var re = /Episode\s*(\d+)/gi;
  while ((m = re.exec(html)) !== null) marks.push({ n: parseInt(m[1], 10), at: m.index });
  if (!marks.length) return [];
  // Dedup consecutive markers for the same episode (label may appear twice).
  var segs = [];
  for (var i = 0; i < marks.length; i++) {
    var start = marks[i].at;
    var end = (i + 1 < marks.length) ? marks[i + 1].at : html.length;
    var prev = segs.length ? segs[segs.length - 1] : null;
    if (prev && prev.n === marks[i].n) { prev.end = end; continue; }
    segs.push({ n: marks[i].n, start: start, end: end });
  }
  var byEp = {};
  for (var s = 0; s < segs.length; s++) {
    var block = html.slice(segs[s].start, segs[s].end);
    var hrefs = [], hm;
    var hre = /href="(https?:\/\/[a-z0-9.-]*hubcloud[a-z0-9.-]*\/[^"]+)"/gi;
    while ((hm = hre.exec(block)) !== null) hrefs.push(hm[1]);
    if (!hrefs.length) continue;
    var key = segs[s].n;
    byEp[key] = (byEp[key] || []).concat(hrefs);
  }
  var out = [];
  Object.keys(byEp).forEach(function (k) {
    var n = parseInt(k, 10);
    var uniq = byEp[k].filter(function (v, idx, a) { return a.indexOf(v) === idx; });
    out.push({ number: n, hrefs: uniq });
  });
  out.sort(function (a, b) { return a.number - b.number; });
  return out;
}

function getDetail(url, opts) {
  var u = String(url);
  return _get(u, SITE + '/').then(function (html) {
    var title = _cleanTitle((html.match(/og:title"\s+content="([^"]+)"/i) || [])[1] ||
      (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || 'Untitled');
    var cover = (html.match(/og:image"\s+content="([^"]+)"/i) || [])[1] || null;
    var desc = _trim(htmlText((html.match(/og:description"\s+content="([^"]+)"/i) || [])[1] || ''));
    var year = (html.match(/\b(20\d{2})\b/) || [])[0] || null;
    var gateway = (html.match(/https?:\/\/link\.animedrive\.in\/[^"'\s<>]+/i) || [])[0];
    var base = { id: u, title: title, cover: cover, url: u, description: desc,
      status: 'unknown', genres: [], studios: [], type: 'anime', sourceId: SOURCE_ID,
      year: year, subCount: 0, dubCount: 0, episodes: [], malId: null };

    var buildEps = function (gwHtml) {
      var eps = _episodesFromGateway(gwHtml);
      base.episodes = eps.map(function (e) {
        return { id: 'ep:' + e.number, number: e.number, title: 'Episode ' + e.number,
          url: _epUrl(e.hrefs) };
      });
      base.subCount = base.episodes.length; base.dubCount = base.episodes.length;
    };

    var gwP = gateway ? _get(gateway, u) : Promise.resolve('');
    return gwP.then(function (gwHtml) {
      if (gwHtml) buildEps(gwHtml);
      // best-effort MAL id for tracker sync (AniList by title)
      return _malId(title).then(function (mal) { base.malId = mal; return base; })
        .catch(function () { return base; });
    }).catch(function () { return base; });
  }).catch(function () { return null; });
}

function getEpisodes(url, opts) { return getDetail(url, opts).then(function (d) { return d ? d.episodes : []; }); }

// AniList: title -> idMal (best-effort, never blocks).
function _malId(title) {
  var q = String(title || '').replace(/\bseason\b.*$/i, '').replace(/\(.*$/, '').trim();
  if (!q) return Promise.resolve(null);
  return fetch(ANILIST, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ query: 'query($s:String){Media(search:$s,type:ANIME){idMal}}', variables: { s: q } })
  }).then(function (r) {
    var j; try { j = JSON.parse(r.body || 'null'); } catch (e) { j = null; }
    var mal = j && j.data && j.data.Media && j.data.Media.idMal;
    return mal ? parseInt(mal, 10) : null;
  }).catch(function () { return null; });
}

// ── HubCloud resolver (ported from the 4K HDHub provider) ─────────────────────
function _src(url, quality, label) {
  var hls = /\.m3u8(\?|$)/i.test(url);
  return { url: url, quality: quality || 'auto', container: hls ? 'hls' : 'mp4',
    headers: { 'User-Agent': UA }, kind: 'dub', audioLang: 'hi', subtitles: [],
    label: _trim(label || '') };
}
function _serverName(label) {
  if (label.indexOf('fsl') !== -1) return 'FSL Server';
  if (label.indexOf('buzz') !== -1) return 'Buzz Server';
  if (label.indexOf('pixeldra') !== -1 || label.indexOf('pixel') !== -1) return 'Pixeldrain';
  if (label.indexOf('s3') !== -1) return 'S3 Server';
  if (label.indexOf('10gb') !== -1) return '10Gbps';
  if (label.indexOf('mega') !== -1) return 'Mega';
  if (label.indexOf('pdl') !== -1) return 'PDL Server';
  if (label.indexOf('download') !== -1) return 'Download';
  return 'Server';
}
function _hubServer(link, label, info) {
  var server = _serverName(label);
  var name = 'AnimeDrive [' + server + ']' + (info.size ? ' [' + info.size + ']' : '');
  var q = info.quality;
  if (label.indexOf('buzzserver') !== -1 || label.indexOf('buzz') !== -1) {
    return fetch(link + '/download', { headers: { 'Referer': link, 'User-Agent': UA }, followRedirects: false })
      .then(function (r) { var h = r.headers || {}; var dl = h['hx-redirect'] || h['HX-Redirect'] || ''; return dl ? _src(dl, q, name) : null; })
      .catch(function () { return null; });
  }
  if (label.indexOf('pixeldra') !== -1 || label.indexOf('pixel') !== -1) {
    var b = (link.match(/^(https?:\/\/[^/]+)/) || [])[1] || '';
    var fin = link.indexOf('download') !== -1 ? link
      : (b + '/api/file/' + link.replace(/\/$/, '').split('/').pop() + '?download');
    return Promise.resolve(_src(fin, q, name));
  }
  if (label.indexOf('fsl') !== -1 || label.indexOf('download file') !== -1 ||
      label.indexOf('s3 server') !== -1 || label.indexOf('mega') !== -1 ||
      label.indexOf('pdl') !== -1 || label.indexOf('10gbps') !== -1) {
    return Promise.resolve(_src(link, q, name));
  }
  if (/\.(mp4|mkv|m3u8)(\?|$)/i.test(link)) return Promise.resolve(_src(link, q, name));
  return Promise.resolve(null);
}
function _hubcloud(url) {
  var base = (url.match(/^(https?:\/\/[^/]+)/) || [])[1] || '';
  var step1 = url.indexOf('hubcloud.php') !== -1
    ? Promise.resolve(url)
    : _get(url).then(function (html) {
        var raw = (html.match(/id=["']download["'][^>]*href="([^"]+)"/) ||
                   html.match(/href="([^"]+)"[^>]*id=["']download["']/) || [])[1] || '';
        if (!raw) return '';
        return /^https?:/i.test(raw) ? raw : (base + '/' + raw.replace(/^\//, ''));
      });
  return step1.then(function (href) {
    if (!href) return [];
    return _get(href).then(function (doc) {
      var title = htmlText((doc.match(/<div class="card-header[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '');
      var size = htmlText((doc.match(/id=["']size["'][^>]*>([\s\S]*?)<\//) || [])[1] || '');
      var quality = _quality(title) || _quality(url) || 'auto';
      var info = { size: size, quality: quality };
      var jobs = [], m;
      var re = /<a[^>]*href="([^"]+)"[^>]*class="[^"]*\bbtn\b[^"]*"[^>]*>([\s\S]*?)<\/a>|<a[^>]*class="[^"]*\bbtn\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      while ((m = re.exec(doc)) !== null) {
        var link = m[1] || m[3]; var text = htmlText(m[2] || m[4] || '').toLowerCase();
        if (!link) continue;
        jobs.push(_hubServer(link, text, info));
      }
      return Promise.all(jobs).then(function (lists) {
        var out = []; for (var i = 0; i < lists.length; i++) if (lists[i]) out.push(lists[i]);
        return out;
      });
    });
  }).catch(function () { return []; });
}

function getVideoSources(episodeUrl) {
  var hrefs = _epHrefs(episodeUrl).slice(0, 8);
  if (!hrefs.length) return Promise.reject(new Error('AnimeDrive: no download links for this episode'));
  var jobs = hrefs.map(function (h) { return _hubcloud(h).catch(function () { return []; }); });
  return Promise.all(jobs).then(function (lists) {
    var out = [], seen = {};
    for (var i = 0; i < lists.length; i++) {
      var arr = lists[i] || [];
      for (var k = 0; k < arr.length; k++) {
        var s = arr[k];
        if (s && s.url && !seen[s.url]) { seen[s.url] = 1; out.push(s); }
      }
    }
    if (!out.length) throw new Error('AnimeDrive: no playable links resolved');
    return out;
  });
}
