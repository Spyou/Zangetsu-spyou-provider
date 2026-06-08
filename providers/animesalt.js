// AnimeSalt — anime source (animesalt.ac + mirrors). Hindi/Tamil/Telugu/English/
// Japanese dubbed anime on a WordPress DooPlay-variant ("torofilm") theme.
//
//   search   -> /?s=  (article.post cards -> /series/ , /movies/)
//   detail   -> series page: data-post + season buttons; episodes for each season
//               via admin-ajax action_select_season; permalinks /episode/{slug}-SxE/
//   stream   -> episode page embeds an as-cdn*.top player (/video/<hex>); POST
//               <host>/player/index.php?data=<hex>&do=getVideo returns a signed
//               master.m3u8 that already carries every audio track (Hindi/JP/...).
//               That CDN is NOT Cloudflare-gated, so the master is directly playable.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'animesalt';

var MIRRORS = ['https://animesalt.ac', 'https://animesalt.to', 'https://animesalt.me', 'https://animesalt.ro'];
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function getInfo() {
  return { name: 'AnimeSalt', lang: 'hi', baseUrl: MIRRORS[0],
    logo: MIRRORS[0] + '/favicon.ico', type: 'anime', version: '1.0.0' };
}

function _trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }
function _abs(href, base) { return absUrl(href, base); }
function _get(url, ref) {
  return fetch(url, { headers: { 'User-Agent': UA, 'Referer': ref || url } })
    .then(function (r) { return r.body || ''; }).catch(function () { return ''; });
}

// First mirror that serves a real homepage wins (domains rotate). Cached per run.
var _main = null;
function _pickMain() {
  if (_main) return Promise.resolve(_main);
  function tryAt(i) {
    if (i >= MIRRORS.length) { _main = MIRRORS[0]; return _main; }
    return fetch(MIRRORS[i] + '/', { headers: { 'User-Agent': UA }, timeoutMs: 8000 })
      .then(function (r) {
        if (r && r.status && r.status < 500 && (r.body || '').length > 800) { _main = MIRRORS[i]; return _main; }
        return tryAt(i + 1);
      }).catch(function () { return tryAt(i + 1); });
  }
  return Promise.resolve(tryAt(0));
}

function _cleanTitle(raw) {
  return _trim(htmlText(raw || '').replace(/^\s*(?:download|watch)\s+/i, '')
    .replace(/^\s*animesalt\s*[|\-–:]\s*/i, ''));
}

