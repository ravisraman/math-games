# Math Quest tests

The site has no build step. These scripts drive the real pages in a headless Chromium.

## Setup (once)

```
npm install
npx playwright install chromium
```

## Run

```
npm test
```

This starts a local server on port 8765 and runs:

| Script | What it checks |
|---|---|
| `worker-unit.mjs` | The Cloudflare Worker (`cloud/worker.js`): sync GET/PUT/DELETE, save validation, quota errors, voice caching. No network. |
| `phone-journey.js` | Opens all four games from the portal at iPhone 17 Pro sizes (upright and sideways) and the 13" MacBook Air size. Fails on page errors or page scrolling. Screenshots go to `tests/out/`. |
| `sync-scenarios.js` | Ten laptop + phone sync stories (join after Start over, two tabs, playing at the same time, erase, …) against a fake sync server. |
| `voice-storm.js` | The read-aloud queue: fast dragging only fetches the last phrase, a busy server pauses the natural voice for 20 s (not all day), and queued phrases never fall back to the robot voice. Fake voice server. |
| `voice-test.js` | Optional (`VOICE_LIVE=1 npm test`): fetches real speech from the live Worker. Needs internet. |

The cloud Worker is faked in every test except `voice-test.js`, so running tests never touches your saved progress.
