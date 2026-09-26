const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  let offline = false;
  const log = [];
  const ctx = await b.newContext({ viewport: { width: 1470, height: 830 } });
  await ctx.route('https://math-quest.rraman.workers.dev/**', async (route) => {
    const url = route.request().url();
    if (offline) return route.abort('internetdisconnected');
    if (!url.includes('/tts')) return route.fulfill({ status: 200, contentType: 'application/json', body: 'null', headers: { 'Access-Control-Allow-Origin': '*' } });
    const t0 = Date.now();
    const body = execFileSync('curl', ['-s', '-H', 'Origin: https://ravisraman.github.io', url], { maxBuffer: 1 << 24 });
    log.push(`${decodeURIComponent(url.split('text=')[1]).slice(0, 40)} ${body.length}B ${Date.now() - t0}ms`);
    route.fulfill({ status: 200, body, headers: { 'Content-Type': 'audio/mpeg', 'Access-Control-Allow-Origin': 'http://localhost:8765' } });
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html');
  await p.evaluate(() => localStorage.setItem('mathQuest.save.v1', JSON.stringify({ player: { name: 'Leo', hero: '🐼' }, stars: 3, games: {} })));
  await p.reload(); await sleep(300);
  await p.keyboard.press('ArrowRight'); // unlock audio with a key press
  await p.evaluate(() => {
    window.__played = [];
    const V = MQ.Voice;
    const pb = V.playBuffer.bind(V); V.playBuffer = (buf) => { window.__played.push('natural ' + buf.duration.toFixed(2) + 's'); return pb(buf); };
    const ss = V.systemSay.bind(V); V.systemSay = (t, l) => { window.__played.push('device: ' + t); return ss(t, l); };
  });
  // 1) Two phrases in a row, English then Chinese (the grown-ups Test button).
  await p.click('#grownups-btn'); await sleep(200);
  await p.click('#gp-voice-test');
  await sleep(9000);
  console.log('1 played:', await p.evaluate(() => window.__played), '| now using:', await p.textContent('#gp-voice-now'));
  // 2) Interrupt: a second phrase with interrupt should cut the first.
  await p.evaluate(() => { window.__played = []; MQ.Voice.say('This is a long sentence that should be cut off by the next one right away.'); setTimeout(() => MQ.Voice.say('Level two. Collect exactly nine cents.', 'en-US', { interrupt: true }), 300); });
  await sleep(8000);
  console.log('2 played:', await p.evaluate(() => window.__played));
  // 3) Offline: falls back to the device voice (no hang).
  offline = true;
  await p.evaluate(() => { window.__played = []; MQ.Voice.say('Offline phrase number one.'); MQ.Voice.say('Offline phrase number two.'); });
  await sleep(9000);
  console.log('3 played:', await p.evaluate(() => window.__played), 'queue empty:', await p.evaluate(() => MQ.Voice.queue.length === 0 && !MQ.Voice.busy));
  // 4) Natural voice switched off in grown-ups -> device voice straight away.
  offline = false;
  await p.uncheck('#gp-natural'); await sleep(200);
  await p.evaluate(() => { window.__played = []; MQ.Voice.say('Switched off.'); });
  await sleep(2500);
  console.log('4 played:', await p.evaluate(() => window.__played), '| saved naturalVoice =', await p.evaluate(() => JSON.parse(localStorage.getItem('mathQuest.save.v1')).settings.naturalVoice));
  console.log('fetches:', log);
  console.log('errors:', errs);
  await b.close();
})();
