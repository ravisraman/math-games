const { chromium } = require('playwright');
const B = process.env.BASE || 'http://localhost:8765/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, info) => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };

(async () => {
  const b = await chromium.launch();
  let store = {};
  let puts = 0;
  const mock = async (route) => {
    const req = route.request();
    const m = new URL(req.url()).pathname.match(/^\/sync\/([A-Z0-9]{12,40})$/);
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (m && req.method() === 'GET') return route.fulfill({ status: 200, headers, body: store[m[1]] || 'null' });
    if (m && req.method() === 'PUT') { puts++; store[m[1]] = req.postData(); return route.fulfill({ status: 200, headers, body: '{"ok":true}' }); }
    if (m && req.method() === 'DELETE') { delete store[m[1]]; return route.fulfill({ status: 200, headers, body: '{"ok":true}' }); }
    return route.fulfill({ status: 404, headers, body: '{}' });
  };
  async function device(name, mobile) {
    const ctx = await b.newContext(mobile ? { viewport: { width: 402, height: 740 }, isMobile: true, hasTouch: true } : { viewport: { width: 1470, height: 830 } });
    await ctx.route('https://math-quest.rraman.workers.dev/**', mock);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => results.push(`ERROR(${name}) ${e.message}`));
    await p.goto(B + 'index.html');
    return p;
  }
  const saveOf = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('mathQuest.save.v1')));
  const setSave = (p, d) => p.evaluate((d) => { localStorage.setItem('mathQuest.save.v1', JSON.stringify(d)); localStorage.removeItem('mathQuest.sync.v1'); }, d);
  const legacy = (stars, games, name = 'Leo') => ({ player: { name, hero: '🐼' }, settings: { sound: true, music: true, voice: true, chinese: true }, stars, playSeconds: stars * 60, games });
  const cc = (played, level, rows) => ({ level, maxLevel: level, played, seconds: played * 40, history: rows, quiz: {} });
  const rows = (n, day) => Array.from({ length: n }, (_, i) => ({ level: 1 + (i % 5), stars: 3, target: 20, overshoots: 0, bonks: 0, seconds: 40, date: `2026-09-${day}T10:${String(i).padStart(2, '0')}:00Z` }));
  const turnOn = async (p) => { await p.reload(); await sleep(300); return p.evaluate(async () => { await MQ.Sync.start(); return MQ.Sync.code; }); };
  const join = async (p, code) => { await p.reload(); await sleep(300); return p.evaluate(async (c) => { try { await MQ.Sync.join(c); return 'ok'; } catch (e) { return e.message; } }, code); };

  // ---- A. Joining after "Start over" must not wipe the family (review HIGH #1a)
  {
    store = {};
    const lap = await device('lap'); const ph = await device('ph', true);
    await setSave(lap, legacy(90, { coinCrossing: cc(30, 6, rows(30, 10)) }));
    const code = await turnOn(lap);
    await setSave(ph, legacy(5, { numberFlow: cc(2, 2, rows(2, 11)) }, 'kid'));
    await ph.reload(); await sleep(300);
    await ph.evaluate(() => MQ.reset());
    await sleep(300);
    const r = await join(ph, code);
    await lap.reload(); await sleep(1500);
    const L = await saveOf(lap); const P = await saveOf(ph);
    check('A join after Start over keeps family progress', r === 'ok' && L.stars === 90 && P.stars === 90 && L.games.coinCrossing && L.games.coinCrossing.played === 30 && P.player.name === 'Leo', `lap ${L.stars}★ cc=${L.games.coinCrossing && L.games.coinCrossing.played} phone ${P.stars}★ name=${P.player.name}`);
    await lap.context().close(); await ph.context().close();
  }
  // ---- B. Restore-backup on laptop, then phone with its own progress joins (review HIGH #1b)
  {
    store = {};
    const lap = await device('lap'); const ph = await device('ph', true);
    await lap.reload(); await sleep(200);
    await lap.evaluate((t) => MQ.importText(t), JSON.stringify(legacy(30, { coinCrossing: cc(10, 3, rows(10, 12)) })));
    const code = await turnOn(lap);
    await setSave(ph, legacy(36, { castleClimb: cc(12, 4, rows(12, 13)) }, 'Leo'));
    const r = await join(ph, code);
    await lap.reload(); await sleep(1500);
    const L = await saveOf(lap); const P = await saveOf(ph);
    check('B join after Restore keeps the joiner\'s own games', r === 'ok' && !!P.games.castleClimb && !!P.games.coinCrossing && !!L.games.castleClimb && P.stars === 66 && L.stars === 66, `phone ${P.stars}★ games=${Object.keys(P.games)} lap ${L.stars}★`);
    await lap.context().close(); await ph.context().close();
  }
  // ---- C. A copied (backup) save must not double-count stars (review MEDIUM #2)
  {
    store = {};
    const lap = await device('lap'); const ph = await device('ph', true);
    const same = legacy(63, { coinCrossing: cc(21, 5, rows(21, 14)) });
    await setSave(lap, same);
    const code = await turnOn(lap);
    const copy = JSON.parse(JSON.stringify(same)); copy.games.coinCrossing.history.push({ level: 5, stars: 2, seconds: 50, date: '2026-09-20T09:00:00Z' }); copy.games.coinCrossing.played = 22; copy.stars = 65;
    await setSave(ph, copy);
    await join(ph, code);
    await lap.reload(); await sleep(1500);
    const L = await saveOf(lap); const P = await saveOf(ph);
    check('C copied backup not counted twice (+2 new stars only)', L.stars === 65 && P.stars === 65 && L.games.coinCrossing.played === 22, `lap ${L.stars}★ phone ${P.stars}★ played=${L.games.coinCrossing.played}`);
    await lap.context().close(); await ph.context().close();
  }
  // ---- D. An open game page must not revert the other device's level edit / settings (review MEDIUM #3)
  {
    store = {};
    const lap = await device('lap'); const ph = await device('ph', true);
    await setSave(lap, legacy(40, { castleClimb: cc(20, 7, rows(20, 15)) }));
    const code = await turnOn(lap);
    await setSave(ph, legacy(0, {}));
    await join(ph, code);
    await ph.goto(B + 'games/castle-climb/index.html'); await sleep(1500);
    // Laptop: grown-up lowers the level to 5 and changes the voice.
    await lap.reload(); await sleep(500);
    await lap.evaluate(async () => { const d = MQ.load(); d.games.castleClimb.level = 5; d.settings.voiceName = 'orion'; d.settings.chinese = false; MQ.save(d); await MQ.Sync.now(); });
    // Phone app comes back to the front, then its periodic persist fires (time only) and the kid toggles music.
    await ph.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    await sleep(1500);
    await ph.evaluate(async () => { const d = MQ._live; d.games.castleClimb.seconds += 15; d.playSeconds += 15; d.settings.music = false; MQ.save(d); await MQ.Sync.now(); });
    await lap.reload(); await sleep(1500);
    const L = await saveOf(lap);
    check('D open page keeps the other device\'s level + settings', L.games.castleClimb.level === 5 && L.settings.voiceName === 'orion' && L.settings.chinese === false && L.settings.music === false, `level=${L.games.castleClimb.level} voice=${L.settings.voiceName} chinese=${L.settings.chinese} music=${L.settings.music}`);
    await lap.context().close(); await ph.context().close();
  }
  // ---- E. Both devices play at once: stars add up, games merge field by field
  {
    store = {};
    const lap = await device('lap'); const ph = await device('ph', true);
    await setSave(lap, legacy(30, { coinCrossing: cc(8, 5, rows(8, 16)) }));
    const code = await turnOn(lap);
    await setSave(ph, legacy(0, {}));
    await join(ph, code);
    await lap.evaluate(async () => { const d = MQ.load(); d.games.coinCrossing.played = 9; d.games.coinCrossing.history.push({ level: 5, stars: 3, date: '2026-09-25T01:00:00Z' }); d.stars += 3; MQ.save(d); await MQ.Sync.now(); });
    await ph.evaluate(async () => { const d = MQ.load(); d.games.coinCrossing.played = 9; d.games.coinCrossing.maxLevel = 6; d.games.coinCrossing.history.push({ level: 5, stars: 2, date: '2026-09-25T01:00:30Z' }); d.stars += 2; MQ.save(d); await MQ.Sync.now(); });
    await lap.evaluate(() => MQ.Sync.now()); await sleep(500);
    const L = await saveOf(lap); const P = await saveOf(ph);
    const g = L.games.coinCrossing;
    check('E simultaneous play: 30+3+2 stars, rounds 10, maxLevel 6', L.stars === 35 && P.stars === 35 && g.played === 10 && g.maxLevel === 6 && g.history.length === 10, `stars ${L.stars}/${P.stars} played=${g.played} max=${g.maxLevel} hist=${g.history.length}`);
    await lap.context().close(); await ph.context().close();
  }
  // ---- F. Two tabs on the same device keep each other's stars
  {
    store = {};
    const ctx = await b.newContext();
    await ctx.route('https://math-quest.rraman.workers.dev/**', mock);
    const t1 = await ctx.newPage(); const t2 = await ctx.newPage();
    await t1.goto(B + 'index.html');
    await setSave(t1, legacy(10, {}));
    await t1.reload(); await t2.goto(B + 'index.html'); await sleep(300);
    await t1.evaluate(() => { const d = MQ._live; d.stars += 3; MQ.save(d); });
    await t2.evaluate(() => { const d = MQ._live; d.stars += 2; MQ.save(d); });
    const S = await saveOf(t1);
    check('F two tabs: 10+3+2', S.stars === 15, `stars=${S.stars}`);
    await ctx.close();
  }
  // ---- G. Play time alone does not write to the cloud every 15 s (review MEDIUM KV writes)
  {
    store = {}; puts = 0;
    const lap = await device('lap');
    await setSave(lap, legacy(10, { coinCrossing: cc(3, 2, rows(3, 17)) }));
    await turnOn(lap);
    await lap.goto(B + 'games/coin-crossing/index.html'); await sleep(1500);
    await lap.evaluate(() => MQ.save(MQ._live)); await sleep(3200); // the game's first save fills in its defaults once
    const before = puts;
    for (let i = 0; i < 8; i++) { await lap.evaluate(() => { const d = MQ._live; d.games.coinCrossing.seconds = (d.games.coinCrossing.seconds || 0) + 15; d.playSeconds += 15; MQ.save(d); }); await sleep(400); }
    await sleep(3200);
    const timeOnly = puts - before;
    await lap.evaluate(() => { const d = MQ._live; d.games.coinCrossing.played += 1; d.stars += 3; MQ.save(d); });
    await sleep(3500);
    const afterRound = puts - before - timeOnly;
    check('G time-only saves send nothing; a finished round sends once', timeOnly === 0 && afterRound === 1, `time-only PUTs=${timeOnly}, after a round=${afterRound}`);
    await lap.context().close();
  }
  // ---- H. Start over on one device while a game is open on the other
  {
    store = {};
    const lap = await device('lap'); const ph = await device('ph', true);
    await setSave(lap, legacy(50, { coinCrossing: cc(15, 6, rows(15, 18)) }));
    const code = await turnOn(lap);
    await setSave(ph, legacy(0, {}));
    await join(ph, code);
    await ph.goto(B + 'games/number-flow/index.html'); await sleep(1500);
    await lap.reload(); await sleep(400);
    await lap.evaluate(async () => { MQ.reset(); await new Promise((r) => setTimeout(r, 800)); });
    await ph.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await sleep(1500);
    await ph.evaluate(async () => { const d = MQ._live; d.games.numberFlow = d.games.numberFlow || { level: 1, played: 0, history: [] }; d.games.numberFlow.played = (d.games.numberFlow.played || 0) + 1; d.stars += 3; MQ.save(d); await MQ.Sync.now(); });
    await lap.reload(); await sleep(1500);
    const L = await saveOf(lap);
    check('H Start over sticks; play after it is kept', !L.games.coinCrossing && L.games.numberFlow && L.stars === 3, `games=${Object.keys(L.games)} stars=${L.stars}`);
    await lap.context().close(); await ph.context().close();
  }
  // ---- I. A tampered save can't inject markup
  {
    store = {};
    const lap = await device('lap');
    await setSave(lap, legacy(5, { coinCrossing: { level: '<img src=x onerror=alert(1)>', played: 1, maxLevel: 1, history: [{ level: '<b>x</b>', stars: '<i>', date: 'x' }] } }));
    await lap.evaluate(() => { const d = JSON.parse(localStorage.getItem('mathQuest.save.v1')); d.player.hero = '<script>'; localStorage.setItem('mathQuest.save.v1', JSON.stringify(d)); });
    await lap.reload(); await sleep(300);
    await lap.click('#grownups-btn'); await sleep(300);
    const html = await lap.evaluate(() => document.body.innerHTML);
    check('I no injected markup in portal', !/<img src="?x|<b>x<\/b>|onerror/i.test(html) && (await lap.textContent('#hero-now')) === '🐥', `hero shown=${await lap.textContent('#hero-now')}`);
    await lap.context().close();
  }
  // ---- J. Erase the cloud copy: the other device stops syncing instead of re-creating it
  {
    store = {};
    const lap = await device('lap'); const ph = await device('ph', true);
    await setSave(lap, legacy(20, { coinCrossing: cc(5, 3, rows(5, 19)) }));
    const code = await turnOn(lap);
    await setSave(ph, legacy(0, {}));
    await join(ph, code);
    await lap.reload(); await sleep(400);
    await lap.evaluate(async () => { await MQ.Sync.erase(); });
    await ph.reload(); await sleep(1800);
    const phState = await ph.evaluate(() => ({ code: MQ.Sync.code, err: MQ.Sync.lastError, stars: JSON.parse(localStorage.getItem('mathQuest.save.v1')).stars }));
    const lapCode = await lap.evaluate(() => MQ.Sync.code);
    const newCode = await turnOn(lap);
    check('J erase: cloud gone, phone stops syncing and keeps progress, sync can start again', !store[code] && lapCode === null && phState.code === null && phState.err === 'erased' && phState.stars === 20 && !!store[newCode], `cloud=${!!store[code]} phone code=${phState.code} err=${phState.err} stars=${phState.stars} restart=${!!store[newCode]}`);
    await lap.context().close(); await ph.context().close();
  }
  console.log(results.join('\n'));
  await b.close();
})();
