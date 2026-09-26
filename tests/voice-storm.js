const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function wav(sec) { const sr = 8000, n = sr * sec, b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); return b; }
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1470, height: 830 } });
  let mode = 'ok'; const fetched = [];
  await ctx.route('https://math-quest.rraman.workers.dev/**', async (route) => {
    const url = route.request().url();
    if (!url.includes('/tts')) return route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
    fetched.push(decodeURIComponent(url.split('text=')[1]));
    const h = { 'Access-Control-Allow-Origin': 'http://localhost:8765' };
    if (mode === '429') return route.fulfill({ status: 429, body: '{"error":"slow down"}', headers: { ...h, 'Content-Type': 'application/json' } });
    setTimeout(() => route.fulfill({ status: 200, body: wav(0.6), headers: { ...h, 'Content-Type': 'audio/wav' } }), 300);
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html');
  await p.keyboard.press('ArrowRight');
  await p.evaluate(() => { window.__played = []; const V = MQ.Voice;
    const pb = V.playBuffer.bind(V); V.playBuffer = (x) => { __played.push('natural'); return pb(x); };
    V.systemSay = (t) => { __played.push('device: ' + t); return Promise.resolve(); }; });
  // 1) Drag storm: 10 step phrases 80ms apart, each interrupting the last. Only the last should be fetched.
  await p.evaluate(async () => { for (let i = 1; i <= 10; i++) { MQ.Voice.say(`${i}! Now go to the red dot.`, 'en-US', { interrupt: true }); await new Promise(r => setTimeout(r, 80)); } });
  await sleep(2500);
  console.log('1 storm fetched', fetched.length, fetched, 'played', await p.evaluate(() => __played));
  // 2) Rate-limited: one 429 -> device voice briefly, NOT until tomorrow.
  mode = '429'; fetched.length = 0;
  await p.evaluate(() => { __played = []; MQ.Voice.say('Rate limited phrase.'); });
  await sleep(1500);
  const until = await p.evaluate(() => MQ.Voice.cloudDownUntil - Date.now());
  console.log('2 after 429: played', await p.evaluate(() => __played), 'paused for', Math.round(until / 1000), 's (expect ~20)');
  // 3) Queue of 4 phrases: none should fall back to the device voice.
  mode = 'ok'; await p.evaluate(() => { MQ.Voice.cloudDownUntil = 0; __played = []; ['One two three.', 'Four five six.', 'Seven eight nine.', 'Ten eleven twelve.'].forEach(t => MQ.Voice.say(t)); });
  await sleep(6000);
  console.log('3 queue played', await p.evaluate(() => __played));
  console.log('errors', errs); await b.close();
})();
