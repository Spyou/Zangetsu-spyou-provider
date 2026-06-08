// NetPrime — movie/TV source (netprime.to). A TMDB-driven catalog whose streams
// come from third-party multi-embed hosts keyed by TMDB id.
//
//   catalog -> TMDB v3 (search/popular/trending + movie|tv detail + seasons).
//              tmdbId + tmdbIsTv are returned for tracker sync (Simkl).
//   stream  -> BEST-EFFORT. NetPrime iframes six commercial embed providers
//              (vidnest/vidfast/vidsrc/peachify/vidcore/vidify). They serve their
//              streams via obfuscated, browser-computed signed tokens (and vidnest's
//              URL is IP-locked), so a headless runtime cannot reliably resolve
//              them — the runtime has no JS sandbox / WebView for the embeds.
//              getVideoSources tries to lift a plain m3u8 from each host and
//              returns whatever it finds, else throws a clear error. It never
//              fabricates a source. See the per-host note in getVideoSources.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'netprime';

var SITE = 'https://netprime.to';
var TMDB = 'https://api.themoviedb.org/3';
var IMG = 'https://image.tmdb.org/t/p/w500';
// TMDB v3 key shipped in the NetPrime web bundle.
var TMDB_KEY = '086323fee7102f209a9c773da9381ea1';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function getInfo() {
  return { name: 'NetPrime', lang: 'en', baseUrl: SITE,
    logo: SITE + '/favicon.ico', type: 'movie', version: '1.0.0' };
}

function _tmdbOnce(url) {
  return fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } })
    .then(function (r) { var j; try { j = JSON.parse(r.body || 'null'); } catch (e) { j = null; } return j; });
}
// TMDB occasionally drops a connection; retry once before giving up.
function _tmdb(path) {
  var sep = path.indexOf('?') === -1 ? '?' : '&';
  var url = TMDB + path + sep + 'api_key=' + TMDB_KEY;
  return _tmdbOnce(url).catch(function () { return _tmdbOnce(url); }).catch(function () { return null; });
}

function _mkId(type, id) { return type + ':' + id; }
function _parseId(s) { var p = String(s).split(':'); return { type: p[0] === 'tv' ? 'tv' : 'movie', id: p[1] }; }

function _cardFromTmdb(r) {
  if (!r || !r.id) return null;
  if (r.media_type === 'person') return null;
  var isTv = (r.media_type === 'tv') || (r.first_air_date != null && r.title == null && r.name != null);
  var type = isTv ? 'tv' : 'movie';
  var title = r.title || r.name || 'Untitled';
  var date = r.release_date || r.first_air_date || '';
  return { id: _mkId(type, r.id), title: title,
    cover: r.poster_path ? (IMG + r.poster_path) : null,
    url: _mkId(type, r.id), type: 'movie', sourceId: SOURCE_ID,
    year: (String(date).match(/(19|20)\d{2}/) || [])[0] || null };
}
function _cards(list) {
  var out = []; list = list || [];
  for (var i = 0; i < list.length; i++) { var c = _cardFromTmdb(list[i]); if (c) out.push(c); }
  return out;
}

function search(query, page, opts) {
  var q = String(query || '').trim();
  if (q.length < 2) return Promise.resolve([]);
  return _tmdb('/search/multi?query=' + encodeURIComponent(q) + '&page=' + (page || 1) + '&include_adult=false')
    .then(function (j) { return _cards((j && j.results) || []); })
    .catch(function () { return []; });
}

function getHome(opts) {
  var rows = [
    { title: 'Trending', path: '/trending/all/week' },
    { title: 'Popular Movies', path: '/movie/popular' },
    { title: 'Popular TV', path: '/tv/popular' },
    { title: 'Top Rated Movies', path: '/movie/top_rated' }
  ];
  return Promise.all(rows.map(function (r) {
    return _tmdb(r.path).then(function (j) { return { title: r.title, items: _cards((j && j.results) || []) }; })
      .catch(function () { return { title: r.title, items: [] }; });
  })).then(function (out) { return out.filter(function (s) { return s.items.length; }); })
    .catch(function () { return []; });
}

function _epScheme(type, id, s, e) { return 'netprime://' + type + '/' + id + '/' + (s || 0) + '/' + (e || 0); }

