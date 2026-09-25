/* Castle Climb — climb a 10-floor pagoda tower by jumping up to the ledge with the right
   answer. Addition & subtraction fact fluency with strategy hints, per-fact practice
   (missed facts come back) and levels that adapt after every climb. */
(function () {
  'use strict';

  const GAME_ID = 'castleClimb';
  // The scene is drawn in logical units. Laptop: a fixed 880×760 board. Phones: the board
  // stretches to fill the screen (portrait: ~440 wide; landscape: ~560 tall) — see resize().
  let W = 880;
  let H = 760;
  const FH = 230; // height of one floor
  let HERO_Y = 650; // screen y of the floor he stands on (camera at rest)
  const FLOORS = 10;
  const MAX_LEVEL = 15;
  let TX0 = 172;
  let TX1 = 708;
  let TW = TX1 - TX0;
  let TCX = (TX0 + TX1) / 2;
  let layout = 'wide'; // wide (laptop) | portrait (phone upright) | landscape (phone sideways)
  function setGeometry(w, h) {
    W = w;
    H = h;
    TW = Math.min(536, W - 40);
    TX0 = (W - TW) / 2;
    TX1 = TX0 + TW;
    TCX = (TX0 + TX1) / 2;
    HERO_Y = layout === 'wide' ? 650 : Math.round(H - clamp(H * 0.145, 80, 110));
  }
  const touchUI = () => MQ.isTouch;
  const LEDGE_H = 66;
  const SIDE_T = 0.15;
  const JUMP_T = 0.56;
  const SHAKE_T = 0.5;
  const FALL_T = 0.5;
  const CLIMB_T = 1.3;
  const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  const P = window.CCProblems;

  // ---------- Save data ----------
  const data = MQ.load();
  MQ.applySettings(data.settings);
  const g = (data.games[GAME_ID] = Object.assign(
    { level: 1, maxLevel: 1, played: 0, seconds: 0, history: [], skills: {}, missed: {} },
    data.games[GAME_ID] || {}
  ));
  if (typeof g.struggles !== 'number') g.struggles = 0;
  if (!g.skills || typeof g.skills !== 'object') g.skills = {};
  if (!g.missed || typeof g.missed !== 'object') g.missed = {};
  g.level = Math.max(1, Math.min(MAX_LEVEL, Math.floor(g.level) || 1));
  const hero = data.player.hero || '🐥';
  function persist() { MQ.save(data); }

  // ---------- DOM ----------
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const stage = document.getElementById('stage');
  const overlay = document.getElementById('overlay');
  const el = (id) => document.getElementById(id);
  const UI_FONT = getComputedStyle(document.body).fontFamily;

  // ---------- Helpers ----------
  const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const frand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function hex(c) { return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)); }
  function mix(c1, c2, t) {
    const a = hex(c1); const b = hex(c2);
    return `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], t))).join(',')})`;
  }
  function mixStops(stops, t) { // stops: [[t, color], ...]
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const [t0, c0] = stops[i - 1];
        const [t1, c1] = stops[i];
        return mix(c0, c1, clamp((t - t0) / (t1 - t0), 0, 1));
      }
    }
    return mix(stops[stops.length - 1][1], stops[stops.length - 1][1], 0);
  }
  function speakable(s) {
    return s.replace(/\p{Extended_Pictographic}/gu, '')
      .replace(/−/g, ' minus ').replace(/\+/g, ' plus ').replace(/=/g, ' equals ')
      .replace(/\?/g, ' what number ').replace(/…/g, ', ').replace(/\s+/g, ' ').trim();
  }

  // ---------- Game state ----------
  let state = 'intro'; // intro | play | jump | shake | fall | climb | top | result | pause
  let resumeState = 'play';
  let lv = P.levelInfo(g.level);
  let lanes = lv.ledges;
  let floor = 0; // the floor he is standing on
  let cam = 0;
  let camFrom = 0;
  let camTo = 0;
  let problem = null;
  let climbT = 0;
  let shakeT = 0;
  let fallT = 0;
  let topT = 0;
  let resultShown = false;
  const heroP = { lane: 1, from: 1, t: 1, jt: 0, sq: 0, sqV: 0 };
  let queuedMove = 0;
  let queuedJump = false;
  let stats = null;
  let floorsDone = [];
  let particles = [];
  let floaters = [];
  let chunks = [];
  let puffs = [];
  let rockets = [];
  let skyLanterns = [];
  let hintOn = false;
  let problemClock = 0;
  let idleClock = 0;
  let nudged = false;
  let time = 0;
  let lastSaveAt = 0;
  let nextRocket = 0;

  const camOff = () => HERO_Y + cam * FH;
  const sy = (f) => camOff() - f * FH; // screen y of a floor's walking surface
  const laneX = (i) => TX0 + (TW * (i + 0.5)) / lanes;
  const ledgeW = () => Math.min(lanes === 3 ? 150 : 116, TW / lanes - 10);
  const eaveExt = (n) => Math.min(n, Math.max(14, TX0 - 4));

  // Scenery that stays the same for the whole visit.
  const clouds = Array.from({ length: 16 }, (_, i) => ({
    x: frand(-100, 980),
    yb: 640 - i * 150 - frand(0, 80),
    s: frand(0.7, 1.35),
    v: frand(5, 13) * (Math.random() < 0.5 ? 1 : -1),
    puffs: Array.from({ length: 4 }, (_, k) => ({ dx: (k - 1.5) * 30 + frand(-6, 6), r: frand(20, 34) })),
  }));
  const skyStars = Array.from({ length: 70 }, () => ({ x: frand(0, 1), y: frand(0, 0.75), r: frand(0.8, 2.2), tw: frand(0, 6) }));

  // ---------- A new climb ----------
  function newClimb() {
    lv = P.levelInfo(g.level);
    lanes = lv.ledges;
    floor = 0;
    cam = camFrom = camTo = 0;
    heroP.lane = heroP.from = Math.floor((lanes - 1) / 2);
    heroP.t = 1;
    heroP.sq = heroP.sqV = 0;
    queuedMove = 0;
    queuedJump = false;
    stats = { firstTry: 0, speedy: 0, seconds: 0, times: [], retry: [], keys: [], missedKeys: [], leitner: 0 };
    floorsDone = [];
    particles = []; floaters = []; chunks = []; puffs = []; rockets = []; skyLanterns = [];
    topT = 0;
    resultShown = false;
    nextProblem();
  }

  function skillEntry(key) {
    const s = (g.skills[key] = g.skills[key] || { label: P.SKILLS[key], right: 0, tries: 0 });
    s.label = P.SKILLS[key];
    return s;
  }

  function pickMissed() {
    const entries = Object.keys(g.missed)
      .filter((k) => !stats.keys.includes(k))
      .map((k) => ({ k, c: g.missed[k], p: P.fromKey(k) }))
      .filter((e) => e.p && P.fitsLevel(e.p, g.level));
    if (!entries.length) return null;
    let x = Math.random() * entries.reduce((s, e) => s + e.c, 0);
    for (const e of entries) { x -= e.c; if (x <= 0) return e.p; }
    return entries[0].p;
  }

  function chooseProblem() {
    const recent = stats.keys.slice(-2);
    // 1) A fact he missed earlier in this climb comes back a few floors later.
    const due = stats.retry.findIndex((r) => r.due <= floor && !recent.includes(r.key));
    if (due >= 0) {
      const r = stats.retry.splice(due, 1)[0];
      const p = P.fromKey(r.key);
      if (p) { p.source = 'retry'; return p; }
    }
    // 2) Facts missed in earlier climbs come back more often (a few per climb).
    if (floor > 0 && stats.leitner < 3 && Math.random() < 0.3) {
      const p = pickMissed();
      if (p) { stats.leitner++; p.source = 'review'; return p; }
    }
    // 3) A new fact for this level.
    const p = P.make(g.level, { floor, skills: g.skills, avoid: stats.keys.slice(-6) });
    p.source = 'new';
    return p;
  }

  function nextProblem() {
    const p = chooseProblem();
    const values = P.shuffle([p.answer, ...P.distractors(p, lanes - 1)]);
    p.ledges = values.map((v) => ({ v, alive: true, crack: 0 }));
    p.firstAttempt = true;
    p.tries = 0;
    p.floor = floor + 1;
    p.done = false;
    p.chosen = -1;
    p.build = 0;
    problem = p;
    stats.keys.push(p.key);
    problemClock = 0;
    idleClock = 0;
    nudged = false;
    hintOn = false;
    updateHud();
  }

  function announce() {
    if (!problem) return;
    const again = problem.source === 'retry' ? 'This one came back! ' : '';
    say(touchUI() ? `${again}Tap the right answer to jump! 👆` : `${again}What is the answer? Walk under it and jump! ⬆`);
    MQ.Voice.say(problem.speak, 'en-US', { interrupt: true });
  }

  // ---------- HUD ----------
  function updateHud() {
    el('level').textContent = g.level;
    el('stars').textContent = data.stars;
    const pe = el('problem');
    const atTop = state === 'top' || state === 'result';
    pe.textContent = atTop ? '🏆 Top!' : problem ? problem.text : '—';
    pe.classList.toggle('long', !!problem && problem.text.length > 10);
    el('problem-zh').textContent = atTop ? (data.settings.chinese ? '你到顶了！' : '') : problem && data.settings.chinese ? problem.zh : '';
    el('floor').textContent = floor;
    el('track').innerHTML = Array.from({ length: FLOORS }, (_, i) => {
      const cls = i < floor ? `lit ${floorsDone[i] === 'retry' ? 'retry' : ''}` : i === floor && state !== 'top' && state !== 'result' ? 'now' : '';
      return `<span class="${cls}">${i < floor ? '🏮' : i + 1}</span>`;
    }).join('');
    el('tally').textContent = stats ? `✅ ${stats.firstTry} first try · ✨ ${stats.speedy} speedy` : '';
  }

  function say(text, { speak = false } = {}) {
    el('message').textContent = text;
    const b = el('bubble');
    b.classList.remove('pop');
    void b.offsetWidth;
    b.classList.add('pop', 'show');
    clearTimeout(say.timer); // phones show the panda's message as a short toast over the scene
    say.timer = setTimeout(() => b.classList.remove('show'), Math.min(7000, 2600 + text.length * 45));
    if (speak) MQ.Voice.say(speakable(text), 'en-US', { interrupt: true });
  }

  // ---------- Input ----------
  const PLAYING = new Set(['play', 'jump', 'shake', 'fall', 'climb']);

  window.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k.startsWith('Arrow') || k === ' ' || k === 'Enter' || k === 'Escape') e.preventDefault();
    MQ.Sound.ensure();

    if ((k === 'm' || k === 'M') && !e.repeat) { toggleMusic(); return; }
    if (PLAYING.has(state)) {
      if (k === 'Escape') { showPause(); return; }
      if (e.repeat) return; // holding a key never makes extra jumps
      if (k === 'h' || k === 'H') toggleHint();
      else if (k === 'ArrowLeft') move(-1);
      else if (k === 'ArrowRight') move(1);
      else if (k === 'ArrowUp' || k === ' ' || k === 'Enter') jump();
      else if (k === 'ArrowDown') readAgain();
      return;
    }
    if (overlayKeys && !e.repeat) overlayKeys(k, e);
  });

  function toggleMusic() {
    data.settings.music = data.settings.music === false;
    MQ.applySettings(data.settings);
    persist();
    say(data.settings.music ? '🎵 Music on' : '🔇 Music off');
    syncBar();
  }

  function toggleHint() {
    if (!problem || state === 'climb') return;
    hintOn = !hintOn;
    if (hintOn) {
      const text = problem.firstAttempt ? problem.tip : problem.full;
      say(`💡 ${text}`);
      MQ.Voice.say(speakable(text), 'en-US', { interrupt: true });
    }
    syncBar();
  }

  function readAgain() {
    if (!problem) return;
    MQ.Voice.say(problem.speak, 'en-US', { interrupt: true });
    if (data.settings.chinese) MQ.Voice.say(problem.zh.replace('？', ''), 'zh-CN');
  }

  function move(d) {
    if (state !== 'play') return;
    idleClock = 0;
    if (heroP.t < 1) { queuedMove = d; return; }
    const nl = clamp(heroP.lane + d, 0, lanes - 1);
    if (nl === heroP.lane) { heroP.sq = 0.12; return; }
    heroP.from = heroP.lane;
    heroP.lane = nl;
    heroP.t = 0;
    MQ.Sound.hop(floor, true);
  }

  function moveTo(lane) {
    if (state !== 'play' || lane === heroP.lane) return;
    heroP.from = heroP.lane;
    heroP.lane = lane;
    heroP.t = 0;
    MQ.Sound.hop(floor, true);
  }

  function jump() {
    if (state !== 'play' || !problem) return;
    idleClock = 0;
    if (heroP.t < 1) { queuedJump = true; return; }
    const ledge = problem.ledges[heroP.lane];
    if (!ledge.alive) {
      MQ.Sound.nope();
      heroP.sq = -0.2;
      say(touchUI() ? 'That ledge fell down. Tap another one!' : 'That ledge fell down. Walk ⬅ ➡ to another one!');
      return;
    }
    state = 'jump';
    heroP.jt = 0;
    heroP.sq = 0.22; // crouch before the jump
    heroP.sqV = -9;
    problem.chosen = heroP.lane;
    problem.right = ledge.v === problem.answer;
    if (problem.firstAttempt) {
      const s = skillEntry(problem.skill);
      s.tries++;
      if (problem.right) s.right++;
    }
    MQ.Sound.hop(floor + 1);
    dust(laneX(heroP.lane), sy(floor), 5);
  }

  // Tap / click a ledge: it lights up while the finger is down (slide to change your mind),
  // and he walks under it and jumps when the finger lifts. Taps during a hop or jump are ignored.
  let pressLane = -1;
  let pressOnLedge = false;
  let pressId = null;
  let tapHintOn = false;
  function hitTest(e) {
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const y = ((e.clientY - r.top) / r.height) * H;
    const slack = TX0 < 60 ? TX0 : 0; // phones: the outer edges count too
    if (x < TX0 - slack || x > TX1 + slack) return null;
    const lane = clamp(Math.floor(((x - TX0) / TW) * lanes), 0, lanes - 1);
    const ly = sy(floor + 1);
    const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
    const onLedge = touch
      ? Math.abs(x - laneX(lane)) <= TW / lanes / 2 + 2 && y >= ly - 70 && y <= ly + LEDGE_H + 60
      : Math.abs(x - laneX(lane)) <= ledgeW() / 2 && y >= ly - 30 && y <= ly + LEDGE_H + 20;
    return { lane, onLedge };
  }
  const canTap = () => state === 'play' && problem && heroP.t >= 1 && !queuedJump;
  canvas.addEventListener('pointerdown', (e) => {
    if (pressId !== null || !canTap()) return;
    const hit = hitTest(e);
    if (!hit) return;
    idleClock = 0;
    pressId = e.pointerId;
    pressLane = hit.lane;
    pressOnLedge = hit.onLedge;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (pressOnLedge) MQ.Sound.click();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pressId) return;
    const hit = hitTest(e);
    if (hit && hit.lane !== pressLane) { pressLane = hit.lane; pressOnLedge = hit.onLedge || pressOnLedge; if (pressOnLedge) MQ.Sound.click(); }
  });
  function endPress(e, cancel) {
    if (e.pointerId !== pressId) return;
    const lane = pressLane;
    const onLedge = pressOnLedge;
    pressId = null;
    pressLane = -1;
    pressOnLedge = false;
    if (cancel || !canTap()) return;
    idleClock = 0;
    if (onLedge && tapHintOn) { tapHintOn = false; g.tapHintDone = true; persist(); }
    if (lane !== heroP.lane) { moveTo(lane); if (onLedge) queuedJump = true; }
    else if (onLedge) jump();
  }
  canvas.addEventListener('pointerup', (e) => endPress(e, false));
  canvas.addEventListener('pointercancel', (e) => endPress(e, true));

  // On-screen buttons (phones / touch): hear again, hint, pause, music.
  const barActions = {
    hear: () => { if (PLAYING.has(state)) readAgain(); },
    hint: () => { if (PLAYING.has(state)) toggleHint(); },
    pause: () => { if (PLAYING.has(state)) showPause(); },
    music: () => toggleMusic(),
  };
  document.querySelectorAll('.touchbar [data-act]').forEach((b) => {
    b.addEventListener('click', () => {
      MQ.Sound.ensure();
      if (b.dataset.act !== 'music') MQ.Sound.click();
      barActions[b.dataset.act]();
      b.blur();
    });
  });
  function syncBar() {
    const m = document.querySelector('.touchbar [data-act="music"]');
    if (m) m.classList.toggle('off', data.settings.music === false);
    const h = document.querySelector('.touchbar [data-act="hint"]');
    if (h) h.classList.toggle('on', hintOn);
  }

  // ---------- Right and wrong ----------
  function land() {
    heroP.sq = 0.3;
    heroP.sqV = 0;
    dust(laneX(heroP.lane), sy(floor + 1), 8);
    if (problem.right) onRight();
    else onWrong();
  }

  function onRight() {
    const p = problem;
    const first = p.firstAttempt;
    const secs = problemClock;
    stats.times.push(secs);
    if (first) {
      stats.firstTry++;
      if (g.missed[p.key]) {
        g.missed[p.key]--;
        if (g.missed[p.key] <= 0) delete g.missed[p.key];
      }
    }
    const speedy = first && secs <= lv.pace;
    if (speedy) stats.speedy++;
    floorsDone.push(first ? 'first' : 'retry');

    const x = laneX(p.chosen);
    const y = sy(p.floor);
    MQ.Sound.coin(25);
    if (speedy) MQ.Sound.note(96, 'bell', { delay: 0.18, dur: 1.2, vel: 0.1 });
    sparkle(x, y - 40, 22);
    const praise = MQ.pick(MQ.PRAISE);
    floater(x, y - 95, data.settings.chinese ? praise.zh : praise.en, '#e0452e');
    if (speedy) floater(Math.min(W - 80, TX1 + 20), 140, '✨ Speedy!', '#d99a00', 0.1);
    say(`${first ? praise.zh + ' ' + praise.en : 'You got it! 对了!'} ${p.solved}`);
    if (data.settings.chinese) MQ.Voice.say(first ? praise.zh : '对了!', 'zh-CN', { interrupt: true });
    else MQ.Voice.say(first ? praise.en : 'You got it!', 'en-US', { interrupt: true });

    p.done = true;
    p.build = 0;
    floor++;
    hintOn = false;
    state = 'climb';
    climbT = 0;
    camFrom = cam;
    camTo = floor >= FLOORS ? FLOORS + (layout === 'wide' ? 0.45 : (H - 8 - HERO_Y) / FH) : floor;
    updateHud();
  }

  function onWrong() {
    const p = problem;
    if (p.firstAttempt) {
      g.missed[p.key] = Math.min(6, (g.missed[p.key] || 0) + 2);
      trimMissed();
      stats.retry.push({ key: p.key, due: Math.min(floor + 3, FLOORS - 1) });
      stats.missedKeys.push(p.text.replace(' = ?', ''));
    }
    p.firstAttempt = false;
    p.tries++;
    state = 'shake';
    shakeT = 0;
    MQ.Sound.wrong();
    hintOn = true;
    say(`Oops, not that one. ${p.full}`);
    MQ.Voice.say(`Not quite. ${speakable(p.full)}`, 'en-US', { interrupt: true });
  }

  function trimMissed() {
    const keys = Object.keys(g.missed);
    if (keys.length <= 60) return;
    keys.sort((a, b) => g.missed[a] - g.missed[b]).slice(0, keys.length - 60).forEach((k) => delete g.missed[k]);
  }

  function crumble() {
    const p = problem;
    const L = p.ledges[p.chosen];
    L.alive = false;
    const x = laneX(p.chosen);
    const y = sy(p.floor);
    const w = ledgeW();
    for (let i = 0; i < 14; i++) {
      chunks.push({
        x: x + frand(-w / 2 + 10, w / 2 - 10), wy: y + frand(4, LEDGE_H - 8) - camOff(),
        vx: frand(-60, 60), vy: frand(-60, 20), r: frand(0, 6), vr: frand(-5, 5),
        w: frand(12, 26), h: frand(10, 20), life: 1.6,
      });
    }
    dust(x, y + LEDGE_H / 2, 10);
  }

  // ---------- The top ----------
  function reachTop() {
    state = 'top';
    topT = 0;
    nextRocket = 0.3;
    MQ.Sound.open();
    setTimeout(() => MQ.Sound.win(), 700);
    const praise = MQ.pick(MQ.PRAISE);
    say(`🎉 You reached the top! ${praise.zh} ${praise.en}`);
    if (data.settings.chinese) MQ.Voice.say(`${praise.zh} 你到顶了!`, 'zh-CN', { interrupt: true });
    else MQ.Voice.say(`${praise.en} You reached the top!`, 'en-US', { interrupt: true });
    for (let i = 0; i < 14; i++) skyLanterns.push(newSkyLantern(true));
    updateHud();
    stats.praise = praise;
  }

  function newSkyLantern(spread) {
    return { x: frand(20, W - 20), wy: (spread ? frand(H * 0.4, H + 200) : H + 40) - camOff(), v: frand(28, 50), sway: frand(0, 6), s: frand(0.6, 1.1) };
  }

  function starsFor(s) {
    if (s.firstTry >= 9 && (s.firstTry === FLOORS || s.speedy >= 3)) return 3;
    if (s.firstTry >= 6) return 2;
    return 1;
  }

  function adapt(firstTry) {
    const before = g.level;
    g.played++;
    if (firstTry >= 9) {
      g.level = Math.min(MAX_LEVEL, g.level + 1);
      g.struggles = 0;
    } else if (firstTry <= 5) {
      g.struggles++;
      if (g.struggles >= 2 && g.level > 1) { g.level--; g.struggles = 0; }
    } else {
      g.struggles = 0;
    }
    g.maxLevel = Math.max(g.maxLevel || 1, g.level);
    if (g.level > before) return { text: `⬆ Level up! Next: ${P.levelInfo(g.level).name}.`, kind: 'up' };
    if (g.level < before) return { text: "Let's practice some easier ones, then climb back up! 💪", kind: 'down' };
    if (before === MAX_LEVEL && firstTry >= 9) return { text: "You're a tower master! 🏆", kind: 'up' };
    return { text: 'Climb again! Get 9 first-try floors to level up.', kind: 'same' };
  }

  function showResult() {
    resultShown = true;
    const s = stats;
    const stars = starsFor(s);
    const level = g.level;
    const avg = s.times.length ? s.times.reduce((a, b) => a + b, 0) / s.times.length : 0;
    const summary = `${s.firstTry}/10 first try, avg ${avg.toFixed(1)}s, ${s.speedy} speedy`;
    g.history.push({ level, stars, seconds: Math.round(s.seconds), date: new Date().toISOString(), summary, firstTry: s.firstTry, speedy: s.speedy });
    if (g.history.length > 200) g.history.splice(0, g.history.length - 200);
    const heroesBefore = MQ.unlockedHeroes(data.stars).length;
    data.stars += stars;
    const newHero = MQ.unlockedHeroes(data.stars).slice(heroesBefore)[0];
    const move = adapt(s.firstTry);
    persist();
    state = 'result';
    updateHud();
    MQ.Sound.star();

    const praise = s.praise || MQ.pick(MQ.PRAISE);
    const starHtml = [1, 2, 3].map((i) => `<span class="${i <= stars ? '' : 'off'}">⭐</span>`).join('');
    const practice = [...new Set(s.missedKeys)].slice(0, 4);
    showOverlay(`
      <div class="card" data-enter>
        <h2>🏯 You climbed the tower!</h2>
        <div class="stars-row">${starHtml}</div>
        <div class="praise"><span class="zh">${praise.zh}</span><small>${praise.py} · ${praise.en}</small></div>
        <div class="stats">
          <span>✅ ${s.firstTry} of 10 first try</span>
          <span>⏱ ${avg.toFixed(1)} s each</span>
          <span>✨ ${s.speedy} speedy</span>
        </div>
        ${practice.length ? `<p class="hint">Keep practicing: <b>${practice.map(MQ.escapeHtml).join(' · ')}</b></p>` : '<p class="hint">No wrong jumps at all! 🌟</p>'}
        <div class="next ${move.kind}">${move.text}</div>
        ${newHero ? `<div class="next">🎉 New hero unlocked: ${newHero.emoji} ${newHero.name}! Pick it in the portal.</div>` : ''}
        <div class="press keys-only">Press <span class="key">return</span> to climb again</div>
        <button class="btn go touch-only">Climb again ▶</button>
      </div>`,
      (k) => { if (k === 'Enter' || k === ' ') { MQ.Sound.click(); newClimb(); showIntro(); } }, true
    );
  }

  // ---------- Overlays ----------
  let overlayKeys = null;
  function showOverlay(html, keys, soft = false) {
    overlay.innerHTML = html;
    overlay.hidden = false;
    overlay.classList.toggle('soft', soft);
    overlayKeys = keys;
    const shownAt = performance.now();
    const card = overlay.querySelector('[data-enter]');
    // A tap too soon after the card appears is a leftover from play — don't skip the card.
    if (card) card.addEventListener('click', () => { if (performance.now() - shownAt > 900 && keys) keys('Enter'); });
  }
  function hideOverlay() {
    overlay.hidden = true;
    overlay.innerHTML = '';
    overlayKeys = null;
  }

  function showIntro() {
    state = 'intro';
    const first = g.played === 0;
    const zh = data.settings.chinese ? `<div class="goal-zh zh">${lv.zh}</div>` : '';
    const ex = lv.example.includes('?') ? lv.example : `${lv.example} = ?`;
    showOverlay(`
      <div class="card" data-enter>
        <h1>${hero} Castle Climb</h1>
        <div class="goal">Level ${g.level} · ${MQ.escapeHtml(lv.name)}</div>
        ${zh}
        <div class="example">${MQ.escapeHtml(ex)}</div>
        <div class="how keys-only">
          <div><span class="keys"><span class="key">←</span> <span class="key">→</span></span>walk under the answer</div>
          <div><span class="keys"><span class="key">↑</span></span>jump up!</div>
        </div>
        <div class="how touch-only">
          <div><span class="keys">👆</span>tap the right answer — you jump up!</div>
        </div>
        ${first ? '<p class="hint">Climb 10 floors to the top of the tower 🏯<br>Wrong ledge? It crumbles — no problem, just try again!</p>' : '<p class="hint">Climb 10 floors to the top 🏯</p>'}
        <div class="press keys-only">Press <span class="key">return</span> to start</div>
        <button class="btn go touch-only">Start ▶</button>
      </div>`,
      (k) => { if (k === 'Enter' || k === ' ') startPlay(); }
    );
    if (first) MQ.Voice.say(touchUI() ? 'Welcome to Castle Climb! Tap the right answer to jump up!' : 'Welcome to Castle Climb! Walk under the right answer, then jump up!', 'en-US', { interrupt: true });
    else MQ.Voice.say(`Level ${g.level}. ${lv.name.replace('·', '.').replace('±', 'plus or minus').replace('&', 'and')}.`, 'en-US', { interrupt: true });
    say(touchUI() ? 'Tap Start to climb!' : 'Press return to start climbing!');
    updateHud();
  }

  function startPlay() {
    hideOverlay();
    state = 'play';
    MQ.Sound.click();
    announce();
    tapHintOn = touchUI() && !g.tapHintDone;
  }

  function showPause() {
    resumeState = state;
    state = 'pause';
    MQ.Voice.stop();
    let sel = 0;
    const items = [
      ['▶ Keep playing', () => { hideOverlay(); state = resumeState; }],
      ['🏠 Back to the portal', () => { persist(); location.href = '../../index.html'; }],
    ];
    const render = () => {
      showOverlay(`
        <div class="card">
          <h2>⏸ Paused</h2>
          <div class="menu">${items.map((it, i) => `<button class="btn ${i === 0 ? '' : 'secondary'} ${i === sel ? 'sel' : ''}" data-i="${i}">${it[0]}</button>`).join('')}</div>
          <div class="press keys-only">Use <span class="key">↑</span> <span class="key">↓</span> and <span class="key">return</span></div>
        </div>`,
        (k) => {
          if (k === 'ArrowUp' || k === 'ArrowDown') { sel = 1 - sel; MQ.Sound.click(); render(); }
          else if (k === 'Enter' || k === ' ') items[sel][1]();
          else if (k === 'Escape') items[0][1]();
        });
      overlay.querySelectorAll('.menu .btn').forEach((b) => b.addEventListener('click', () => items[Number(b.dataset.i)][1]()));
    };
    render();
  }

  // ---------- Effects ----------
  function sparkle(x, y, n) {
    const colors = ['#ffd23f', '#ff9f1c', '#ffffff', '#ff6b6b'];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 60 + Math.random() * 170;
      particles.push({ x, wy: y - camOff(), vx: Math.cos(a) * s, vy: Math.sin(a) * s - 90, g: 380, life: 0.8 + Math.random() * 0.5, color: pick(colors), size: 3 + Math.random() * 4, star: Math.random() < 0.5 });
    }
  }
  function dust(x, y, n) {
    for (let i = 0; i < n; i++) {
      puffs.push({ x: x + frand(-26, 26), wy: y - 4 - camOff(), vx: frand(-50, 50), vy: frand(-30, -8), r: frand(6, 12), life: frand(0.45, 0.7), max: 0.7 });
    }
  }
  function floater(x, y, text, color, delay = 0) {
    floaters.push({ x, wy: y - camOff(), text, color, life: 1.4 + delay, delay });
  }
  function firework() {
    const x = frand(80, W - 80);
    rockets.push({ x, wy: H + 10 - camOff(), vy: -frand(520, 640), targetY: frand(90, 330) - camOff(), color: pick(['#ffd23f', '#ff6b6b', '#6be6ff', '#b28dff', '#7dff9b', '#ff9f1c']) });
  }
  function explode(r) {
    const n = 46;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + frand(-0.05, 0.05);
      const s = frand(110, 190);
      particles.push({ x: r.x, wy: r.wy, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 70, drag: 1.4, life: frand(1.2, 1.8), color: r.color, size: frand(2.5, 4), glow: true });
    }
    MQ.Sound.note(pick([79, 84, 88, 91]), 'bell', { dur: 1.0, vel: 0.06 });
  }

  // ---------- Update loop ----------
  function update(dt) {
    time += dt;
    for (const c of clouds) {
      c.x += c.v * dt;
      if (c.x > W + 160) c.x = -160;
      if (c.x < -160) c.x = W + 160;
    }
    if (state === 'pause') return;

    if (PLAYING.has(state)) {
      stats.seconds += dt;
      g.seconds += dt;
      data.playSeconds += dt;
      if (time - lastSaveAt > 15) { lastSaveAt = time; persist(); }
    }
    if (state === 'play' || state === 'jump') problemClock += dt;
    if (state === 'play') {
      idleClock += dt;
      if (idleClock > 12 && !nudged) {
        nudged = true;
        say(touchUI() ? 'Tap the right answer to jump up! 👆' : 'Walk ⬅ ➡ under the right answer, then press ⬆ to jump!');
      }
    }

    // Hero: sideways hops
    if (heroP.t < 1) {
      heroP.t = Math.min(1, heroP.t + dt / SIDE_T);
      if (heroP.t === 1) {
        heroP.sq = 0.12;
        if (queuedMove) { const d = queuedMove; queuedMove = 0; move(d); }
        else if (queuedJump) { queuedJump = false; jump(); }
      }
    } else if (queuedJump && state === 'play') { queuedJump = false; jump(); }
    // Squash & stretch spring
    heroP.sqV += (-heroP.sq * 220 - heroP.sqV * 13) * dt;
    heroP.sq += heroP.sqV * dt;

    if (state === 'jump') {
      heroP.jt = Math.min(1, heroP.jt + dt / JUMP_T);
      if (heroP.jt >= 1) land();
    } else if (state === 'shake') {
      shakeT += dt / SHAKE_T;
      problem.ledges[problem.chosen].crack = Math.min(1, shakeT);
      if (shakeT >= 1) { crumble(); state = 'fall'; fallT = 0; queuedMove = 0; queuedJump = false; }
    } else if (state === 'fall') {
      fallT = Math.min(1, fallT + dt / FALL_T);
      if (fallT >= 1) {
        state = 'play';
        MQ.Sound.bonk();
        heroP.sq = 0.35;
        heroP.sqV = 0;
        dust(laneX(heroP.lane), sy(floor), 10);
        floater(laneX(heroP.lane), sy(floor) - 90, '💫', '#fff');
        queuedMove = 0;
        queuedJump = false;
        idleClock = 0;
      }
    } else if (state === 'climb') {
      climbT = Math.min(1, climbT + dt / CLIMB_T);
      problem.build = clamp(climbT / 0.45, 0, 1);
      cam = lerp(camFrom, camTo, easeInOut(clamp((climbT - 0.28) / 0.72, 0, 1)));
      if (climbT >= 1) {
        cam = camTo;
        if (floor >= FLOORS) reachTop();
        else { nextProblem(); state = 'play'; announce(); }
      }
    } else if (state === 'top' || state === 'result') {
      topT += dt;
      nextRocket -= dt;
      if (nextRocket <= 0 && topT < (state === 'result' ? 999 : 6)) {
        firework();
        nextRocket = state === 'result' ? frand(0.9, 1.6) : frand(0.25, 0.5);
      }
      if (Math.random() < dt * 1.5) skyLanterns.push(newSkyLantern(false));
      if (state === 'top' && topT > 3.4 && !resultShown) showResult();
    }

    for (const r of rockets) {
      r.wy += r.vy * dt;
      if (r.wy <= r.targetY) { r.dead = true; explode(r); }
      else if (Math.random() < 0.7) particles.push({ x: r.x + frand(-2, 2), wy: r.wy + 6, vx: 0, vy: 30, g: 0, life: 0.35, color: '#ffe9a8', size: 2 });
    }
    rockets = rockets.filter((r) => !r.dead);
    for (const p of particles) {
      if (p.drag) { p.vx -= p.vx * p.drag * dt; p.vy -= p.vy * p.drag * dt; }
      p.x += p.vx * dt; p.wy += p.vy * dt; p.vy += (p.g || 0) * dt; p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);
    for (const c of chunks) { c.x += c.vx * dt; c.wy += c.vy * dt; c.vy += 520 * dt; c.r += c.vr * dt; c.life -= dt; }
    chunks = chunks.filter((c) => c.life > 0 && c.wy + camOff() < H + 60);
    for (const p of puffs) { p.x += p.vx * dt; p.wy += p.vy * dt; p.vx *= 1 - 3 * dt; p.r += 26 * dt; p.life -= dt; }
    puffs = puffs.filter((p) => p.life > 0);
    for (const f of floaters) {
      if (f.delay > 0) { f.delay -= dt; continue; }
      f.wy -= 38 * dt; f.life -= dt;
    }
    floaters = floaters.filter((f) => f.life > 0);
    for (const l of skyLanterns) { l.wy -= l.v * dt; l.x += Math.sin(time * 0.8 + l.sway) * 8 * dt; }
    skyLanterns = skyLanterns.filter((l) => l.wy + camOff() > -60);
  }

  // ---------- Drawing ----------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // How far up he is (0 at the bottom, 1 at the top) — the sky turns golden, then to dusk and stars.
  const heightT = () => clamp(cam / FLOORS, 0, 1.05);

  const SKY_TOP = [[0, '#6ec3f4'], [0.4, '#7fa7de'], [0.72, '#5b5ea8'], [1, '#1f2458']];
  const SKY_MID = [[0, '#b9e4fb'], [0.4, '#f5c7a0'], [0.72, '#e98f7e'], [1, '#6a4b92']];
  const SKY_LOW = [[0, '#e9f8ff'], [0.4, '#ffe7c6'], [0.72, '#ffc28c'], [1, '#e7897c']];

  function drawSky() {
    const t = heightT();
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, mixStops(SKY_TOP, t));
    sky.addColorStop(0.55, mixStops(SKY_MID, t));
    sky.addColorStop(1, mixStops(SKY_LOW, t));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Stars come out near the top.
    const starA = clamp((t - 0.6) / 0.35, 0, 1);
    if (starA > 0) {
      ctx.fillStyle = '#fff';
      for (const s of skyStars) {
        ctx.globalAlpha = starA * (0.55 + 0.45 * Math.sin(time * 2 + s.tw));
        ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // The sun sinks as he climbs; a crescent moon rises on the other side.
    const sunY = 130 + t * 420;
    const sunX = W - 75;
    const sunC = mix('#fff6c9', '#ff8a4c', clamp(t * 1.2, 0, 1));
    const glow = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, 140);
    glow.addColorStop(0, 'rgba(255,240,190,0.75)');
    glow.addColorStop(1, 'rgba(255,220,150,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(sunX - 140, sunY - 140, 280, 280);
    ctx.fillStyle = sunC;
    ctx.beginPath(); ctx.arc(sunX, sunY, 34, 0, Math.PI * 2); ctx.fill();

    const moonA = clamp((t - 0.55) / 0.3, 0, 1);
    if (moonA > 0) {
      ctx.globalAlpha = moonA;
      ctx.fillStyle = '#fff8dc';
      ctx.beginPath(); ctx.arc(78, 150, 26, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = mixStops(SKY_TOP, t);
      ctx.beginPath(); ctx.arc(90, 142, 24, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // Misty ink-wash mountains in three layers (parallax — they sink away as he climbs).
  const MOUNTAINS = [
    { par: 0.1, base: 560, amp: 150, col: '#a9bdd6', seed: 1.3, a: 0.75 },
    { par: 0.2, base: 640, amp: 120, col: '#86a4bd', seed: 4.1, a: 0.85 },
    { par: 0.34, base: 730, amp: 95, col: '#5f8a88', seed: 7.7, a: 1 },
  ];
  function mountainY(m, x) {
    const s = m.seed;
    return m.amp * (0.55 + 0.25 * Math.sin(x * 0.009 + s) + 0.15 * Math.sin(x * 0.023 + s * 2) + 0.08 * Math.sin(x * 0.051 + s * 3));
  }
  function drawMountains() {
    const t = heightT();
    const tint = mixStops(SKY_MID, t);
    for (const m of MOUNTAINS) {
      const base = m.base + (H - 760) + cam * FH * m.par;
      if (base - m.amp > H + 10) continue;
      ctx.globalAlpha = m.a;
      ctx.fillStyle = m.col;
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 16) ctx.lineTo(x, base - mountainY(m, x));
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
      // Mist at the foot of each range, tinted by the sky.
      ctx.globalAlpha = 0.55;
      const mist = ctx.createLinearGradient(0, base - 70, 0, base + 30);
      mist.addColorStop(0, 'rgba(255,255,255,0)');
      mist.addColorStop(1, tint);
      ctx.fillStyle = mist;
      ctx.fillRect(0, base - 70, W, H - base + 70);
      ctx.globalAlpha = 1;
    }
  }

  function drawClouds() {
    const t = heightT();
    const col = mix('#ffffff', '#ffd6c4', clamp(t * 1.3, 0, 1));
    ctx.fillStyle = col;
    for (const c of clouds) {
      const y = c.yb + (H - 760) + cam * FH * 0.55;
      if (y < -80 || y > H + 80) continue;
      ctx.globalAlpha = 0.85;
      ctx.save();
      ctx.translate(c.x, y);
      ctx.scale(c.s, c.s);
      ctx.beginPath();
      for (const p of c.puffs) { ctx.moveTo(p.dx + p.r, 0); ctx.arc(p.dx, 0, p.r, Math.PI, 0); }
      ctx.fill();
      roundRect(-70, -14, 140, 24, 12);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function pillar(x, y0, y1, w = 26) {
    const pg = ctx.createLinearGradient(x, 0, x + w, 0);
    pg.addColorStop(0, '#7e1b13');
    pg.addColorStop(0.35, '#d9442f');
    pg.addColorStop(1, '#8a2016');
    ctx.fillStyle = pg;
    ctx.fillRect(x, y0, w, y1 - y0);
    ctx.fillStyle = '#e0b23f';
    ctx.fillRect(x - 3, y1 - 10, w + 6, 6);
    ctx.fillRect(x - 3, y0 + 2, w + 6, 5);
  }

  function lattice(x, y, w, h, lit, round) {
    ctx.save();
    ctx.beginPath();
    if (round) ctx.arc(x + w / 2, y + h / 2, w / 2, 0, Math.PI * 2);
    else roundRect(x, y, w, h, 8);
    ctx.fillStyle = lit ? '#ffcf73' : '#4a2618';
    ctx.fill();
    if (lit) {
      const lg = ctx.createRadialGradient(x + w / 2, y + h / 2, 4, x + w / 2, y + h / 2, w);
      lg.addColorStop(0, 'rgba(255,250,220,0.9)');
      lg.addColorStop(1, 'rgba(255,170,60,0)');
      ctx.fillStyle = lg;
      ctx.fill();
    }
    ctx.clip();
    ctx.strokeStyle = lit ? 'rgba(140,60,20,0.75)' : '#8a5a2b';
    ctx.lineWidth = 3;
    for (let gx = x + 12; gx < x + w; gx += 14) { ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); ctx.stroke(); }
    for (let gy = y + 12; gy < y + h; gy += 14) { ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); ctx.stroke(); }
    ctx.restore();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#7a2418';
    ctx.beginPath();
    if (round) ctx.arc(x + w / 2, y + h / 2, w / 2, 0, Math.PI * 2);
    else roundRect(x, y, w, h, 8);
    ctx.stroke();
  }

  // One storey of the tower: the walls he walks in front of while standing on floor f.
  function drawStorey(f) {
    const yb = sy(f);
    const yt = f >= FLOORS ? sy(FLOORS) - 175 : sy(f + 1);
    if (yb < -20 || yt > H + 20) return;
    const wg = ctx.createLinearGradient(TX0, 0, TX1, 0);
    wg.addColorStop(0, '#e2c496');
    wg.addColorStop(0.5, '#f7e6c6');
    wg.addColorStop(1, '#dcbc8c');
    ctx.fillStyle = wg;
    ctx.fillRect(TX0, yt, TW, yb - yt);
    // Shadow under the eave above.
    const sg = ctx.createLinearGradient(0, yt, 0, yt + 90);
    sg.addColorStop(0, 'rgba(90,40,15,0.35)');
    sg.addColorStop(1, 'rgba(90,40,15,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(TX0, yt, TW, 90);
    // Windows between the lanes glow once the floor is reached.
    const lit = f <= floor && f > 0;
    for (let i = 1; i < lanes; i++) {
      const wx = TX0 + (TW * i) / lanes;
      const round = (i + f) % 2 === 0;
      if (f === 0) continue;
      lattice(wx - 30, yt + 105, 60, round ? 60 : 80, lit, round);
    }
    // Wooden skirting.
    ctx.fillStyle = '#7a3f22';
    ctx.fillRect(TX0, yb - 12, TW, 12);
    pillar(TX0, yt, yb);
    pillar(TX1 - 26, yt, yb);
    // Floor number badge on the left pillar.
    if (f > 0 && f <= FLOORS) {
      const bx = TX0 + 13;
      const by = yt + 150;
      ctx.fillStyle = '#e0b23f';
      ctx.beginPath(); ctx.arc(bx, by, 17, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8a2016';
      ctx.beginPath(); ctx.arc(bx, by, 13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffe9a8';
      ctx.font = `900 15px ${UI_FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(f), bx, by + 1);
    }
    if (f === 0) drawGate(yb);
  }

  function drawGate(yb) {
    // A big red door with golden studs behind the start.
    const gw = 130;
    const gh = 128;
    const gx = TCX - gw / 2;
    const gy = yb - 12 - gh;
    ctx.fillStyle = '#5c1e12';
    roundRect(gx - 10, gy - 10, gw + 20, gh + 12, 14); ctx.fill();
    ctx.fillStyle = '#b8321f';
    ctx.fillRect(gx, gy, gw, gh);
    ctx.fillStyle = '#8a2016';
    ctx.fillRect(TCX - 2, gy, 4, gh);
    ctx.fillStyle = '#f2c14e';
    for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) {
      ctx.beginPath(); ctx.arc(gx + 20 + c * 22, gy + 24 + r * 30, 4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(gx + gw - 20 - c * 22, gy + 24 + r * 30, 4, 0, Math.PI * 2); ctx.fill();
    }
  }

  function lantern(x, y, lit, s = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.strokeStyle = '#3b2412';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(0, 0); ctx.stroke();
    if (lit) {
      const gl = ctx.createRadialGradient(0, 14, 2, 0, 14, 42);
      gl.addColorStop(0, 'rgba(255,200,90,0.75)');
      gl.addColorStop(1, 'rgba(255,140,40,0)');
      ctx.fillStyle = gl;
      ctx.beginPath(); ctx.arc(0, 14, 42, 0, Math.PI * 2); ctx.fill();
    }
    const body = ctx.createRadialGradient(-4, 10, 2, 0, 14, 18);
    body.addColorStop(0, lit ? '#ffd27a' : '#a8483c');
    body.addColorStop(0.6, lit ? '#f0452c' : '#7d2a22');
    body.addColorStop(1, lit ? '#b3200f' : '#5a1d17');
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.ellipse(0, 14, 15, 13, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e0b23f';
    ctx.fillRect(-7, 0, 14, 4);
    ctx.fillRect(-7, 25, 14, 4);
    ctx.strokeStyle = lit ? '#ffcf5a' : '#8a4a2a';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, 29); ctx.lineTo(0, 40); ctx.stroke();
    ctx.restore();
  }

  // Sweeping pagoda eave with glazed tiles and upturned corners.
  function eave(y, extend, h, litLanterns, litA = 1) {
    const L = TX0 - extend;
    const R = TX1 + extend;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(TX0 - 14, y);
    ctx.lineTo(TX1 + 14, y);
    ctx.quadraticCurveTo(R - 26, y + h * 0.62, R + 8, y + h - 24);
    ctx.quadraticCurveTo(R - 6, y + h + 4, R - 36, y + h);
    ctx.lineTo(L + 36, y + h);
    ctx.quadraticCurveTo(L + 6, y + h + 4, L - 8, y + h - 24);
    ctx.quadraticCurveTo(L + 26, y + h * 0.62, TX0 - 14, y);
    ctx.closePath();
    const tg = ctx.createLinearGradient(0, y, 0, y + h);
    tg.addColorStop(0, '#1f5d57');
    tg.addColorStop(0.5, '#2f8a7e');
    tg.addColorStop(1, '#236c64');
    ctx.fillStyle = tg;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.lineWidth = 3;
    for (let x = L - 10; x < R + 10; x += 13) {
      ctx.strokeStyle = 'rgba(8,40,36,0.35)';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + h + 4); ctx.stroke();
      ctx.strokeStyle = 'rgba(190,255,240,0.16)';
      ctx.beginPath(); ctx.moveTo(x + 4, y); ctx.lineTo(x + 4, y + h + 4); ctx.stroke();
    }
    ctx.restore();
    // Gold trim along the lower edge + round tile ends
    ctx.strokeStyle = '#e8b93f';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(L - 8, y + h - 24);
    ctx.quadraticCurveTo(L + 6, y + h + 4, L + 36, y + h);
    ctx.lineTo(R - 36, y + h);
    ctx.quadraticCurveTo(R - 6, y + h + 4, R + 8, y + h - 24);
    ctx.stroke();
    ctx.fillStyle = '#3f9d90';
    for (let x = L + 44; x < R - 40; x += 13) { ctx.beginPath(); ctx.arc(x, y + h - 2, 4, 0, Math.PI * 2); ctx.fill(); }
    // Gold curls on the tips
    ctx.fillStyle = '#f2c14e';
    ctx.beginPath(); ctx.arc(R + 8, y + h - 26, 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(L - 8, y + h - 26, 5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (litLanterns != null) {
      ctx.save();
      lantern(L + 22, y + h + 2, false);
      lantern(R - 22, y + h + 2, false);
      if (litLanterns && litA > 0) {
        ctx.globalAlpha = litA;
        lantern(L + 22, y + h + 2, true);
        lantern(R - 22, y + h + 2, true);
      }
      ctx.restore();
    }
  }

  // A finished floor: balcony deck + railing, with the tiled eave underneath.
  function drawDeck(f, litA) {
    const y = sy(f);
    if (y < -120 || y > H + 80) return;
    eave(y + 12, eaveExt(88), 52, litA > 0, litA);
    // Railing behind him
    ctx.strokeStyle = '#a8321f';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(TX0 + 26, y - 26); ctx.lineTo(TX1 - 26, y - 26); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(TX0 + 26, y - 14); ctx.lineTo(TX1 - 26, y - 14); ctx.stroke();
    ctx.lineWidth = 4;
    for (let x = TX0 + 30; x < TX1 - 20; x += 30) { ctx.beginPath(); ctx.moveTo(x, y - 30); ctx.lineTo(x, y); ctx.stroke(); }
    // Deck beam
    ctx.fillStyle = '#6b2a19';
    ctx.fillRect(TX0 - 30, y, TW + 60, 14);
    ctx.fillStyle = '#a4553a';
    ctx.fillRect(TX0 - 30, y, TW + 60, 4);
    ctx.fillStyle = '#e0b23f';
    ctx.fillRect(TX0 - 30, y + 12, TW + 60, 3);
  }

  function drawGround() {
    const y = sy(0);
    if (y > H + 10) return;
    // Grass and path
    const gg = ctx.createLinearGradient(0, y, 0, y + 120);
    gg.addColorStop(0, '#7fcf5f');
    gg.addColorStop(1, '#4f9a45');
    ctx.fillStyle = gg;
    ctx.fillRect(0, y, W, H - y + 10);
    // Stone plinth
    ctx.fillStyle = '#b9b3a8';
    ctx.fillRect(TX0 - 40, y, TW + 80, 34);
    ctx.strokeStyle = '#8f887c';
    ctx.lineWidth = 2;
    for (let r = 0; r < 2; r++) {
      ctx.beginPath(); ctx.moveTo(TX0 - 40, y + r * 17); ctx.lineTo(TX1 + 40, y + r * 17); ctx.stroke();
      for (let x = TX0 - 40 + (r % 2) * 24; x < TX1 + 40; x += 48) { ctx.beginPath(); ctx.moveTo(x, y + r * 17); ctx.lineTo(x, y + r * 17 + 17); ctx.stroke(); }
    }
    ctx.fillStyle = '#d8d2c6';
    ctx.fillRect(TX0 - 40, y, TW + 80, 4);
    // Bamboo and flowers on the sides
    ctx.font = `46px ${EMOJI_FONT}`;
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('🎋', 60, y + 8);
    ctx.fillText('🎋', W - 50, y + 12);
    ctx.font = `26px ${EMOJI_FONT}`;
    for (const [x, dy] of [[28, 40], [110, 62], [W - 110, 48], [W - 30, 70], [TX0 - 20, 80], [TX1 + 30, 86]]) ctx.fillText('🌸', x, y + dy);
  }

  function drawCrown() {
    const base = sy(FLOORS) - 175;
    if (base > H + 50 || base < -400) return;
    // Upper roof body
    const top = base - 90;
    ctx.fillStyle = '#1f5d57';
    ctx.beginPath();
    ctx.moveTo(TX0 + 10, base + 4);
    ctx.lineTo(TCX - 70, top);
    ctx.lineTo(TCX + 70, top);
    ctx.lineTo(TX1 - 10, base + 4);
    ctx.closePath();
    const rg = ctx.createLinearGradient(0, top, 0, base);
    rg.addColorStop(0, '#1d544e');
    rg.addColorStop(1, '#2f8a7e');
    ctx.fillStyle = rg;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(8,40,36,0.3)';
    ctx.lineWidth = 3;
    for (let x = TX0; x < TX1; x += 13) { ctx.beginPath(); ctx.moveTo(TCX + (x - TCX) * 0.3, top); ctx.lineTo(x, base + 4); ctx.stroke(); }
    ctx.restore();
    // Ridge with curled ends
    ctx.fillStyle = '#16403b';
    roundRect(TCX - 90, top - 10, 180, 14, 6); ctx.fill();
    ctx.fillStyle = '#f2c14e';
    ctx.beginPath(); ctx.arc(TCX - 94, top - 10, 8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(TCX + 94, top - 10, 8, 0, Math.PI * 2); ctx.fill();
    // Big lower eave
    eave(base, eaveExt(120), 66, floor >= FLOORS, floor >= FLOORS ? clamp(topT, 0, 1) : 0);
    // Golden finial
    const fy = top - 10;
    const gold = ctx.createLinearGradient(TCX - 14, 0, TCX + 14, 0);
    gold.addColorStop(0, '#b8860b'); gold.addColorStop(0.4, '#ffe38a'); gold.addColorStop(1, '#b8860b');
    ctx.fillStyle = gold;
    ctx.beginPath(); ctx.arc(TCX, fy - 14, 14, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(TCX, fy - 38, 10, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(TCX, fy - 56, 7, 0, Math.PI * 2); ctx.fill();
    // Flagpole and flag (raised when he reaches the top)
    const poleTop = fy - 170;
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(TCX - 2, poleTop, 4, fy - 60 - poleTop);
    const raise = floor >= FLOORS ? ease(clamp(topT / 1.4, 0, 1)) : 0;
    const flagY = lerp(fy - 100, poleTop + 4, raise);
    const wave = Math.sin(time * 5) * 4;
    // A swallow-tailed festival pennant: gold with a red border.
    ctx.beginPath();
    ctx.moveTo(TCX + 2, flagY);
    ctx.quadraticCurveTo(TCX + 40, flagY + 2 + wave, TCX + 78, flagY + 8 + wave);
    ctx.lineTo(TCX + 58, flagY + 20 + wave * 0.8);
    ctx.lineTo(TCX + 78, flagY + 32 + wave);
    ctx.quadraticCurveTo(TCX + 40, flagY + 38 + wave, TCX + 2, flagY + 40);
    ctx.closePath();
    ctx.fillStyle = '#ffd23f';
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#d8342a';
    ctx.stroke();
    ctx.fillStyle = '#d8342a';
    ctx.beginPath(); ctx.arc(TCX + 26, flagY + 20 + wave * 0.5, 7, 0, Math.PI * 2); ctx.fill();
  }

  // A stone ledge with the answer carved big on its face.
  function drawLedge(i, L, y, alpha, highlight, pressed) {
    if (!L.alive) return;
    const w = ledgeW();
    let x = laneX(i);
    if (L.crack > 0) x += Math.sin(time * 55) * 3.5 * L.crack;
    const bob = pressed ? 4 : highlight ? Math.sin(time * 4) * 2 - 2 : 0;
    if (pressed) highlight = true;
    const y0 = y + bob;
    const x0 = x - w / 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (highlight) {
      ctx.save();
      ctx.shadowColor = 'rgba(255,214,80,1)';
      ctx.shadowBlur = 26;
      roundRect(x0 - 5, y0 - 5, w + 10, LEDGE_H + 10, 16);
      ctx.fillStyle = '#ffe07a';
      ctx.fill();
      ctx.restore();
    }
    // Shadow
    ctx.fillStyle = 'rgba(60,30,10,0.25)';
    roundRect(x0 + 4, y0 + 8, w, LEDGE_H, 12); ctx.fill();
    // Stone body
    const sg = ctx.createLinearGradient(0, y0, 0, y0 + LEDGE_H);
    sg.addColorStop(0, '#f4ead6');
    sg.addColorStop(0.18, '#e6d6b8');
    sg.addColorStop(0.75, '#cbb58f');
    sg.addColorStop(1, '#a78f68');
    roundRect(x0, y0, w, LEDGE_H, 12);
    ctx.fillStyle = sg;
    ctx.fill();
    // Top face highlight + bottom shade
    ctx.save();
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(x0, y0, w, 9);
    ctx.fillStyle = 'rgba(90,60,30,0.18)';
    ctx.fillRect(x0, y0 + LEDGE_H - 12, w, 12);
    // Speckles
    ctx.fillStyle = 'rgba(120,90,50,0.22)';
    for (let k = 0; k < 7; k++) {
      const sx = x0 + ((k * 37 + i * 23) % (w - 12)) + 6;
      const syy = y0 + 14 + ((k * 19 + i * 11) % (LEDGE_H - 26));
      ctx.beginPath(); ctx.arc(sx, syy, 1.6 + (k % 3), 0, Math.PI * 2); ctx.fill();
    }
    // Cracks as it starts to crumble
    if (L.crack > 0) {
      ctx.strokeStyle = `rgba(70,40,20,${0.4 + 0.5 * L.crack})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x - 6, y0);
      ctx.lineTo(x + 4, y0 + LEDGE_H * 0.3 * L.crack + 6);
      ctx.lineTo(x - 10, y0 + LEDGE_H * 0.6 * L.crack + 8);
      ctx.lineTo(x + 8, y0 + LEDGE_H * L.crack);
      ctx.moveTo(x + 4, y0 + LEDGE_H * 0.3 * L.crack + 6);
      ctx.lineTo(x + 30 * L.crack, y0 + 20);
      ctx.stroke();
    }
    ctx.restore();
    ctx.lineWidth = 3;
    ctx.strokeStyle = highlight ? '#d99a00' : '#8c7556';
    roundRect(x0, y0, w, LEDGE_H, 12);
    ctx.stroke();
    // Moss tuft
    ctx.fillStyle = '#6fae4f';
    ctx.beginPath(); ctx.ellipse(x0 + 16, y0 + 2, 12, 5, 0, 0, Math.PI * 2); ctx.fill();
    // The answer, carved: light edge below, dark ink on top.
    const text = String(L.v);
    const fs = text.length >= 3 ? 40 : 46;
    ctx.font = `900 ${fs}px ${UI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(text, x, y0 + LEDGE_H / 2 + 5);
    ctx.fillStyle = '#4a2610';
    ctx.fillText(text, x, y0 + LEDGE_H / 2 + 3);
    ctx.restore();
  }

  function drawProblemFloor() {
    if (!problem) return;
    const f = problem.floor;
    const y = sy(f);
    if (y < -150 || y > H + 100) return;
    if (problem.done) {
      // The floor builds out from the ledge he landed on.
      const b = ease(problem.build);
      const cx = laneX(problem.chosen);
      const half = ledgeW() / 2 + b * (TW + 260);
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx - half, y - 60, half * 2, 160);
      ctx.clip();
      drawDeck(f, b);
      ctx.restore();
      problem.ledges.forEach((L, i) => drawLedge(i, L, y, i === problem.chosen ? 1 - b : Math.max(0, 1 - b * 2), false));
      return;
    }
    const pressed = state === 'play' && pressOnLedge ? pressLane : -1;
    const aim = pressed >= 0 ? -1 : state === 'play' && heroP.t >= 1 ? heroP.lane : -1;
    problem.ledges.forEach((L, i) => drawLedge(i, L, y, 1, i === aim, i === pressed));
  }

  function drawTower() {
    const lo = Math.max(0, Math.floor(cam) - 1);
    const hi = Math.min(FLOORS, Math.ceil(cam) + 3);
    for (let f = lo; f <= hi; f++) drawStorey(f);
    drawGround();
    for (let f = hi + 1; f >= Math.max(1, lo); f--) {
      if (f > FLOORS) continue;
      if (problem && f === problem.floor) continue;
      drawDeck(f, f <= floor ? 1 : 0);
    }
    if (hi >= FLOORS - 2) drawCrown();
    drawProblemFloor();
  }

  function heroPos() {
    const e = ease(heroP.t);
    let x = lerp(laneX(heroP.from), laneX(heroP.lane), e);
    let y = sy(floor) - Math.sin(Math.PI * heroP.t) * 14;
    if (state === 'jump') {
      const p = heroP.jt;
      const y0 = sy(floor);
      const y1 = sy(floor + 1);
      y = y0 + (y1 - y0) * (1 - (1 - p) * (1 - p)) - 64 * Math.sin(Math.PI * p);
    } else if (state === 'shake') {
      y = sy(floor + 1);
      x += Math.sin(time * 55) * 3 * clamp(shakeT, 0, 1);
    } else if (state === 'fall') {
      y = lerp(sy(floor + 1), sy(floor), fallT * fallT);
    }
    return { x, y };
  }

  function drawHero() {
    const { x, y } = heroPos();
    // Shadow on the floor below him.
    const ground = state === 'shake' ? sy(floor + 1) : sy(floor);
    const lift = clamp((ground - y) / 260, 0, 1);
    ctx.fillStyle = `rgba(40,20,10,${0.28 * (1 - lift * 0.7)})`;
    ctx.beginPath(); ctx.ellipse(x, ground - 2, 22 * (1 - lift * 0.5), 6 * (1 - lift * 0.5), 0, 0, Math.PI * 2); ctx.fill();

    let sq = heroP.sq + (state === 'play' && heroP.t >= 1 ? Math.sin(time * 3) * 0.02 : 0);
    if (state === 'jump') sq -= 0.18 * Math.sin(Math.PI * heroP.jt) * (heroP.jt < 0.5 ? 1 : 0.6);
    if (state === 'fall') sq -= 0.15;
    sq = clamp(sq, -0.35, 0.4);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1 + sq, 1 - sq);
    ctx.font = `58px ${EMOJI_FONT}`;
    ctx.fillStyle = '#000'; // color emoji inherit the fill's opacity
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(hero, 0, -32);
    ctx.restore();

    // A bobbing "jump" arrow when he has been waiting a bit.
    const wait = g.played < 2 ? 2.5 : 6;
    if (state === 'play' && idleClock > wait && problem && problem.ledges[heroP.lane].alive) {
      const a = clamp((idleClock - wait) * 2, 0, 1);
      ctx.globalAlpha = a;
      const ay = y - 92 + Math.sin(time * 6) * 6;
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#d99a00';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x, ay - 18); ctx.lineTo(x + 16, ay); ctx.lineTo(x + 7, ay); ctx.lineTo(x + 7, ay + 16);
      ctx.lineTo(x - 7, ay + 16); ctx.lineTo(x - 7, ay); ctx.lineTo(x - 16, ay); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function drawEffects() {
    const off = camOff();
    for (const p of puffs) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1) * 0.7;
      ctx.fillStyle = '#fffaf0';
      ctx.beginPath(); ctx.arc(p.x, p.wy + off, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const c of chunks) {
      ctx.save();
      ctx.globalAlpha = clamp(c.life, 0, 1);
      ctx.translate(c.x, c.wy + off);
      ctx.rotate(c.r);
      ctx.fillStyle = '#cbb58f';
      ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
      ctx.fillStyle = '#f0e4cc';
      ctx.fillRect(-c.w / 2, -c.h / 2, c.w, 4);
      ctx.strokeStyle = '#8c7556';
      ctx.lineWidth = 2;
      ctx.strokeRect(-c.w / 2, -c.h / 2, c.w, c.h);
      ctx.restore();
    }
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life, 0, 1);
      ctx.fillStyle = p.color;
      const py = p.wy + off;
      if (p.glow) {
        ctx.beginPath(); ctx.arc(p.x, py, p.size, 0, Math.PI * 2); ctx.fill();
      } else if (p.star) {
        ctx.save();
        ctx.translate(p.x, py);
        ctx.rotate(time * 4);
        ctx.fillRect(-p.size, -1.2, p.size * 2, 2.4);
        ctx.fillRect(-1.2, -p.size, 2.4, p.size * 2);
        ctx.restore();
      } else ctx.fillRect(p.x, py, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of floaters) {
      if (f.delay > 0) continue;
      ctx.globalAlpha = clamp(f.life * 1.5, 0, 1);
      if (/\p{Extended_Pictographic}/u.test(f.text) && f.text.length <= 2) {
        ctx.font = `34px ${EMOJI_FONT}`;
        ctx.fillStyle = '#000';
        ctx.fillText(f.text, f.x, f.wy + off);
      } else {
        ctx.font = `900 30px ${UI_FONT}`;
        ctx.lineWidth = 6;
        ctx.strokeStyle = '#fff';
        ctx.strokeText(f.text, f.x, f.wy + off);
        ctx.fillStyle = f.color || '#e07b00';
        ctx.fillText(f.text, f.x, f.wy + off);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawSkyLanterns() {
    const off = camOff();
    for (const l of skyLanterns) {
      const y = l.wy + off;
      ctx.save();
      ctx.translate(l.x, y);
      ctx.scale(l.s, l.s);
      const gl = ctx.createRadialGradient(0, 0, 2, 0, 0, 40);
      gl.addColorStop(0, 'rgba(255,210,120,0.8)');
      gl.addColorStop(1, 'rgba(255,150,60,0)');
      ctx.fillStyle = gl;
      ctx.beginPath(); ctx.arc(0, 0, 40, 0, Math.PI * 2); ctx.fill();
      const body = ctx.createLinearGradient(0, -18, 0, 18);
      body.addColorStop(0, '#ffcf6b');
      body.addColorStop(1, '#f06a2c');
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(-11, -18); ctx.lineTo(11, -18); ctx.lineTo(14, 16); ctx.lineTo(-14, 16); ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff3c4';
      ctx.fillRect(-8, 12, 16, 4);
      ctx.restore();
    }
  }

  function drawRockets() {
    const off = camOff();
    for (const r of rockets) {
      ctx.fillStyle = '#fff4c2';
      ctx.beginPath(); ctx.arc(r.x, r.wy + off, 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  function wrapText(text, maxW) {
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    }
    if (line) lines.push(line);
    return lines;
  }

  // The problem hangs on a red lacquer banner at the top of the view.
  function drawBanner() {
    if (!problem) return;
    const top = state === 'top' || state === 'result';
    const zhOn = data.settings.chinese;
    const title = top ? 'You reached the top!' : problem.text;
    const sub = top ? '你到顶了！' : problem.zh;
    const ring = !top && problem.firstAttempt && !problem.done;
    // Fit the banner (and the ✨ ring beside it) on narrow phone screens.
    let fs = top ? 40 : 54;
    ctx.font = `900 ${fs}px ${UI_FONT}`;
    let tw = ctx.measureText(title).width;
    const pad = W < 700 ? 60 : 110;
    const room = W - 20 - (ring ? 70 : 0);
    while (fs > 28 && tw + pad > room) {
      fs -= 2;
      ctx.font = `900 ${fs}px ${UI_FONT}`;
      tw = ctx.measureText(title).width;
    }
    const bw = Math.min(Math.max(W < 700 ? 240 : 330, tw + pad), room);
    const bh = zhOn ? 112 : 84;
    const bx = W < 700 ? (W - bw - (ring ? 70 : 0)) / 2 : W / 2 - bw / 2;
    const bcx = bx + bw / 2;
    const by = 14;
    // Cords
    ctx.strokeStyle = '#6b3b1f';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(bx + 40, 0); ctx.lineTo(bx + 40, by + 4); ctx.moveTo(bx + bw - 40, 0); ctx.lineTo(bx + bw - 40, by + 4); ctx.stroke();
    // Board
    ctx.save();
    ctx.shadowColor = 'rgba(60,10,0,0.35)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 6;
    roundRect(bx, by, bw, bh, 14);
    const bg = ctx.createLinearGradient(0, by, 0, by + bh);
    bg.addColorStop(0, '#e2432f');
    bg.addColorStop(1, '#a8231a');
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#f2c14e';
    roundRect(bx + 6, by + 6, bw - 12, bh - 12, 10);
    ctx.stroke();
    // Corner knots
    ctx.fillStyle = '#f2c14e';
    for (const [cx, cy] of [[bx + 6, by + 6], [bx + bw - 6, by + 6], [bx + 6, by + bh - 6], [bx + bw - 6, by + bh - 6]]) {
      ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.font = `900 ${fs}px ${UI_FONT}`;
    ctx.fillText(title, bcx, by + (zhOn ? 44 : bh / 2 + 2));
    if (zhOn) {
      ctx.fillStyle = '#ffe7a8';
      ctx.font = `700 24px "PingFang SC","Hiragino Sans GB","Noto Sans SC",${UI_FONT}`;
      ctx.fillText(sub, bcx, by + 88);
    }

    // ✨ Speedy bonus ring: a calm, optional bonus — it just fades out, nothing bad happens.
    if (ring) {
      const cx = bx + bw + (W < 700 ? 38 : 40);
      const cy = by + bh / 2;
      const left = clamp(1 - problemClock / lv.pace, 0, 1);
      ctx.globalAlpha = left > 0 ? 1 : 0.35;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath(); ctx.arc(cx, cy, 27, 0, Math.PI * 2); ctx.fill();
      if (left > 0) {
        ctx.strokeStyle = '#f5b700';
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(cx, cy, 23, -Math.PI / 2, -Math.PI / 2 + left * Math.PI * 2); ctx.stroke();
        ctx.lineCap = 'butt';
      }
      ctx.font = `24px ${EMOJI_FONT}`;
      ctx.fillStyle = '#000';
      ctx.fillText('✨', cx, cy + 1);
      ctx.globalAlpha = 1;
    }
  }

  function drawHintScroll() {
    if (!hintOn || !problem || problem.done || state === 'top' || state === 'result') return;
    const text = problem.firstAttempt ? `💡 ${problem.tip}` : problem.full;
    const y = (data.settings.chinese ? 112 : 84) + 30;
    const maxW = Math.min(600, W - 80);
    const limit = state === 'play' || state === 'jump' ? sy(floor + 1) - 12 : H; // keep the ledges uncovered
    let fs = 23;
    let lines;
    let lh;
    for (;;) {
      ctx.font = `800 ${fs}px ${UI_FONT}`;
      lines = wrapText(text, maxW);
      lh = Math.round(fs * 1.3);
      if (fs <= 17 || y + lines.length * lh + 28 <= limit) break;
      fs -= 1;
    }
    const w = Math.min(Math.min(660, W - 36), Math.max(...lines.map((l) => ctx.measureText(l).width)) + 60);
    const h = lines.length * lh + 28;
    const x = W / 2 - w / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(60,30,0,0.3)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 4;
    roundRect(x, y, w, h, 12);
    ctx.fillStyle = '#fff7df';
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#e0b96a';
    roundRect(x, y, w, h, 12);
    ctx.stroke();
    // Scroll rollers
    ctx.fillStyle = '#b8743a';
    roundRect(x - 10, y - 4, 14, h + 8, 7); ctx.fill();
    roundRect(x + w - 4, y - 4, 14, h + 8, 7); ctx.fill();
    ctx.fillStyle = '#5a3414';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, W / 2, y + 14 + lh / 2 + i * lh));
  }

  // One-time 👆 for the first touch climb: a hand sweeps across the ledges (it never points
  // at the answer) until he taps one.
  function drawTapHint() {
    if (!tapHintOn || state !== 'play' || !problem || problem.done) return;
    const ly = sy(floor + 1);
    const u = (Math.sin(time * 1.7) + 1) / 2;
    const x = lerp(laneX(0), laneX(lanes - 1), u);
    const y = ly + LEDGE_H + 40 + Math.sin(time * 7) * 5;
    ctx.save();
    ctx.font = `52px ${EMOJI_FONT}`;
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('👆', x, y);
    ctx.restore();
    if (hintOn) return; // the hint scroll sits where the label would go
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = 'Tap the right answer!';
    ctx.font = `900 24px ${UI_FONT}`;
    const tw = ctx.measureText(label).width + 30;
    const lx = clamp(TCX, tw / 2 + 8, W - tw / 2 - 8);
    const ty = ly - 30;
    roundRect(lx - tw / 2, ty - 20, tw, 40, 20);
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#f5b700';
    ctx.stroke();
    ctx.fillStyle = '#7a3b1a';
    ctx.fillText(label, lx, ty + 1);
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    drawSky();
    drawMountains();
    drawClouds();
    drawSkyLanterns();
    drawTower();
    drawHero();
    drawEffects();
    drawRockets();
    drawTapHint();
    drawHintScroll();
    drawBanner();
  }

  // ---------- Sizing (crisp on Retina screens) ----------
  let pixelScale = 1;
  function pickLayout() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (vw <= 860 && vh > vw) return 'portrait';
    if (vh <= 560 && vw > vh) return 'landscape';
    return 'wide';
  }
  function resize() {
    layout = pickLayout();
    const root = document.documentElement;
    ['wide', 'portrait', 'landscape'].forEach((m) => root.classList.toggle(`lay-${m}`, layout === m));
    const dpr = window.devicePixelRatio || 1;
    let cssW;
    let cssH;
    let scale;
    if (layout === 'wide') {
      setGeometry(880, 760);
      const narrow = window.innerWidth <= 860;
      const availW = narrow ? window.innerWidth - 24 : window.innerWidth - 300 - 20 - 36;
      const availH = narrow ? window.innerHeight * 0.7 : window.innerHeight - 24;
      scale = Math.max(0.4, Math.min(availW / W, availH / H, 1.5));
      cssW = Math.round(W * scale);
      cssH = Math.round(H * scale);
      stage.style.width = `${cssW}px`;
      stage.style.height = `${cssH}px`;
    } else {
      // Phones: CSS gives the stage all the room left by the HUD; the board fills it exactly.
      stage.style.width = '';
      stage.style.height = '';
      const r = stage.getBoundingClientRect();
      cssW = Math.max(200, Math.floor(r.width));
      cssH = Math.max(200, Math.floor(r.height));
      scale = Math.min(cssW / 440, cssH / 560);
      setGeometry(cssW / scale, cssH / scale);
    }
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    pixelScale = (cssW / W) * dpr;
    ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
    if (floor >= FLOORS && camTo > FLOORS) { camTo = FLOORS + (layout === 'wide' ? 0.45 : (H - 8 - HERO_Y) / FH); if (state !== 'climb') cam = camTo; }
  }
  let resizeQueued = false;
  function queueResize() {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => { resizeQueued = false; resize(); });
  }
  window.addEventListener('resize', queueResize);
  window.addEventListener('orientationchange', () => { queueResize(); setTimeout(resize, 300); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', queueResize);

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    syncBar();
    requestAnimationFrame(frame);
  }

  window.addEventListener('beforeunload', persist);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { persist(); if (PLAYING.has(state)) showPause(); }
  });

  // Small hook for automated tests.
  window.__game = {
    get state() { return state; },
    get level() { return g.level; },
    get floor() { return floor; },
    get hero() { return heroP.lane; },
    get layout() { return layout; },
    get tapHint() { return tapHintOn; },
    geometry: () => ({ W, H, TX0, TX1, HERO_Y, ledgeW: ledgeW(), ledgeY: sy(floor + 1), ledgeH: LEDGE_H, laneX: Array.from({ length: lanes }, (_, i) => laneX(i)) }),
    get problem() {
      if (!problem) return null;
      return {
        text: problem.text, key: problem.key, answer: problem.answer, skill: problem.skill,
        ledges: problem.ledges.map((l) => l.v), alive: problem.ledges.map((l) => l.alive),
        firstAttempt: problem.firstAttempt, source: problem.source,
      };
    },
    get stats() { return stats; },
    problems: P,
  };

  resize();
  MQ.Music.play('elise');
  newClimb();
  showIntro();
  requestAnimationFrame(frame);
})();
