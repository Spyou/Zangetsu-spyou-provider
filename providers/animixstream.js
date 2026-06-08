// AnimixStream — anime source (animixstream.com). Hindi multi-audio anime on a
// custom PHP site.
//
//   search  -> /search.php?q=   (a.anime-card -> /anime.php?id=N)
//   detail  -> /anime.php?id=N  (h1 + JSON-LD ItemList of /watch.php?id=M episodes)
//   stream  -> /watch.php?id=M embeds play.zephyrflick.top/video/<hash>; POST
//              <host>/player/index.php?data=<hash>&do=getVideo returns a signed
//              master.m3u8 (multi-audio). The getVideo API + master are directly
//              reachable even though the embed's HTML player page is CF-challenged.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'animixstream';

var SITE = 'https://animixstream.com';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function getInfo() {
  return { name: 'AnimixStream', lang: 'hi', baseUrl: SITE,
    logo: SITE + '/favicon.ico', type: 'anime', version: '1.0.0' };
}

function _trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }
function _abs(href) { return absUrl(href, SITE); }
function _get(url, ref) {
  return fetch(url, { headers: { 'User-Agent': UA, 'Referer': ref || SITE + '/' } })
    .then(function (r) { return r.body || ''; }).catch(function () { return ''; });
}

// a.anime-card blocks -> cards.
function _cards(html) {
  var out = [], seen = {}, m;
  var re = /<a[^>]*class=['"][^'"]*anime-card[^'"]*['"][^>]*href=['"](\/anime\.php\?id=\d+)['"][^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = re.exec(html)) !== null) {
    var url = _abs(m[1]); if (seen[url]) continue; seen[url] = 1;
    var block = m[2];
    var title = _trim(htmlText(
      (block.match(/card-title[^>]*>([^<]+)/i) || [])[1] ||
      (block.match(/<img[^>]+alt=['"]([^'"]*)['"]/i) || [])[1] || ''));
    if (!title) continue;
    var cover = (block.match(/class=['"][^'"]*card-poster[^'"]*['"][^>]*src=['"]([^'"]+)['"]/i) ||
      block.match(/<img[^>]+src=['"]([^'"]+)['"]/i) || [])[1] || null;
    out.push({ id: url, title: title, cover: cover ? _abs(cover) : null, url: url, type: 'anime', sourceId: SOURCE_ID });
  }
  return out;
}

function search(query, page, opts) {
  return _get(SITE + '/search.php?q=' + encodeURIComponent(query || ''), SITE + '/')
    .then(_cards).catch(function () { return []; });
}

// Home page is one document with several titled <section> blocks of cards.
function getHome(opts) {
  return _get(SITE + '/', SITE + '/').then(function (html) {
    var rows = [], parts = html.split(/<section\b/i), i;
    for (i = 1; i < parts.length; i++) {
      var chunk = parts[i];
      var title = _trim(htmlText((chunk.match(/<h2[^>]*>([^<]+)<\/h2>/i) || [])[1] || ''));
      if (!title || /about|genre/i.test(title)) continue;
      var items = _cards(chunk);
      if (items.length) rows.push({ title: title, items: items });
    }
    if (!rows.length) { var all = _cards(html); if (all.length) rows = [{ title: 'Latest', items: all }]; }
    return rows;
  }).catch(function () { return []; });
}

function getDetail(url, opts) {
  var u = _abs(url);
  return _get(u, SITE + '/').then(function (html) {
    var title = _trim(htmlText(
      (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] ||
      (html.match(/og:title"\s+content="([^"]+)"/i) || [])[1] || 'Untitled'));
    var cover = (html.match(/og:image"\s+content="([^"]+)"/i) || [])[1] || null;
    var desc = _trim(htmlText((html.match(/og:description"\s+content="([^"]+)"/i) || [])[1] || ''));
    // Episodes come from the JSON-LD ItemList (position + watch url + name).
    var eps = [], m, seen = {};
    var re = /"position":(\d+),"url":"([^"]*\/watch\.php\?id=\d+)","name":"([^"]*)"/gi;
    while ((m = re.exec(html)) !== null) {
      var wu = _abs(m[2].replace(/\\\//g, '/')); if (seen[wu]) continue; seen[wu] = 1;
      var n = parseInt(m[1], 10) || (eps.length + 1);
      var name = _trim(htmlText(m[3] || '')).replace(/^Episode\s*\d+\s*—\s*/i, '');
      eps.push({ id: 'ep:' + n, number: n,
        title: (name && !/^episode\s*\d+$/i.test(name)) ? ('E' + n + ' · ' + name) : ('Episode ' + n),
        url: 'animixstream://' + encodeURIComponent(wu) });
    }
    // Fallback: bare watch links if the JSON-LD is absent.
    if (!eps.length) {
      var wm, wre = /href=['"]([^'"]*\/watch\.php\?id=\d+)['"]/gi;
      while ((wm = wre.exec(html)) !== null) {
        var w2 = _abs(wm[1]); if (seen[w2]) continue; seen[w2] = 1;
        var k = eps.length + 1;
        eps.push({ id: 'ep:' + k, number: k, title: 'Episode ' + k, url: 'animixstream://' + encodeURIComponent(w2) });
      }
    }
    eps.sort(function (a, b) { return a.number - b.number; });
    return { id: u, title: title, cover: cover, url: u, description: desc, status: 'unknown',
      genres: [], studios: [], type: 'anime', sourceId: SOURCE_ID, episodes: eps,
      subCount: eps.length, dubCount: eps.length };
  }).catch(function () { return null; });
}

function getEpisodes(url, opts) { return getDetail(url, opts).then(function (d) { return d ? d.episodes : []; }); }

// watch page -> zephyrflick (player-engine) embed -> getVideo -> signed master.m3u8.
function getVideoSources(episodeUrl) {
  var watchUrl = decodeURIComponent(String(episodeUrl).replace('animixstream://', ''));
  return _get(watchUrl, SITE + '/').then(function (html) {
    var embed = (html.match(/https?:\/\/(?:play\.)?[a-z0-9.-]*(?:zephyrflick|as-cdn)\d*\.top\/video\/[a-f0-9]+/i) ||
      html.match(/(?:data-src|src)=['"](https?:\/\/[a-z0-9.-]+\/video\/[a-f0-9]+)['"]/i)) || [];
    var url = embed[1] || embed[0];
    if (!url) throw new Error('AnimixStream: no player-engine embed on watch page');
    var host = (url.match(/^(https?:\/\/[^/]+)/) || [])[1];
    var hash = (url.match(/\/video\/([a-f0-9]+)/i) || [])[1];
    if (!host || !hash) throw new Error('AnimixStream: bad embed ' + url);
    return fetch(host + '/player/index.php?data=' + hash + '&do=getVideo', {
      method: 'POST',
      headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', 'Referer': url }
    }).then(function (r) {
      var j; try { j = JSON.parse(r.body || 'null'); } catch (e) { j = null; }
      var master = j && (j.videoSource || j.securedLink);
      if (!master) throw new Error('AnimixStream: getVideo returned no master');
      return [{
        url: master, quality: 'auto',
        container: /\.m3u8(\?|$)/i.test(master) ? 'hls' : 'mp4',
        headers: { 'User-Agent': UA, 'Referer': host + '/' },
        kind: 'dub', audioLang: 'hi', subtitles: [], label: 'AnimixStream (multi-audio)'
      }];
    });
  });
}