// One <article class="post ...">…</article> block -> a card.
function _cardFromBlock(block, main) {
  var href = (block.match(/<a[^>]+href=['"]([^'"]+\/(?:series|movies)\/[^'"]+)['"]/i) || [])[1];
  if (!href) return null;
  var url = _abs(href, main);
  var title = _cleanTitle(
    (block.match(/<h[23][^>]*class=['"]entry-title['"][^>]*>([\s\S]*?)<\/h[23]>/i) || [])[1] ||
    (block.match(/<img[^>]+alt=['"]([^'"]*)['"]/i) || [])[1] || '');
  if (!title) return null;
  title = title.replace(/^image\s+/i, '');
  var img = (block.match(/<img[^>]+(?:data-src|data-lazy-src|src)=['"]((?:https?:)?\/\/[^'"]+\.(?:jpg|jpeg|png|webp)[^'"]*)['"]/i) || [])[1];
  var cover = img ? _abs(img, main) : null;
  return { id: url, title: title, cover: cover, url: url, type: 'anime', sourceId: SOURCE_ID };
}
function _cards(html, main) {
  var out = [], seen = {}, m;
  var re = /<article[^>]*\bclass=['"][^'"]*\bpost\b[^'"]*['"][^>]*>([\s\S]*?)<\/article>/gi;
  while ((m = re.exec(html)) !== null) {
    var c = _cardFromBlock(m[1], main);
    if (c && !seen[c.url]) { seen[c.url] = 1; out.push(c); }
  }
  return out;
}

function search(query, page, opts) {
  return _pickMain().then(function (main) {
    var p = (page && page > 1) ? ('/page/' + page) : '';
    return _get(main + p + '/?s=' + encodeURIComponent(query || ''), main + '/')
      .then(function (html) { return _cards(html, main); });
  }).catch(function () { return []; });
}

function getHome(opts) {
  var rows = [
    { title: 'Latest', path: '/' },
    { title: 'Movies', path: '/movies/' },
    { title: 'Series', path: '/series/' }
  ];
  return _pickMain().then(function (main) {
    return Promise.all(rows.map(function (r) {
      return _get(main + r.path, main + '/').then(function (html) {
        return { title: r.title, items: _cards(html, main) };
      }).catch(function () { return { title: r.title, items: [] }; });
    }));
  }).then(function (out) { return out.filter(function (s) { return s.items.length; }); })
    .catch(function () { return []; });
}

// episode page url packed with the chosen category, resolved lazily at playback.
function _epScheme(cat, pageUrl) { return 'animesalt://' + cat + '|' + encodeURIComponent(pageUrl); }

// Parse /episode/{slug}-SxE/ links out of an HTML fragment (page or ajax season).
function _episodesFromHtml(html, main, cat) {
  var out = [], seen = {}, m;
  var re = /<a[^>]+href=['"]([^'"]+\/episode\/[a-z0-9-]+-(\d+)x(\d+)\/?)['"][^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = re.exec(html)) !== null) {
    var url = _abs(m[1], main);
    if (seen[url]) continue; seen[url] = 1;
    var s = parseInt(m[2], 10) || 1, e = parseInt(m[3], 10) || (out.length + 1);
    var name = _trim(htmlText(m[4] || ''));
    out.push({ season: s, ep: e, name: (name && !/^episode\s*\d+$/i.test(name) && name.length < 80) ? name : '', url: url });
  }
  return out;
}

function _seasonAjax(main, postId, season, cat) {
  return fetch(main + '/wp-admin/admin-ajax.php', {
    method: 'POST',
    headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded', 'Referer': main + '/' },
    body: 'action=action_select_season&season=' + encodeURIComponent(season) + '&post=' + encodeURIComponent(postId)
  }).then(function (r) { return _episodesFromHtml(r.body || '', main, cat); })
    .catch(function () { return []; });
}

function getDetail(url, opts) {
  var cat = (opts && opts.category === 'dub') ? 'dub' : 'sub';
  return _pickMain().then(function (main) {
    var u = _abs(url, main);
    var isSeries = /\/series\//i.test(u);
    return _get(u, main + '/').then(function (html) {
      var title = _cleanTitle(
        (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] ||
        (html.match(/og:title"\s+content="([^"]+)"/i) || [])[1] || 'Untitled');
      var poster = (html.match(/og:image"\s+content="([^"]+)"/i) || [])[1] || null;
      var desc = _trim(htmlText((html.match(/og:description"\s+content="([^"]+)"/i) || [])[1] || ''));
      var year = (html.match(/datePublished"[^>]*>(\d{4})/i) || html.match(/(19|20)\d{2}/) || [])[0] || null;
      var genres = [], gm, gre = /\/genre\/[^"']+["'][^>]*>([^<]+)</gi;
      while ((gm = gre.exec(html)) !== null) { var g = _trim(gm[1]); if (g && genres.indexOf(g) < 0 && genres.length < 6) genres.push(g); }

      var base = { id: u, title: title, cover: poster, url: u, description: desc,
        status: 'unknown', genres: genres, studios: [], type: 'anime', sourceId: SOURCE_ID,
        year: year, subCount: 0, dubCount: 0, episodes: [] };

      var finish = function (raw) {
        raw.sort(function (a, b) { return (a.season - b.season) || (a.ep - b.ep); });
        var eps = [];
        for (var i = 0; i < raw.length; i++) {
          var r = raw[i], n = i + 1;
          eps.push({ id: 'S' + r.season + 'E' + r.ep, number: n,
            title: 'S' + r.season + ' E' + r.ep + (r.name ? ' · ' + r.name : ''),
            url: _epScheme(cat, r.url) });
        }
        base.episodes = eps; base.subCount = eps.length; base.dubCount = eps.length;
        return base;
      };

      if (!isSeries) {
        base.episodes = [{ id: 'movie', number: 1, title: title, url: _epScheme(cat, u) }];
        base.subCount = 1; base.dubCount = 1; return base;
      }
      var postId = (html.match(/data-post=['"](\d+)['"]/i) || [])[1];
      var seasons = [], sm, sre = /data-season=['"](\d+)['"]/gi, sseen = {};
      while ((sm = sre.exec(html)) !== null) { if (!sseen[sm[1]]) { sseen[sm[1]] = 1; seasons.push(parseInt(sm[1], 10)); } }
      // The active season's episodes are already in the page; fetch the rest by ajax.
      var inline = _episodesFromHtml(html, main, cat);
      if (!postId || seasons.length <= 1) return finish(inline);
      return Promise.all(seasons.map(function (s) { return _seasonAjax(main, postId, s, cat); }))
        .then(function (lists) {
          var all = inline.slice(), seen = {};
          for (var k = 0; k < inline.length; k++) seen[inline[k].url] = 1;
          for (var i = 0; i < lists.length; i++) {
            for (var j = 0; j < lists[i].length; j++) {
              var ep = lists[i][j]; if (!seen[ep.url]) { seen[ep.url] = 1; all.push(ep); }
            }
          }
          return finish(all);
        }).catch(function () { return finish(inline); });
    });
  }).catch(function () { return null; });
}

function getEpisodes(url, opts) { return getDetail(url, opts).then(function (d) { return d ? d.episodes : []; }); }

// as-cdn*.top embed -> getVideo JSON -> signed master.m3u8 (multi-audio).
function getVideoSources(episodeUrl) {
  var raw = String(episodeUrl).replace('animesalt://', '');
  var cut = raw.indexOf('|');
  var cat = cut > -1 ? raw.slice(0, cut) : 'dub';
  var pageUrl = decodeURIComponent(cut > -1 ? raw.slice(cut + 1) : raw);
  return _pickMain().then(function (main) {
    return _get(pageUrl, main + '/').then(function (html) {
      var iframe = (html.match(/https?:\/\/as-cdn\d*\.top\/video\/[a-f0-9]+/i) ||
        html.match(/(?:data-src|src)=['"](https?:\/\/[a-z0-9.-]*cdn\d*\.top\/video\/[a-f0-9]+)['"]/i)) || [];
      var embed = iframe[1] || iframe[0];
      if (!embed) throw new Error('AnimeSalt: no as-cdn player on episode page');
      var host = (embed.match(/^(https?:\/\/[^/]+)/) || [])[1];
      var hex = (embed.match(/\/video\/([a-f0-9]+)/i) || [])[1];
      if (!host || !hex) throw new Error('AnimeSalt: bad embed url ' + embed);
      return fetch(host + '/player/index.php?data=' + hex + '&do=getVideo', {
        method: 'POST',
        headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', 'Referer': embed }
      }).then(function (r) {
        var j; try { j = JSON.parse(r.body || 'null'); } catch (e) { j = null; }
        var master = j && (j.videoSource || j.securedLink);
        if (!master) throw new Error('AnimeSalt: getVideo returned no master');
        return [{
          url: master, quality: 'auto',
          container: /\.m3u8(\?|$)/i.test(master) ? 'hls' : 'mp4',
          headers: { 'User-Agent': UA, 'Referer': host + '/' },
          kind: cat, audioLang: cat === 'dub' ? 'hi' : 'ja', subtitles: [],
          label: 'AnimeSalt (multi-audio)'
        }];
      });
    });
  });
}