function getDetail(url, opts) {
  var p = _parseId(url);
  var isTv = p.type === 'tv';
  return _tmdb('/' + p.type + '/' + p.id).then(function (d) {
    d = d || {};
    var title = d.title || d.name || String(url);
    var base = { id: _mkId(p.type, p.id), title: title,
      cover: d.poster_path ? (IMG + d.poster_path) : null, url: _mkId(p.type, p.id),
      description: d.overview || '', status: d.status || 'unknown',
      genres: (d.genres || []).map(function (g) { return g.name; }).slice(0, 6),
      studios: [], type: 'movie', sourceId: SOURCE_ID,
      year: (String(d.release_date || d.first_air_date || '').match(/(19|20)\d{2}/) || [])[0] || null,
      episodes: [], subCount: 0, dubCount: 0,
      tmdbId: parseInt(p.id, 10), tmdbIsTv: isTv };
    if (!isTv) {
      base.episodes = [{ id: 'movie', number: 1, title: title, url: _epScheme('movie', p.id, 0, 0) }];
      base.subCount = 1; return base;
    }
    var seasons = (d.seasons || []).filter(function (s) { return s.season_number > 0; });
    if (!seasons.length) return base;
    return Promise.all(seasons.map(function (s) {
      return _tmdb('/tv/' + p.id + '/season/' + s.season_number).then(function (sd) {
        return ((sd && sd.episodes) || []).map(function (ep) {
          return { id: 'S' + s.season_number + 'E' + ep.episode_number, number: ep.episode_number, season: s.season_number,
            title: 'S' + s.season_number + ' E' + ep.episode_number + (ep.name ? ' · ' + ep.name : ''),
            thumbnail: ep.still_path ? (IMG + ep.still_path) : null,
            url: _epScheme('tv', p.id, s.season_number, ep.episode_number) };
        });
      }).catch(function () { return []; });
    })).then(function (lists) {
      var eps = lists.reduce(function (a, b) { return a.concat(b || []); }, []);
      eps.sort(function (a, b) { return (a.season - b.season) || (a.number - b.number); });
      base.episodes = eps; base.subCount = eps.length; return base;
    });
  }).catch(function () { return null; });
}

function getEpisodes(url, opts) { return getDetail(url, opts).then(function (d) { return d ? d.episodes : []; }); }

// Embed hosts NetPrime iframes, keyed by TMDB id. movie: `${base}${id}`,
// tv: `${base}${id}/${season}/${episode}`. vidnest exposes a JSON API; the rest
// are obfuscated SPAs (kept for the best-effort HTML scan / future changes).
var EMBEDS = [
  { name: 'VidNest', movie: 'https://new.vidnest.fun/purstream/movie/', tv: 'https://new.vidnest.fun/purstream/tv/', ref: 'https://vidnest.fun/' },
  { name: 'VidFast', movie: 'https://vidfast.pro/movie/', tv: 'https://vidfast.pro/tv/', ref: 'https://vidfast.pro/' },
  { name: 'VidSrc', movie: 'https://vidsrc-embed.ru/embed/movie/', tv: 'https://vidsrc-embed.ru/embed/tv/', ref: 'https://vidsrc-embed.ru/' },
  { name: 'Peachify', movie: 'https://peachify.top/embed/movie/', tv: 'https://peachify.top/embed/tv/', ref: 'https://peachify.top/' },
  { name: 'VidCore', movie: 'https://vidcore.net/movie/', tv: 'https://vidcore.net/tv/', ref: 'https://vidcore.net/' },
  { name: 'Vidify', movie: 'https://player.vidify.top/embed/movie/', tv: 'https://player.vidify.top/embed/tv/', ref: 'https://player.vidify.top/' }
];

function _embedUrl(host, type, id, s, e) {
  if (type === 'tv') return host.tv + id + '/' + s + '/' + e;
  return host.movie + id;
}

function _tryEmbed(host, type, id, s, e) {
  var url = _embedUrl(host, type, id, s, e);
  return fetch(url, { headers: { 'User-Agent': UA, 'Referer': host.ref, 'Accept': '*/*' } }).then(function (r) {
    var body = r.body || '', unp = ''; try { unp = unpackJs(body); } catch (ex) {}
    var hay = body + ' ' + unp;
    var m3 = (hay.match(/https?:\/\/[^"'\\ ]+\.m3u8[^"'\\ ]*/) || [])[0] ||
      (hay.match(/["']file["']\s*:\s*["']([^"']+\.m3u8[^"']*)/i) || [])[1] ||
      (hay.match(/["']url["']\s*:\s*["']([^"']+\.m3u8[^"']*)/i) || [])[1] || null;
    if (!m3) return null;
    return { url: m3, quality: 'auto', container: 'hls',
      headers: { 'User-Agent': UA, 'Referer': host.ref }, kind: 'sub', audioLang: '',
      subtitles: [], label: 'NetPrime [' + host.name + ']' };
  }).catch(function () { return null; });
}

// BEST-EFFORT: try every embed for a directly-liftable m3u8. The embed providers
// guard their streams with browser-computed signed tokens (vidnest's URL is also
// IP-locked), so this commonly resolves nothing from a headless runtime — in which
// case it throws rather than returning a fake/broken source.
function getVideoSources(episodeUrl) {
  var raw = String(episodeUrl).replace('netprime://', '').split('/');
  var type = raw[0] === 'tv' ? 'tv' : 'movie', id = raw[1], s = raw[2] || 1, e = raw[3] || 1;
  if (!id) return Promise.reject(new Error('NetPrime: missing TMDB id'));
  var jobs = EMBEDS.map(function (h) { return _tryEmbed(h, type, id, s, e); });
  return Promise.all(jobs).then(function (list) {
    var out = [], seen = {};
    for (var i = 0; i < list.length; i++) {
      var src = list[i];
      if (src && src.url && !seen[src.url]) { seen[src.url] = 1; out.push(src); }
    }
    if (!out.length) {
      throw new Error('NetPrime: embeds did not yield a directly-playable stream '
        + '(vidnest/vidfast/vidsrc/peachify/vidcore/vidify use browser-signed, '
        + 'IP-locked tokens that a headless runtime cannot resolve)');
    }
    return out;
  });
}
