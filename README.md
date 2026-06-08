# Zangetsu Spyou Provider Sources

Extra streaming sources for the [Zangetsu](https://github.com/Spyou/Zangetsu) app.
Each `.js` in `providers/` is a self-contained scraper for one site, installed at
runtime via the manifest.

## Install

Settings → Sources → Add repo, paste the `index.json` raw URL.

## Sources

| Source | Type | Notes |
| --- | --- | --- |
| AnimeLok | Anime | Hindi/English dub & Japanese sub; direct HLS + subtitle tracks (AniList metadata + MAL tracker sync). Stream CDN is Cloudflare-gated — playback depends on the player passing Cloudflare. |
| AnimeSalt | Anime | Multi-language dub (Hindi/Tamil/Telugu/English/Japanese) in a single HLS master. Directly playable. |
| AnimixStream | Anime | Hindi multi-audio anime; directly-playable HLS master. |
| NetPrime | Movie / Series | TMDB catalog (+ TMDB tracker sync). Streams come from third-party embed hosts that use browser-signed, IP-locked tokens — not resolvable in a headless runtime, so playback is best-effort only. |

## Development

`npm test` runs offline contract tests. `npm run test:live` runs the
network-backed integration tests (hits the live sites).
