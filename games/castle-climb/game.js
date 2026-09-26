/* Castle Climb — climb a 10-floor tower (a pagoda, temple, giant tree, mountain, house,
   lighthouse, beanstalk or rocket tower — a different one each climb) by jumping up to the ledge with the right
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
  const heroId = MQ.heroId(data.player.hero);
  MQ.Art.preload(heroId);
  function persist() { MQ.save(data); }

  // ---------- DOM ----------
  const canvas = document.getElementById('board');
  let ctx = canvas.getContext('2d'); // swapped briefly while the cached background is painted
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
  // lane -1 = standing at the doorway in the middle: not under any ledge, so no answer is
  // highlighted until he chooses one himself (no "leading the witness").
  const HOME = -1;
  const heroP = { lane: HOME, from: HOME, t: 1, dur: 0.15, jt: 0, sq: 0, sqV: 0 };
  let queuedMove = 0;
  let queuedJump = false;
  let stats = null;
  let floorsDone = [];
  let particles = [];
  const blocks = MQ.FX.blocks(); // block bursts, kept in world coordinates (they ride with the camera)
  let floaters = [];
  let chunks = [];
  let puffs = [];
  let rockets = [];
  let skyLanterns = [];
  let hintOn = false;
  let problemClock = 0;
  let idleClock = 0;
  let nudged = false;
  let nudgeAt = 12;
  let time = 0;
  let lastSaveAt = 0;
  let nextRocket = 0;

  const camOff = () => HERO_Y + cam * FH;
  const sy = (f) => camOff() - f * FH; // screen y of a floor's walking surface
  const laneX = (i) => TX0 + (TW * (i + 0.5)) / lanes;
  const posX = (i) => (i < 0 ? TCX : laneX(i)); // the doorway is in the middle
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
    chooseTheme(g.played); // a different thing to climb every time
    floor = 0;
    cam = camFrom = camTo = 0;
    heroP.lane = heroP.from = HOME;
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
    p.hinted = false; // used the 💡 hint: the floor still counts, but not as first try / speedy
    p.tries = 0;
    p.floor = floor + 1;
    p.done = false;
    p.chosen = -1;
    p.build = 0;
    problem = p;
    stats.keys.push(p.key);
    // Each new floor starts at the doorway (he strolls back from the ledge he landed on).
    if (heroP.lane !== HOME) { heroP.from = heroP.lane; heroP.lane = HOME; heroP.t = 0; heroP.dur = 0.34; }
    problemClock = 0;
    idleClock = 0;
    nudged = false;
    hintOn = false;
    updateHud();
  }

  function announce() {
    if (!problem) return;
    const again = problem.source === 'retry' ? '🔁 ' : '';
    say(touchUI() ? `${again}Tap the answer! 👆` : `${again}Walk ⬅ ➡ then jump ⬆`);
    if (again) MQ.Voice.say('This one came back!', 'en-US', { interrupt: true });
    MQ.Voice.say(problem.speak, 'en-US', { interrupt: !again });
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
    const track = Array.from({ length: FLOORS }, (_, i) => {
      const cls = i < floor ? `lit ${floorsDone[i] === 'retry' ? 'retry' : ''}` : i === floor && state !== 'top' && state !== 'result' ? 'now' : '';
      return `<span class="${cls}">${i < floor ? theme.icon : i + 1}</span>`;
    }).join('');
    if (track !== updateHud.track) { updateHud.track = track; el('track').innerHTML = track; } // unchanged: keep the cells (a flying icon may be heading for one)
    const pl = document.querySelector('.problem-box .label');
    if (pl) pl.textContent = `${theme.icon} Jump to the answer`;
    const fl = document.querySelector('.floor-box .label');
    if (fl) fl.innerHTML = `${theme.emoji} Floor <b id="floor">${floor}</b> of 10`;
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
    if (speak) MQ.Voice.say(typeof speak === 'string' ? speak : speakable(text), 'en-US', { interrupt: true });
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
    // Keys pressed right after a card appears are leftovers from play (mashing space at the
    // top) — ignore them so he really sees his stars and the next level's card.
    if (overlayKeys && !e.repeat && performance.now() - overlayShownAt > overlayGuard) overlayKeys(k, e);
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
      if (!problem.done && problem.firstAttempt && !problem.hinted) {
        problem.hinted = true;
        // A fact he needed help with comes back later in this climb for another go.
        if (!stats.retry.some((r) => r.key === problem.key) && floor < FLOORS - 2) stats.retry.push({ key: problem.key, due: Math.min(floor + 3, FLOORS - 1) });
      }
      const text = hintText();
      say('💡 Hint ⬆'); // the hint scroll on the scene shows the words (and they are spoken)
      MQ.Voice.say(speakable(text), 'en-US', { interrupt: true });
    }
    syncBar();
  }

  // The hint never gives the answer away: only the strategy, until he has missed twice.
  function hintText() { return problem.tries >= 2 ? problem.full : problem.tip; }

  function readAgain() {
    if (!problem) return;
    MQ.Voice.say(problem.speak, 'en-US', { interrupt: true });
    if (data.settings.chinese) MQ.Voice.say(problem.zh.replace('？', ''), 'zh-CN');
  }

  function move(d) {
    if (state !== 'play') return;
    idleClock = 0;
    if (heroP.t < 1) { queuedMove = d; return; }
    const mid = (lanes - 1) / 2;
    // From the doorway the first step goes to the nearest ledge on that side
    // (3 ledges: ← left one, → right one; 4 ledges: ← 2nd, → 3rd).
    const nl = heroP.lane === HOME ? (d < 0 ? Math.ceil(mid) - 1 : Math.floor(mid) + 1) : clamp(heroP.lane + d, 0, lanes - 1);
    if (nl === heroP.lane) { heroP.sq = 0.12; return; }
    heroP.from = heroP.lane;
    heroP.lane = nl;
    heroP.t = 0;
    heroP.dur = SIDE_T;
    MQ.Sound.hop(floor, true);
  }

  function moveTo(lane) {
    if (state !== 'play' || lane === heroP.lane) return;
    heroP.from = heroP.lane;
    heroP.lane = lane;
    heroP.t = 0;
    heroP.dur = SIDE_T;
    MQ.Sound.hop(floor, true);
  }

  function jump() {
    if (state !== 'play' || !problem) return;
    idleClock = 0;
    if (heroP.t < 1) { queuedJump = true; return; }
    if (heroP.lane === HOME) {
      if (lanes % 2 === 1) {
        // Odd number of ledges: the doorway is right under the middle one, so ⬆ jumps to it.
        heroP.lane = heroP.from = (lanes - 1) / 2;
      } else {
        // Between two ledges: not under an answer yet, so he just bounces on the spot.
        MQ.Sound.nope();
        heroP.sq = -0.2;
        say(touchUI() ? 'Tap an answer! 👆' : 'Walk ⬅ ➡ first',
          { speak: touchUI() ? 'Tap an answer to jump to it!' : 'Walk under an answer first. Use the left and right arrows.' });
        return;
      }
    }
    const ledge = problem.ledges[heroP.lane];
    if (!ledge.alive) {
      MQ.Sound.nope();
      heroP.sq = -0.2;
      say(touchUI() ? 'That one fell! Tap another' : 'That one fell! Walk ⬅ ➡',
        { speak: touchUI() ? 'That ledge fell down. Tap another one!' : 'That ledge fell down. Walk to another one!' });
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
      if (problem.right && !problem.hinted) s.right++;
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
    const first = p.firstAttempt && !p.hinted;
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
    blocks.burst(x, y - 30 - camOff(), undefined, 18, 0.9);
    setMood('happy', 1.6);
    const praise = MQ.pick(MQ.PRAISE);
    floater(x, y - 95, data.settings.chinese ? praise.zh : praise.en, '#e0452e');
    if (speedy) floater(Math.min(W - 80, TX1 + 20), 140, '✨ Speedy!', '#d99a00', 0.1);
    say(`${first ? praise.zh + ' ' + praise.en : 'You got it! 对了!'} ${p.solved}${p.hinted && p.firstAttempt ? ' 💡' : ''}`);
    if (data.settings.chinese) MQ.Voice.say(first ? praise.zh : '对了!', 'zh-CN', { interrupt: true });
    else MQ.Voice.say(first ? praise.en : 'You got it!', 'en-US', { interrupt: true });

    if (washBadge) washBadge.step(); // a patch of the hidden town piece gets sprayed clean
    p.done = true;
    p.build = 0;
    floor++;
    hintOn = false;
    state = 'climb';
    climbT = 0;
    camFrom = cam;
    camTo = floor >= FLOORS ? FLOORS + (layout === 'wide' ? 0.45 : (H - 8 - HERO_Y) / FH) : floor;
    updateHud();
    // The floor's icon flies from the ledge into the floor track.
    const cell = el('track').children[floor - 1];
    const r = canvas.getBoundingClientRect();
    if (cell && r.width) MQ.FX.flyStar(r.left + (x / W) * r.width, r.top + ((y - 40) / H) * r.height, cell, { glyph: theme.icon, delay: 120 });
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
    if (p.tries >= 2) {
      // Second miss on this floor: now show the whole solution.
      say('❌ Oops! 💡 See how ⬆'); // the hint scroll shows the full solution
      MQ.Voice.say(`Not quite. Here's how. ${speakable(p.full)}`, 'en-US', { interrupt: true });
    } else {
      // First miss: only the strategy — he works it out and tries again.
      say('❌ Oops! 💡 Try again'); // the hint scroll shows the tip; it is spoken too
      MQ.Voice.say(`Not quite. ${speakable(p.tip)} Try again!`, 'en-US', { interrupt: true });
    }
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
    say(`🎉 The top! ${praise.en}`);
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

  function adapt(firstTry, perfect) {
    const before = g.level;
    g.played++;
    if (firstTry >= 9) {
      // A perfect climb (10/10 first try, 8+ speedy) jumps up two levels.
      g.level = Math.max(g.level, Math.min(MAX_LEVEL, g.level + (perfect ? 2 : 1)));
      g.struggles = 0;
    } else if (firstTry <= 5) {
      g.struggles++;
      if (g.struggles >= 2 && g.level > 1) { g.level--; g.struggles = 0; }
    } else {
      g.struggles = 0;
    }
    g.maxLevel = Math.max(g.maxLevel || 1, g.level);
    if (g.level > before + 1) return { text: `🚀 Skip ahead 2 levels!`, kind: 'up2' };
    if (g.level > before) return { text: `⬆ Level ${g.level} next!`, kind: 'up' };
    if (g.level < before) return { text: '💪 Easier ones next', kind: 'down' };
    if (before === MAX_LEVEL && firstTry >= 9) return { text: '🏆 Tower master!', kind: 'up' };
    return { text: '🎯 9 ✅ = level up', kind: 'same' };
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
    const move = adapt(s.firstTry, s.firstTry === FLOORS && s.speedy >= 8);
    persist();
    state = 'result';
    updateHud();
    MQ.Sound.star();

    const praise = s.praise || MQ.pick(MQ.PRAISE);
    const starHtml = [1, 2, 3].map((i) => `<span class="${i <= stars ? '' : 'off'}">⭐</span>`).join('');
    const practice = [...new Set(s.missedKeys)].slice(0, 4);
    showOverlay(`
      <div class="card result" data-enter>
        <h2>${MQ.Art.img(heroId, 64, 'card-hero')} You reached the top!</h2>
        <div class="wash-host"></div>
        <div class="stars-row">${starHtml}</div>
        <div class="praise"><span class="zh">${praise.zh}</span><small>${praise.py} · ${praise.en}</small></div>
        <div class="stats">
          <span title="first try">✅ ${s.firstTry}/10</span>
          <span title="seconds each">⏱ ${avg.toFixed(1)}s</span>
          <span title="speedy">✨ ${s.speedy}</span>
        </div>
        ${practice.length ? `<div class="practice">🔁 <b>${practice.map(MQ.escapeHtml).join(' · ')}</b></div>` : ''}
        <div class="next ${move.kind}">${move.text}</div>
        ${newHero ? `<div class="next new-hero">🎉 New hero: ${MQ.Art.img(newHero.id, 56)} ${MQ.escapeHtml(newHero.name)}!</div>` : ''}
        <div class="result-go">
          <div class="press keys-only">Press <span class="key">return</span></div>
          <button class="btn go touch-only">▶ Climb again</button>
          <a class="btn secondary town-btn" href="../../town/index.html">🏡 My Town</a>
        </div>
      </div>`,
      (k) => {
        if (k !== 'Enter') return;
        if (document.activeElement && document.activeElement.classList.contains('town-btn')) return; // the link opens the town
        // Not washed yet: the first return rinses it all clean with a big splash; the next one climbs again.
        if (washFin && !washFin.clean) { washFin.finish(); return; }
        MQ.Sound.click(); endWash(); newClimb(); showIntro();
      }, true, 1500
    );
    // A drag on the picture (or a tap on My Town) must not count as a tap on the card.
    const townBtn = overlay.querySelector('.town-btn');
    if (townBtn) townBtn.addEventListener('click', (e) => { e.stopPropagation(); persist(); });
    // The stars he earned fly into the ⭐ counter.
    const pill = document.querySelector('.star-pill');
    overlay.querySelectorAll('.stars-row span:not(.off)').forEach((sp, i) => {
      const r = sp.getBoundingClientRect();
      MQ.FX.flyStar(r.left + r.width / 2, r.top + r.height / 2, pill, { delay: 450 + i * 220 });
    });
    // Say the result out loud too (he may not read it yet).
    const starWord = ['', 'One star', 'Two stars', 'Three stars'][stars];
    const spoken = move.kind === 'up2' ? `${starWord}! Perfect climb! You jump up two levels!`
      : move.kind === 'up' ? (g.level > level ? `${starWord}! Level up!` : `${starWord}! You're a tower master!`)
      : move.kind === 'down' ? `${starWord}! Let's practice some easier ones.`
      : `${starWord}! Get 9 right on the first try to level up.`;
    MQ.Voice.say(`${spoken}${newHero ? ' You unlocked a new hero!' : ''}`, 'en-US', { interrupt: false });
    // The town piece hidden under the mud all climb: he power-washes the rest himself.
    const host = overlay.querySelector('.wash-host');
    if (host && washBadge) {
      washFin = MQ.Wash.finale(host, { data, badge: washBadge, size: layout === 'wide' ? 240 : layout === 'landscape' ? 150 : 180 });
      washFin.el.addEventListener('click', (e) => e.stopPropagation());
    } else if (host) host.remove();
  }

  // ---------- Wash-to-reveal (the next piece for his town) ----------
  let washBadge = null;
  let washFin = null;
  // Laptop: at the top of the floor column. Phone upright: next to ⭐. Phone sideways: in the floor box.
  function placeWashBadge() {
    if (!washBadge) return;
    const box = washBadge.el;
    const host = layout === 'portrait' ? document.querySelector('.panel-top') : el('wash-slot');
    if (box.parentNode !== host) host.appendChild(box);
    const size = layout === 'wide' ? 58 : 44;
    box.style.width = box.style.height = `${size}px`;
  }
  function startWash() {
    endWash();
    washBadge = MQ.Wash.badge(el('wash-slot'), { data, steps: FLOORS, size: 58 });
    placeWashBadge();
  }
  function endWash() {
    if (washFin) { washFin.cleanup(); washFin = null; }
    if (washBadge) { washBadge.el.remove(); washBadge = null; }
  }

  // ---------- Overlays ----------
  let overlayKeys = null;
  let overlayShownAt = 0;
  let overlayGuard = 0;
  function showOverlay(html, keys, soft = false, guard = 1000, redraw = false) {
    overlay.innerHTML = html;
    overlay.hidden = false;
    overlay.classList.toggle('soft', soft);
    overlayKeys = keys;
    if (!redraw) { overlayShownAt = performance.now(); overlayGuard = guard; } // a menu redraw keeps the clock
    const shownAt = overlayShownAt;
    if (!redraw) MQ.FX.popIn(overlay.querySelector('.card'));
    const card = overlay.querySelector('[data-enter]');
    // A tap too soon after the card appears is a leftover from play — don't skip the card.
    if (card) card.addEventListener('click', () => { if (performance.now() - shownAt > Math.max(900, guard) && keys) keys('Enter'); });
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
      <div class="card intro" data-enter>
        <h1>${MQ.Art.img(heroId, 76, 'card-hero')} Level ${g.level}</h1>
        <div class="goal">${MQ.escapeHtml(lv.name)}</div>
        ${zh}
        <div class="example">${MQ.escapeHtml(ex)}</div>
        <div class="pics">
          <div><span class="ic">${theme.emoji}</span>10 floors to the top</div>
          <div class="touch-only"><span class="ic">👆</span>Tap the answer</div>
          <div class="keys-only"><span class="ic">⬆</span>Jump to the answer</div>
          ${first ? '<div><span class="ic">🧱</span>Wrong? Just try again!</div>' : ''}
        </div>
        <div class="press keys-only">Press <span class="key">return</span></div>
        <button class="btn go touch-only">▶ Start</button>
      </div>`,
      (k) => { if (k === 'Enter' || k === ' ') startPlay(); }
    );
    const how = touchUI() ? 'Tap the right answer to jump up' : 'Walk under the right answer, then jump up';
    const levelName = lv.name.replace('·', '.').replace('±', 'plus or minus').replace('&', 'and');
    if (first) MQ.Voice.say(`Welcome to Castle Climb! ${how}, and climb 10 floors to the top. A wrong ledge crumbles, so just try again!`, 'en-US', { interrupt: true });
    else MQ.Voice.say(`Let's climb the ${theme.name}! Level ${g.level}: ${levelName}. ${how}, 10 floors to the top!`, 'en-US', { interrupt: true });
    say(touchUI() ? 'Tap Start to climb!' : 'Press return to start!');
    updateHud();
  }

  function startPlay() {
    hideOverlay();
    startWash();
    state = 'play';
    MQ.Sound.click();
    announce();
    tapHintOn = touchUI() && !g.tapHintDone;
  }

  // Pause (esc / ⏸) and "Leave the climb?" (🏠) are the same two big buttons:
  // ▶ Play [return] and 🏠 Home [esc]. The card itself is the "are you sure?", so esc, esc = home.
  function goHome() { persist(); location.href = '../../index.html'; }
  function showPause(leave = false) {
    if (PLAYING.has(state)) { resumeState = state; state = 'pause'; }
    MQ.Voice.stop();
    let sel = 0;
    const items = [
      [`▶ ${leave ? 'Keep climbing' : 'Play'}`, 'return', () => { hideOverlay(); state = resumeState; idleClock = 0; }],
      ['🏠 Home', 'esc', goHome],
    ];
    let drawn = false;
    const render = () => {
      showOverlay(`
        <div class="card pause ${leave ? 'leave' : ''}">
          <h2>${leave ? '🏠 Leave the climb?' : '⏸ Paused'}</h2>
          ${leave ? `<div class="floor-now">${theme.emoji} ${floor} / 10</div>` : ''}
          <div class="menu">${items.map((it, i) => `<button class="btn ${i === 0 ? '' : 'secondary'} ${i === sel ? 'sel' : ''}" data-i="${i}">${it[0]}<span class="key keys-only">${it[1]}</span></button>`).join('')}</div>
        </div>`,
        (k) => {
          if (k.startsWith('Arrow')) { sel = 1 - sel; MQ.Sound.click(); render(); }
          else if (k === 'Enter' || k === ' ') items[sel][2]();
          else if (k === 'Escape') goHome();
        }, false, 250, drawn);
      drawn = true;
      overlay.querySelectorAll('.menu .btn').forEach((b) => b.addEventListener('click', () => items[Number(b.dataset.i)][2]()));
    };
    render();
    if (leave) MQ.Voice.say(`Leave the climb? You are on floor ${floor}. Keep climbing, or go home?`, 'en-US', { interrupt: true });
  }

  // 🏠 during a climb asks first, so one stray tap doesn't throw the climb away.
  const homeLink = document.querySelector('.panel .home');
  if (homeLink) {
    homeLink.addEventListener('click', (e) => {
      if (!PLAYING.has(state) && state !== 'pause') return; // intro / result card: just go home
      e.preventDefault();
      homeLink.blur();
      MQ.Sound.click();
      if (state !== 'pause') showPause(true);
      else goHome(); // 🏠 while already paused: that was the second "yes"
    });
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
    moodT += dt;
    blocks.update(dt);

    if (PLAYING.has(state)) {
      stats.seconds += dt;
      g.seconds += dt;
      data.playSeconds += dt;
      if (time - lastSaveAt > 15) { lastSaveAt = time; persist(); }
    }
    if (state === 'play' || state === 'jump') problemClock += dt;
    if (state === 'play') {
      idleClock += dt;
      if (idleClock < 1) nudgeAt = 12; // any input resets the reminder clock
      if (idleClock > nudgeAt) {
        nudged = true;
        nudgeAt = idleClock + 25; // then again every 25 s
        say(touchUI() ? 'Tap the right answer! 👆' : 'Walk ⬅ ➡ then jump ⬆');
        MQ.Voice.say(`${problem.speak} ${touchUI() ? 'Tap the right answer.' : 'Walk under the right answer and jump.'}`, 'en-US', { interrupt: true });
      }
    }

    // Hero: sideways hops
    if (heroP.t < 1) {
      heroP.t = Math.min(1, heroP.t + dt / heroP.dur);
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
        floater(laneX(heroP.lane), sy(floor) - 110, '💫', '#fff');
        setMood('oops', 0.9);
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
    const [skyTop, skyMid, skyLow] = theme.sky;
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, mixStops(skyTop, t));
    sky.addColorStop(0.55, mixStops(skyMid, t));
    sky.addColorStop(1, mixStops(skyLow, t));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Stars come out near the top (and are always out for the night-time climbs).
    const starA = theme.night ? 1 : clamp((t - 0.6) / 0.35, 0, 1);
    if (starA > 0) {
      ctx.fillStyle = '#fff';
      for (const s of skyStars) {
        ctx.globalAlpha = starA * (0.55 + 0.45 * Math.sin(time * 2 + s.tw));
        ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // The sun sinks as he climbs; a crescent moon rises on the other side.
    const moonA = theme.night ? 1 : clamp((t - 0.55) / 0.3, 0, 1);
    if (moonA > 0) {
      ctx.globalAlpha = moonA;
      ctx.fillStyle = '#fff8dc';
      ctx.beginPath(); ctx.arc(78, 150, 26, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = mixStops(skyTop, t);
      ctx.beginPath(); ctx.arc(90, 142, 24, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (theme.night) return;
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
    if (theme.night) return;
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

  // One storey: the walls he walks in front of while standing on floor f (drawn by the theme),
  // with the doorway in the middle where he waits for each new question.
  function drawStorey(f) {
    const yb = sy(f);
    const yt = f >= FLOORS ? sy(FLOORS) - 175 : sy(f + 1);
    if (yb < -20 || yt > H + 20) return;
    theme.storey(f, yb, yt);
    if (f === 0) theme.gate(yb);
    else theme.door(yb, f <= floor);
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

  // A ledge with the answer written big on its face (the look comes from the theme).
  function drawLedge(i, L, y, alpha, highlight, pressed, waiting) {
    if (!L.alive) return;
    const w = ledgeW();
    let x = laneX(i);
    if (L.crack > 0) x += Math.sin(time * 55) * 3.5 * L.crack;
    // While he waits at the doorway every ledge bobs together — none is singled out.
    const bob = pressed ? 4 : highlight ? Math.sin(time * 4) * 2 - 2 : waiting ? Math.sin(time * 3) * 2 : 0;
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
    LEDGES[theme.ledge](x0, y0, w, LEDGE_H, i, L, highlight, problem ? problem.floor : floor + 1);
    // Cracks as it starts to crumble
    if (L.crack > 0) {
      ctx.strokeStyle = `rgba(70,40,20,${0.4 + 0.5 * L.crack})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x - 6, y0 + 4);
      ctx.lineTo(x + 4, y0 + LEDGE_H * 0.3 * L.crack + 6);
      ctx.lineTo(x - 10, y0 + LEDGE_H * 0.6 * L.crack + 8);
      ctx.lineTo(x + 8, y0 + LEDGE_H * L.crack - 2);
      ctx.moveTo(x + 4, y0 + LEDGE_H * 0.3 * L.crack + 6);
      ctx.lineTo(x + 30 * L.crack, y0 + 20);
      ctx.stroke();
    }
    // The answer: light edge below, dark ink on top.
    const text = String(L.v);
    const fs = text.length >= 3 ? 40 : 46;
    ctx.font = `900 ${fs}px ${UI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const ty = y0 + LEDGE_H / 2 + (theme.ledge === 'cloud' ? 8 : theme.ledge === 'flowerbox' || theme.ledge === 'plank' || theme.ledge === 'steel' ? 0 : 3);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(text, x, ty + 2);
    ctx.fillStyle = theme.ink;
    ctx.fillText(text, x, ty);
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
      drawDeckT(f, b);
      ctx.restore();
      problem.ledges.forEach((L, i) => drawLedge(i, L, y, i === problem.chosen ? 1 - b : Math.max(0, 1 - b * 2), false));
      return;
    }
    const pressed = state === 'play' && pressOnLedge ? pressLane : -1;
    const aim = pressed >= 0 ? -1 : state === 'play' && heroP.t >= 1 && heroP.lane >= 0 ? heroP.lane : -1;
    const waiting = pressed < 0 && state === 'play' && heroP.lane === HOME;
    problem.ledges.forEach((L, i) => drawLedge(i, L, y, 1, i === aim, i === pressed, waiting));
  }

  function drawDeckT(f, litA) {
    const y = sy(f);
    if (y < -120 || y > H + 80) return;
    theme.deck(f, y, litA);
  }

  function drawTower() {
    const lo = Math.max(0, Math.floor(cam) - 1);
    const hi = Math.min(FLOORS, Math.ceil(cam) + 3);
    for (let f = lo; f <= hi; f++) drawStorey(f);
    if (sy(0) <= H + 10) theme.ground(sy(0));
    for (let f = hi + 1; f >= Math.max(1, lo); f--) {
      if (f > FLOORS) continue;
      if (problem && f === problem.floor) continue;
      drawDeckT(f, f <= floor ? 1 : 0);
    }
    if (hi >= FLOORS - 2) {
      const base = sy(FLOORS) - 175;
      if (base <= H + 50 && base >= -400) theme.crown(base);
    }
    drawProblemFloor();
  }

  function heroPos() {
    const e = ease(heroP.t);
    let x = lerp(posX(heroP.from), posX(heroP.lane), e);
    const hops = heroP.dur > SIDE_T ? 2 : 1; // the stroll back to the doorway is two little hops
    let y = sy(floor) - Math.abs(Math.sin(Math.PI * hops * heroP.t)) * (hops > 1 ? 10 : 14);
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

  // The block-animal hero: 'walk' while hopping, 'happy' on a right answer and at the top,
  // 'oops' (with a little wobble) while a wrong ledge shakes and crumbles.
  const heroSize = () => (layout === 'wide' ? 92 : 80);
  let mood = null;
  let moodT = 0;
  let moodDur = 0;
  function setMood(pose, dur) { mood = pose; moodT = 0; moodDur = dur; }
  function heroPose() {
    if (state === 'top' || state === 'result' || state === 'climb') return 'happy';
    if (state === 'shake' || state === 'fall') return 'oops';
    if (mood && moodT < moodDur) return mood;
    if (heroP.t < 1) return 'walk';
    return 'idle';
  }
  function drawHero() {
    const { x, y } = heroPos();
    // Shadow on the floor below him.
    const ground = state === 'shake' ? sy(floor + 1) : sy(floor);
    const lift = clamp((ground - y) / 260, 0, 1);
    ctx.fillStyle = `rgba(40,20,10,${0.26 * (1 - lift * 0.7)})`;
    ctx.beginPath(); ctx.ellipse(x, ground - 2, 30 * (1 - lift * 0.5), 8 * (1 - lift * 0.5), 0, 0, Math.PI * 2); ctx.fill();

    let sq = heroP.sq;
    if (state === 'jump') sq -= 0.18 * Math.sin(Math.PI * heroP.jt) * (heroP.jt < 0.5 ? 1 : 0.6);
    if (state === 'fall') sq -= 0.15;
    sq = clamp(sq, -0.35, 0.4);
    const hop = state === 'play' && heroP.t < 1 ? MQ.FX.hopShape(heroP.t) : { sx: 1, sy: 1 };
    const pose = heroPose();
    // Wrong answer: a gentle side-to-side wobble (no harsh shake).
    let tilt = 0;
    if (state === 'shake') tilt = Math.sin(time * 16) * 0.08 * clamp(shakeT * 2, 0, 1);
    else if (mood === 'oops' && moodT < moodDur) tilt = Math.sin(moodT * 14) * 0.1 * (1 - moodT / moodDur);
    MQ.Art.drawHero(ctx, heroId, x, y, heroSize(), {
      pose, t: time, sx: (1 + sq) * hop.sx, sy: (1 - sq) * hop.sy, tilt, shadow: false,
    });
  }

  function drawEffects() {
    const off = camOff();
    if (blocks.count) { ctx.save(); ctx.translate(0, off); blocks.draw(ctx); ctx.restore(); }
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
      const [cf, ct, ce] = theme.chunk;
      if (theme.puffy) {
        ctx.fillStyle = ce; disc(0, 2, c.w * 0.55 + 2);
        ctx.fillStyle = cf; disc(0, 0, c.w * 0.55);
      } else {
        ctx.fillStyle = cf;
        ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
        ctx.fillStyle = ct;
        ctx.fillRect(-c.w / 2, -c.h / 2, c.w, 4);
        ctx.strokeStyle = ce;
        ctx.lineWidth = 2;
        ctx.strokeRect(-c.w / 2, -c.h / 2, c.w, c.h);
      }
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
    const drawOne = FLOATIES[theme.floatie];
    for (const l of skyLanterns) {
      ctx.save();
      ctx.translate(l.x, l.wy + off);
      ctx.scale(l.s, l.s);
      drawOne(l);
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
    const ring = !top && problem.firstAttempt && !problem.hinted && !problem.done;
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
    bg.addColorStop(0, theme.banner[0]);
    bg.addColorStop(1, theme.banner[1]);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = 4;
    ctx.strokeStyle = theme.banner[2];
    roundRect(bx + 6, by + 6, bw - 12, bh - 12, 10);
    ctx.stroke();
    // Corner knots
    ctx.fillStyle = theme.banner[2];
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
    const text = problem.tries >= 2 ? problem.full : `💡 ${problem.tip}`;
    const y = (data.settings.chinese ? 112 : 84) + 30;
    const maxW = Math.min(W > 1100 ? 780 : 600, W - 80);
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
    const w = Math.min(Math.min(W > 1100 ? 840 : 660, W - 36), Math.max(...lines.map((l) => ctx.measureText(l).width)) + 60);
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

  // ---------- Things to climb: a different structure every climb ----------
  // Every theme draws into the same geometry (floors FH apart, ledges on the lanes, a doorway
  // in the middle where he waits), so the game plays exactly the same on each one.
  const hash = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  function lgrad(x0, y0, x1, y1, stops) {
    const gr = ctx.createLinearGradient(x0, y0, x1, y1);
    for (const [t, c] of stops) gr.addColorStop(t, c);
    return gr;
  }
  function disc(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  function emo(ch, x, y, size) {
    ctx.font = `${size}px ${EMOJI_FONT}`;
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(ch, x, y);
  }
  const narrowUI = () => TW < 460;
  const doorW = () => clamp((TW / lanes) * 0.5, 54, 76);
  const DOOR_H = 106;
  // Gaps between the ledges (for windows etc.), leaving the middle free for the doorway.
  function sideSpots() {
    const out = [];
    for (let i = 1; i < lanes; i++) {
      const x = TX0 + (TW * i) / lanes;
      if (Math.abs(x - TCX) > doorW() / 2 + 26) out.push(x);
    }
    return out;
  }
  const worldY = (y) => y - camOff(); // stays put while the camera moves
  function glow(x, y, r, color, a = 1) {
    const gl = ctx.createRadialGradient(x, y, 1, x, y, r);
    gl.addColorStop(0, color);
    gl.addColorStop(1, 'rgba(255,200,90,0)');
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.fillStyle = gl;
    disc(x, y, r);
    ctx.restore();
  }
  function floorBadge(f, x, y) {
    if (f <= 0 || f > FLOORS) return;
    const [ring, fill, ink] = theme.badge;
    ctx.fillStyle = ring; disc(x, y, 17);
    ctx.fillStyle = fill; disc(x, y, 13);
    ctx.fillStyle = ink;
    ctx.font = `900 15px ${UI_FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(f), x, y + 1);
  }
  function flag(px, py, raise, col, trim, lowY, topY) {
    const fy = lerp(lowY, topY, raise);
    const wave = Math.sin(time * 5) * 4;
    ctx.beginPath();
    ctx.moveTo(px + 2, fy);
    ctx.quadraticCurveTo(px + 34, fy + 2 + wave, px + 62, fy + 6 + wave);
    ctx.lineTo(px + 62, fy + 32 + wave);
    ctx.quadraticCurveTo(px + 34, fy + 36 + wave, px + 2, fy + 36);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = trim;
    ctx.stroke();
    ctx.fillStyle = trim;
    ctx.font = `900 18px ${UI_FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('★', px + 32, fy + 19 + wave * 0.6);
  }
  function pole(x, top, bottom) {
    ctx.fillStyle = '#5b4a3a';
    ctx.fillRect(x - 2, top, 4, bottom - top);
    ctx.fillStyle = '#f2c14e';
    disc(x, top, 5);
  }
  const topRaise = () => (floor >= FLOORS ? ease(clamp(topT / 1.4, 0, 1)) : 0);

  // ----- Backdrops: distant scenery in layers that sink away as he climbs -----
  function hillH(m, x, shape) {
    const s = m.seed;
    const smooth = 0.55 + 0.25 * Math.sin(x * 0.009 + s) + 0.15 * Math.sin(x * 0.023 + s * 2) + 0.08 * Math.sin(x * 0.051 + s * 3);
    if (shape === 'peaks') {
      const tri = (u) => 1 - 2 * Math.abs(u - Math.floor(u) - 0.5);
      return m.amp * (0.3 + 0.5 * tri(x * 0.0045 + s) + 0.2 * tri(x * 0.012 + s * 2));
    }
    if (shape === 'trees') return m.amp * smooth + Math.abs(Math.sin(x * 0.08 + s)) * 13;
    if (shape === 'mesa') return Math.min(m.amp * 0.72, m.amp * smooth * 1.35);
    return m.amp * smooth;
  }
  const layerBase = (m) => m.base + (H - 760) + cam * FH * m.par;
  function hillPath(m, shape) {
    const base = layerBase(m);
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W + 8; x += 8) ctx.lineTo(x, base - hillH(m, x, shape));
    ctx.lineTo(W, H);
    ctx.closePath();
    return base;
  }
  function hills(layers, shape, after) {
    for (const m of layers) {
      const base = layerBase(m);
      if (base - m.amp * 1.1 > H + 10) continue;
      ctx.globalAlpha = m.a == null ? 1 : m.a;
      ctx.fillStyle = m.col;
      hillPath(m, shape);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (after) after(m, base);
    }
  }
  function seaBand(hz, top, bottom) {
    if (hz > H) return;
    ctx.fillStyle = lgrad(0, hz, 0, H, [[0, top], [1, bottom]]);
    ctx.fillRect(0, hz, W, H - hz);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    for (let k = 0; k < 26; k++) {
      const y = hz + 6 + hash(k) * (H - hz);
      if (y > H) continue;
      const x = ((hash(k + 40) * (W + 80) + time * (6 + hash(k + 9) * 8)) % (W + 80)) - 40;
      const len = 10 + hash(k + 3) * 22;
      ctx.globalAlpha = 0.25 + 0.35 * Math.sin(time * 1.5 + k);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function city(seed, par, base0, amp, col, windows) {
    const base = base0 + (H - 760) + cam * FH * par;
    if (base - amp > H + 10) return;
    let x = -10;
    for (let i = 0; x < W + 10; i++) {
      const bw = 38 + hash(i * 1.7 + seed) * 46;
      const bh = amp * (0.35 + 0.65 * hash(i * 3.1 + seed * 2));
      ctx.fillStyle = col;
      ctx.fillRect(x, base - bh, bw - 4, bh + H);
      if (hash(i + seed * 5) > 0.6) { ctx.fillRect(x + bw * 0.3, base - bh - 14, 6, 14); }
      if (windows) {
        ctx.fillStyle = 'rgba(255,245,210,0.55)';
        for (let wy = base - bh + 10; wy < base - 8; wy += 16) {
          for (let wx = x + 7; wx < x + bw - 12; wx += 12) if (hash(wx * 0.3 + wy * 0.7 + seed) > 0.45) ctx.fillRect(wx, wy, 5, 7);
        }
      }
      x += bw;
    }
  }

  // ----- Floaties that drift up at the top (the celebration) -----
  function drawBird(l, body, wing) {
    const flap = Math.sin(time * 9 + l.sway * 3);
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.ellipse(0, 0, 12, 6, 0, 0, Math.PI * 2); ctx.fill();
    disc(10, -3, 5);
    ctx.fillStyle = '#f2a33a';
    ctx.beginPath(); ctx.moveTo(14, -3); ctx.lineTo(20, -1); ctx.lineTo(14, 0); ctx.fill();
    ctx.fillStyle = wing;
    ctx.beginPath(); ctx.moveTo(-4, -2); ctx.quadraticCurveTo(-2, -22 * flap, 8, -2); ctx.closePath(); ctx.fill();
  }
  const FLOATIES = {
    lantern(l) {
      const gl = ctx.createRadialGradient(0, 0, 2, 0, 0, 40);
      gl.addColorStop(0, 'rgba(255,210,120,0.8)');
      gl.addColorStop(1, 'rgba(255,150,60,0)');
      ctx.fillStyle = gl;
      disc(0, 0, 40);
      ctx.fillStyle = lgrad(0, -18, 0, 18, [[0, '#ffcf6b'], [1, '#f06a2c']]);
      ctx.beginPath();
      ctx.moveTo(-11, -18); ctx.lineTo(11, -18); ctx.lineTo(14, 16); ctx.lineTo(-14, 16); ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff3c4';
      ctx.fillRect(-8, 12, 16, 4);
    },
    dove(l) { ctx.scale(1.3, 1.3); drawBird(l, '#ffffff', '#e8eef5'); },
    gull(l) { ctx.scale(1.2, 1.2); drawBird(l, '#f5f7fa', '#9aa6b2'); },
    bird(l) { ctx.scale(1.1, 1.1); drawBird(l, '#5a6b7c', '#3d4b59'); },
    butterfly(l) {
      const flap = 0.35 + 0.65 * Math.abs(Math.sin(time * 10 + l.sway * 2));
      const cols = [['#ff7eb6', '#ffc2dc'], ['#ffb638', '#ffe08a'], ['#6ec6ff', '#c7ecff'], ['#b28dff', '#e1d4ff']];
      const [a, b] = cols[Math.floor(l.sway * 10) % cols.length];
      for (const d of [-1, 1]) {
        ctx.save();
        ctx.scale(d * flap, 1);
        ctx.fillStyle = a;
        ctx.beginPath(); ctx.ellipse(10, -8, 11, 13, 0.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = b;
        ctx.beginPath(); ctx.ellipse(8, 9, 7, 9, -0.4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = '#3a2a2a';
      ctx.beginPath(); ctx.ellipse(0, 0, 3, 13, 0, 0, Math.PI * 2); ctx.fill();
    },
    balloon(l) {
      const cols = ['#ff5a5f', '#ffc53d', '#4cc9f0', '#7ae582', '#b28dff', '#ff8fab'];
      const c = cols[Math.floor(l.sway * 10) % cols.length];
      ctx.strokeStyle = 'rgba(80,80,80,0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, 22); ctx.quadraticCurveTo(6, 40, -2, 58); ctx.stroke();
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.ellipse(0, 0, 17, 21, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-4, 21); ctx.lineTo(4, 21); ctx.lineTo(0, 26); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath(); ctx.ellipse(-6, -8, 4, 7, -0.4, 0, Math.PI * 2); ctx.fill();
    },
    sparkle(l) {
      const tw = 0.6 + 0.4 * Math.sin(time * 6 + l.sway * 5);
      const c = ['#ffe38a', '#ffffff', '#9fe8ff', '#ffc2f0'][Math.floor(l.sway * 10) % 4];
      ctx.globalAlpha *= tw;
      glow(0, 0, 26, 'rgba(255,240,180,0.7)');
      ctx.fillStyle = c;
      ctx.beginPath();
      for (let k = 0; k < 8; k++) {
        const r = k % 2 ? 5 : 16;
        const a = (k / 8) * Math.PI * 2 + time;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
    },
  };

  // ----- Ledge faces (all the same size; only the look changes) -----
  function ledgeShadow(x0, y0, w, h, r) {
    ctx.fillStyle = 'rgba(40,25,10,0.22)';
    roundRect(x0 + 4, y0 + 8, w, h, r); ctx.fill();
  }
  const LEDGES = {
    stone(x0, y0, w, h, i, L, hl) {
      ledgeShadow(x0, y0, w, h, 12);
      roundRect(x0, y0, w, h, 12);
      ctx.fillStyle = lgrad(0, y0, 0, y0 + h, [[0, '#f4ead6'], [0.18, '#e6d6b8'], [0.75, '#cbb58f'], [1, '#a78f68']]);
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(x0, y0, w, 9);
      ctx.fillStyle = 'rgba(90,60,30,0.18)';
      ctx.fillRect(x0, y0 + h - 12, w, 12);
      ctx.fillStyle = 'rgba(120,90,50,0.22)';
      for (let k = 0; k < 7; k++) {
        const sx = x0 + ((k * 37 + i * 23) % (w - 12)) + 6;
        const syy = y0 + 14 + ((k * 19 + i * 11) % (h - 26));
        disc(sx, syy, 1.6 + (k % 3));
      }
      ctx.restore();
      ctx.lineWidth = 3;
      ctx.strokeStyle = hl ? '#d99a00' : '#8c7556';
      roundRect(x0, y0, w, h, 12);
      ctx.stroke();
      ctx.fillStyle = '#6fae4f';
      ctx.beginPath(); ctx.ellipse(x0 + 16, y0 + 2, 12, 5, 0, 0, Math.PI * 2); ctx.fill();
    },
    marble(x0, y0, w, h, i, L, hl) {
      ledgeShadow(x0, y0, w, h, 8);
      roundRect(x0, y0, w, h, 8);
      ctx.fillStyle = lgrad(0, y0, 0, y0 + h, [[0, '#fffdf8'], [0.5, '#f1ebdf'], [1, '#d7cdb9']]);
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = '#e4dccb';
      ctx.fillRect(x0, y0 + 10, w, 3);
      ctx.fillStyle = theme.accent;
      ctx.fillRect(x0, y0 + h - 17, w, 4);
      ctx.fillStyle = '#d9cfbb';
      for (let x = x0 + 5; x < x0 + w - 4; x += 12) ctx.fillRect(x, y0 + h - 10, 7, 7);
      ctx.strokeStyle = 'rgba(150,140,120,0.18)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x0 + w * 0.2, y0 + 16); ctx.quadraticCurveTo(x0 + w * 0.4, y0 + 30, x0 + w * 0.3, y0 + h - 20); ctx.stroke();
      ctx.restore();
      ctx.lineWidth = 3;
      ctx.strokeStyle = hl ? '#d99a00' : '#a89c86';
      roundRect(x0, y0, w, h, 8);
      ctx.stroke();
    },
    wood(x0, y0, w, h, i, L, hl) {
      ledgeShadow(x0, y0, w, h, 16);
      roundRect(x0, y0, w, h, 16);
      ctx.fillStyle = lgrad(0, y0, 0, y0 + h, [[0, '#f6d9a3'], [0.6, '#e2b374'], [1, '#c38b4f']]);
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = '#7a4f2a';
      ctx.fillRect(x0, y0, w, 9);
      ctx.fillStyle = '#9a6a3d';
      ctx.fillRect(x0, y0 + 9, w, 3);
      ctx.strokeStyle = 'rgba(130,80,35,0.28)';
      ctx.lineWidth = 2;
      for (let k = 0; k < 3; k++) {
        const yy = y0 + 22 + k * 14;
        ctx.beginPath();
        ctx.moveTo(x0, yy);
        ctx.bezierCurveTo(x0 + w * 0.3, yy - 5 + k * 2, x0 + w * 0.6, yy + 6, x0 + w, yy - 2);
        ctx.stroke();
      }
      ctx.restore();
      ctx.lineWidth = 3;
      ctx.strokeStyle = hl ? '#d99a00' : '#7a4f2a';
      roundRect(x0, y0, w, h, 16);
      ctx.stroke();
      // a leafy sprig
      ctx.fillStyle = theme.leaf[1];
      ctx.beginPath(); ctx.ellipse(x0 + w - 18, y0 - 2, 11, 5, -0.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = theme.leaf[0];
      ctx.beginPath(); ctx.ellipse(x0 + w - 6, y0 + 2, 9, 4.5, 0.6, 0, Math.PI * 2); ctx.fill();
    },
    rock(x0, y0, w, h, i, L, hl, f) {
      const j = (k) => (hash(i * 7.3 + k * 1.9 + f * 3.1) - 0.5) * 8;
      const pts = [
        [x0 + 8, y0 + 2 + j(1)], [x0 + w * 0.35, y0 - 2 + j(2)], [x0 + w * 0.68, y0 + 1 + j(3)], [x0 + w - 6, y0 + 4 + j(4)],
        [x0 + w + 2, y0 + h * 0.5 + j(5)], [x0 + w - 12, y0 + h + 2], [x0 + w * 0.45, y0 + h + 5 + j(6)], [x0 + 10, y0 + h - 1],
        [x0 - 3, y0 + h * 0.45 + j(7)],
      ];
      const path = (dx = 0, dy = 0) => {
        ctx.beginPath();
        pts.forEach(([px, py], k) => (k ? ctx.lineTo(px + dx, py + dy) : ctx.moveTo(px + dx, py + dy)));
        ctx.closePath();
      };
      ctx.fillStyle = 'rgba(30,30,40,0.22)';
      path(4, 8); ctx.fill();
      path();
      ctx.fillStyle = lgrad(0, y0, 0, y0 + h, [[0, theme.rock[0]], [0.55, theme.rock[1]], [1, theme.rock[2]]]);
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + w * 0.55, y0); ctx.lineTo(x0 + w * 0.3, y0 + h * 0.42); ctx.lineTo(x0, y0 + h * 0.5); ctx.fill();
      ctx.fillStyle = 'rgba(20,25,35,0.14)';
      ctx.beginPath(); ctx.moveTo(x0 + w, y0 + h * 0.3); ctx.lineTo(x0 + w, y0 + h); ctx.lineTo(x0 + w * 0.55, y0 + h); ctx.fill();
      if (f >= 6) {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(x0 - 4, y0 - 4);
        ctx.lineTo(x0 + w + 4, y0 - 4);
        for (let k = 0; k <= 8; k++) ctx.lineTo(x0 + w - (w * k) / 8, y0 + 9 + (k % 2 ? 5 : 0) + hash(k + i) * 4);
        ctx.fill();
      }
      ctx.restore();
      ctx.lineWidth = 3;
      ctx.strokeStyle = hl ? '#d99a00' : theme.rock[3];
      path();
      ctx.stroke();
      if (f < 5) {
        ctx.fillStyle = '#6fae4f';
        for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.ellipse(x0 + 12 + k * 7, y0 + 2 - (k % 2) * 2, 6, 3.5, -0.3 + k * 0.2, 0, Math.PI * 2); ctx.fill(); }
      }
    },
    flowerbox(x0, y0, w, h, i, L, hl) {
      ledgeShadow(x0, y0, w, h, 10);
      roundRect(x0, y0, w, h, 10);
      ctx.fillStyle = lgrad(0, y0, 0, y0 + h, [[0, '#fffaf0'], [1, '#f1dfbd']]);
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = theme.trim;
      ctx.fillRect(x0, y0 + h - 12, w, 12);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(x0, y0 + h - 12, w, 3);
      ctx.restore();
      ctx.lineWidth = 4;
      ctx.strokeStyle = hl ? '#d99a00' : theme.trim;
      roundRect(x0, y0, w, h, 10);
      ctx.stroke();
      // flowers peeking over the top
      const cols = ['#ff5a7a', '#ffc53d', '#b28dff', '#ff8a3d', '#ff7eb6'];
      const n = Math.max(3, Math.floor(w / 26));
      for (let k = 0; k < n; k++) {
        const fx = x0 + 14 + (k * (w - 28)) / (n - 1);
        ctx.fillStyle = '#4f9a45';
        ctx.beginPath(); ctx.ellipse(fx - 5, y0 - 1, 6, 3, -0.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = cols[(k + i) % cols.length];
        disc(fx, y0 - 5, 5);
        ctx.fillStyle = '#fff3b0';
        disc(fx, y0 - 5, 2);
      }
    },
    plank(x0, y0, w, h, i, L, hl) {
      ledgeShadow(x0, y0, w, h, 10);
      roundRect(x0, y0, w, h, 10);
      ctx.fillStyle = lgrad(0, y0, 0, y0 + h, [[0, '#ffffff'], [1, '#dfe5ec']]);
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = theme.accent;
      ctx.fillRect(x0, y0 + h - 18, w, 11);
      ctx.fillStyle = 'rgba(40,60,90,0.12)';
      ctx.fillRect(x0, y0 + h - 7, w, 7);
      ctx.restore();
      ctx.fillStyle = '#9aa6b4';
      for (const [rx, ry] of [[x0 + 9, y0 + 9], [x0 + w - 9, y0 + 9]]) disc(rx, ry, 2.6);
      ctx.lineWidth = 3;
      ctx.strokeStyle = hl ? '#d99a00' : '#8b96a5';
      roundRect(x0, y0, w, h, 10);
      ctx.stroke();
    },
    cloud(x0, y0, w, h, i, L, hl) {
      const shape = (dx = 0, dy = 0) => {
        ctx.beginPath();
        roundRect(x0 + dx, y0 + 14 + dy, w, h - 14, 26);
        ctx.moveTo(x0 + w * 0.26 + dx + 22, y0 + 24 + dy);
        ctx.arc(x0 + w * 0.26 + dx, y0 + 24 + dy, 22, 0, Math.PI * 2);
        ctx.moveTo(x0 + w * 0.54 + dx + 27, y0 + 17 + dy);
        ctx.arc(x0 + w * 0.54 + dx, y0 + 17 + dy, 27, 0, Math.PI * 2);
        ctx.moveTo(x0 + w * 0.8 + dx + 18, y0 + 27 + dy);
        ctx.arc(x0 + w * 0.8 + dx, y0 + 27 + dy, 18, 0, Math.PI * 2);
      };
      ctx.fillStyle = 'rgba(60,110,170,0.18)';
      shape(3, 8); ctx.fill();
      ctx.lineWidth = hl ? 8 : 6;
      ctx.strokeStyle = hl ? '#e6a800' : '#b9d6ee';
      shape(); ctx.stroke();
      ctx.fillStyle = lgrad(0, y0, 0, y0 + h, [[0, '#ffffff'], [0.65, '#f4f9ff'], [1, '#d6e8f8']]);
      shape(); ctx.fill();
    },
    steel(x0, y0, w, h, i, L, hl) {
      ledgeShadow(x0, y0, w, h, 6);
      roundRect(x0, y0, w, h, 6);
      ctx.fillStyle = lgrad(0, y0, 0, y0 + h, [[0, '#f3f5f9'], [0.55, '#d3d8e1'], [1, '#aab2c0']]);
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = '#ffcc1f';
      ctx.fillRect(x0, y0 + h - 12, w, 12);
      ctx.fillStyle = '#26262e';
      for (let x = x0 - 12; x < x0 + w + 12; x += 16) {
        ctx.beginPath(); ctx.moveTo(x, y0 + h); ctx.lineTo(x + 8, y0 + h); ctx.lineTo(x + 16, y0 + h - 12); ctx.lineTo(x + 8, y0 + h - 12); ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillRect(x0, y0, w, 3);
      ctx.restore();
      ctx.fillStyle = '#7d8799';
      for (const [rx, ry] of [[x0 + 8, y0 + 9], [x0 + w - 8, y0 + 9]]) disc(rx, ry, 2.5);
      ctx.lineWidth = 3;
      ctx.strokeStyle = hl ? '#d99a00' : '#5e6778';
      roundRect(x0, y0, w, h, 6);
      ctx.stroke();
    },
  };

  // ======================= 1. PAGODA (the original) =======================
  function pagodaStorey(f, yb, yt) {
    const wg = ctx.createLinearGradient(TX0, 0, TX1, 0);
    wg.addColorStop(0, '#e2c496');
    wg.addColorStop(0.5, '#f7e6c6');
    wg.addColorStop(1, '#dcbc8c');
    ctx.fillStyle = wg;
    ctx.fillRect(TX0, yt, TW, yb - yt);
    const sg = ctx.createLinearGradient(0, yt, 0, yt + 90);
    sg.addColorStop(0, 'rgba(90,40,15,0.35)');
    sg.addColorStop(1, 'rgba(90,40,15,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(TX0, yt, TW, 90);
    const lit = f <= floor && f > 0;
    if (f > 0) sideSpots().forEach((wx, i) => { const round = (i + f) % 2 === 0; lattice(wx - 28, yt + 105, 56, round ? 56 : 76, lit, round); });
    ctx.fillStyle = '#7a3f22';
    ctx.fillRect(TX0, yb - 12, TW, 12);
    pillar(TX0, yt, yb);
    pillar(TX1 - 26, yt, yb);
    floorBadge(f, TX0 + 13, yt + 150);
  }
  function pagodaDoor(yb, lit) {
    const w = doorW();
    const x = TCX - w / 2;
    const y = yb - 12 - DOOR_H;
    ctx.fillStyle = '#5c1e12';
    roundRect(x - 7, y - 7, w + 14, DOOR_H + 9, 10); ctx.fill();
    ctx.fillStyle = lit ? '#c8402a' : '#a8321f';
    ctx.fillRect(x, y, w, DOOR_H);
    ctx.fillStyle = '#7e1f12';
    ctx.fillRect(TCX - 1.5, y, 3, DOOR_H);
    ctx.fillStyle = '#f2c14e';
    for (let r = 0; r < 3; r++) { disc(x + 11, y + 22 + r * 30, 3.2); disc(x + w - 11, y + 22 + r * 30, 3.2); }
    disc(TCX - 7, y + DOOR_H * 0.55, 3.5); disc(TCX + 7, y + DOOR_H * 0.55, 3.5);
    // a little tiled cap
    ctx.fillStyle = '#236c64';
    ctx.beginPath(); ctx.moveTo(x - 16, y - 6); ctx.lineTo(x + w + 16, y - 6); ctx.lineTo(x + w + 4, y - 20); ctx.lineTo(x - 4, y - 20); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e8b93f';
    ctx.fillRect(x - 16, y - 8, w + 32, 3);
  }
  function pagodaBackdrop() { drawMountains(); }

  // ======================= 2. STONE TEMPLE =======================
  function entablature(y, ext) {
    const L = TX0 - ext;
    const R = TX1 + ext;
    // architrave + frieze, a touch narrower than the cornice
    ctx.fillStyle = '#ece5d6';
    ctx.fillRect(L + 10, y + 40, R - L - 20, 18);
    ctx.fillStyle = 'rgba(120,100,70,0.25)';
    ctx.fillRect(L + 10, y + 54, R - L - 20, 4);
    ctx.fillStyle = theme.accent;
    ctx.fillRect(L + 6, y + 17, R - L - 12, 24);
    ctx.strokeStyle = '#f6eedc';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = L + 12; x < R - 26; x += 22) { // Greek key
      ctx.moveTo(x, y + 36); ctx.lineTo(x, y + 22); ctx.lineTo(x + 16, y + 22); ctx.lineTo(x + 16, y + 31);
      ctx.lineTo(x + 7, y + 31); ctx.lineTo(x + 7, y + 27);
      ctx.moveTo(x, y + 36); ctx.lineTo(x + 22, y + 36);
    }
    ctx.stroke();
    // cornice he stands on
    ctx.fillStyle = lgrad(0, y, 0, y + 17, [[0, '#fffdf7'], [1, '#ddd3c0']]);
    ctx.fillRect(L, y, R - L, 17);
    ctx.fillStyle = '#d2c7b1';
    for (let x = L + 4; x < R - 6; x += 11) ctx.fillRect(x, y + 12, 6, 5);
    ctx.fillStyle = 'rgba(80,60,40,0.18)';
    ctx.fillRect(L, y + 17, R - L, 3);
  }
  function brazier(x, y, lit, s = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.strokeStyle = '#7a5a2a';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(-3, -14); ctx.moveTo(8, 0); ctx.lineTo(3, -14); ctx.stroke();
    ctx.fillStyle = lgrad(-14, 0, 14, 0, [[0, '#8a5a1a'], [0.5, '#e0a84a'], [1, '#8a5a1a']]);
    ctx.beginPath(); ctx.moveTo(-15, -22); ctx.lineTo(15, -22); ctx.quadraticCurveTo(12, -10, 0, -10); ctx.quadraticCurveTo(-12, -10, -15, -22); ctx.fill();
    if (lit > 0) {
      ctx.globalAlpha *= lit;
      glow(0, -34, 46, 'rgba(255,190,80,0.7)');
      const fl = Math.sin(time * 12) * 2;
      ctx.fillStyle = '#ff7a1a';
      ctx.beginPath(); ctx.moveTo(-12, -22); ctx.quadraticCurveTo(-10, -44, fl, -56); ctx.quadraticCurveTo(10, -44, 12, -22); ctx.fill();
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath(); ctx.moveTo(-6, -22); ctx.quadraticCurveTo(-5, -36, fl * 0.6, -44); ctx.quadraticCurveTo(5, -36, 6, -22); ctx.fill();
    }
    ctx.restore();
  }
  function column(x, top, bottom, cw) {
    ctx.fillStyle = lgrad(x - cw / 2, 0, x + cw / 2, 0, [[0, '#cfc6b4'], [0.4, '#fbf8f1'], [1, '#c9bfab']]);
    ctx.fillRect(x - cw / 2, top + 14, cw, bottom - top - 26);
    ctx.strokeStyle = 'rgba(140,125,100,0.35)';
    ctx.lineWidth = 1.5;
    for (let k = 1; k < 4; k++) { const fx = x - cw / 2 + (cw * k) / 4; ctx.beginPath(); ctx.moveTo(fx, top + 16); ctx.lineTo(fx, bottom - 14); ctx.stroke(); }
    // Ionic capital with little scrolls
    ctx.fillStyle = '#f3eee3';
    ctx.fillRect(x - cw / 2 - 8, top, cw + 16, 8);
    ctx.fillStyle = '#e6dfd0';
    ctx.fillRect(x - cw / 2 - 3, top + 8, cw + 6, 7);
    for (const d of [-1, 1]) {
      ctx.fillStyle = '#f3eee3'; disc(x + d * (cw / 2 + 3), top + 12, 6);
      ctx.fillStyle = '#b9ad97'; disc(x + d * (cw / 2 + 3), top + 12, 2.2);
    }
    ctx.fillStyle = '#ece5d6';
    ctx.fillRect(x - cw / 2 - 5, bottom - 13, cw + 10, 6);
    ctx.fillRect(x - cw / 2 - 9, bottom - 7, cw + 18, 7);
  }
  function templeStorey(f, yb, yt) {
    ctx.fillStyle = lgrad(0, yt, 0, yb, [[0, '#a88f68'], [0.35, '#cdb994'], [1, '#e2d3b3']]);
    ctx.fillRect(TX0 + 6, yt, TW - 12, yb - yt);
    ctx.strokeStyle = 'rgba(120,95,60,0.18)';
    ctx.lineWidth = 2;
    for (let r = 0; r * 28 < yb - yt; r++) {
      const y = yt + r * 28;
      ctx.beginPath(); ctx.moveTo(TX0 + 6, y); ctx.lineTo(TX1 - 6, y); ctx.stroke();
      for (let x = TX0 + 6 + (r % 2) * 30; x < TX1 - 6; x += 60) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, Math.min(yb, y + 28)); ctx.stroke(); }
    }
    const cw = narrowUI() ? 22 : 30;
    const xs = [TX0 + cw / 2 + 6, ...sideSpots(), TX1 - cw / 2 - 6];
    const top = yt + 58; // just under the entablature
    const lit = f <= floor && f > 0;
    if (lit) {
      ctx.strokeStyle = '#5f8f3a';
      ctx.lineWidth = 4;
      for (let k = 0; k < xs.length - 1; k++) {
        const a = xs[k] + cw / 2 + 6;
        const b = xs[k + 1] - cw / 2 - 6;
        if (b - a < 20) continue;
        ctx.beginPath(); ctx.moveTo(a, top + 18); ctx.quadraticCurveTo((a + b) / 2, top + 50, b, top + 18); ctx.stroke();
        ctx.fillStyle = '#79ad4c';
        for (let u = 0.1; u < 0.95; u += 0.13) {
          const px = lerp(a, b, u);
          const py = top + 18 + 64 * u * (1 - u);
          ctx.beginPath(); ctx.ellipse(px, py, 5, 2.6, u * 6, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = '#e04a3a';
        disc((a + b) / 2, top + 34, 3.5);
      }
    }
    for (const x of xs) column(x, top, yb, cw);
    ctx.fillStyle = '#efe8d8';
    ctx.fillRect(TX0, yb - 4, TW, 4);
    floorBadge(f, TX0 + cw / 2 + 6, yt + 150);
  }
  function templeDoor(yb, lit, big = 1) {
    const w = doorW() * big;
    const h = DOOR_H * big;
    const x = TCX - w / 2;
    const y = yb - h;
    ctx.fillStyle = '#efe8d8';
    ctx.fillRect(x - 9, y - 8, w + 18, h + 8);
    ctx.fillStyle = lgrad(0, y, 0, yb, [[0, '#24170e'], [1, '#4a3322']]);
    ctx.fillRect(x, y, w, h);
    if (lit) glow(TCX, y + h * 0.6, w * 0.8, 'rgba(255,196,110,0.75)');
    ctx.fillStyle = lgrad(0, 0, 0, 1, [[0, '#b0782e'], [1, '#b0782e']]);
    ctx.fillRect(x, y, w * 0.2, h);
    ctx.fillRect(x + w * 0.8, y, w * 0.2, h);
    ctx.fillStyle = '#e1b862';
    for (let k = 0; k < 4; k++) { disc(x + w * 0.1, y + 16 + k * (h - 24) / 3, 2.2); disc(x + w * 0.9, y + 16 + k * (h - 24) / 3, 2.2); }
    ctx.fillStyle = '#fbf6ea';
    ctx.fillRect(x - 16, y - 18, w + 32, 12);
    ctx.fillStyle = theme.accent;
    ctx.fillRect(x - 12, y - 6, w + 24, 4);
  }
  function templeDeck(f, y, litA) {
    entablature(y, eaveExt(26));
    if (litA > 0) {
      brazier(TX0 + (narrowUI() ? 16 : 22), y, litA, 0.8);
      brazier(TX1 - (narrowUI() ? 16 : 22), y, litA, 0.8);
    }
  }
  function cypress(x, y, h) {
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(x - 3, y - 12, 6, 14);
    ctx.fillStyle = lgrad(x - 16, 0, x + 16, 0, [[0, '#1f4a2a'], [0.5, '#2f6a3a'], [1, '#1c4226']]);
    ctx.beginPath();
    ctx.moveTo(x, y - h);
    ctx.bezierCurveTo(x + 22, y - h * 0.6, x + 18, y - 10, x, y - 8);
    ctx.bezierCurveTo(x - 18, y - 10, x - 22, y - h * 0.6, x, y - h);
    ctx.fill();
  }
  function olive(x, y, s) {
    ctx.fillStyle = '#6b5236';
    ctx.beginPath(); ctx.moveTo(x - 4 * s, y); ctx.quadraticCurveTo(x - 10 * s, y - 30 * s, x - 2 * s, y - 44 * s); ctx.lineTo(x + 5 * s, y - 44 * s); ctx.quadraticCurveTo(x + 2 * s, y - 20 * s, x + 6 * s, y); ctx.fill();
    for (const [dx, dy, r, c] of [[-18, -52, 20, '#7f9a63'], [14, -56, 22, '#8fab70'], [-2, -70, 20, '#9cb87c'], [22, -44, 14, '#7f9a63'], [-26, -40, 13, '#8fab70']]) {
      ctx.fillStyle = c; disc(x + dx * s, y + dy * s, r * s);
    }
  }
  function templeGround(y) {
    ctx.fillStyle = lgrad(0, y, 0, y + 120, [[0, '#9cc96a'], [1, '#6d9f4c']]);
    ctx.fillRect(0, y, W, H - y + 10);
    for (let k = 0; k < 3; k++) {
      const e = 12 + k * 22;
      const L = Math.max(-10, TX0 - e);
      const R = Math.min(W + 10, TX1 + e);
      ctx.fillStyle = lgrad(0, y + k * 14, 0, y + k * 14 + 14, [[0, '#fbf8f0'], [1, '#d9d0bf']]);
      ctx.fillRect(L, y + k * 14, R - L, 14);
      ctx.fillStyle = 'rgba(120,100,70,0.25)';
      ctx.fillRect(L, y + k * 14 + 12, R - L, 2);
    }
    const s = narrowUI() ? 0.75 : 1;
    cypress(narrowUI() ? 12 : 44, y + 50, 150 * s);
    cypress(narrowUI() ? W - 12 : W - 44, y + 56, 170 * s);
    if (!narrowUI()) { olive(110, y + 70, 1); olive(W - 112, y + 76, 0.9); }
    ctx.fillStyle = '#e04a3a';
    for (const [x, dy] of [[26, 70], [84, 88], [W - 90, 84], [W - 30, 96], [TX0 + 10, 90], [TX1 - 20, 98]]) disc(x, y + dy, 4);
  }
  function templeGate(yb) { templeDoor(yb, true, 1.3); }
  function templeCrown(base) {
    const ext = eaveExt(30);
    entablature(base, ext);
    const L = TX0 - ext;
    const R = TX1 + ext;
    const ph = Math.min(118, TW * 0.23);
    const apex = base - ph;
    ctx.fillStyle = lgrad(0, apex, 0, base, [[0, '#fffdf7'], [1, '#e7dfcd']]);
    ctx.beginPath(); ctx.moveTo(L, base + 2); ctx.lineTo(TCX, apex); ctx.lineTo(R, base + 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = lgrad(0, apex, 0, base, [[0, '#d9cdb4'], [1, '#c8b995']]);
    ctx.beginPath(); ctx.moveTo(L + 30, base - 4); ctx.lineTo(TCX, apex + 16); ctx.lineTo(R - 30, base - 4); ctx.closePath(); ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#f7f3ea';
    ctx.beginPath(); ctx.moveTo(L - 4, base + 2); ctx.lineTo(TCX, apex - 3); ctx.lineTo(R + 4, base + 2); ctx.stroke();
    // a golden sun in the gable
    const sy0 = base - ph * 0.36;
    ctx.fillStyle = '#e8b93f';
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(TCX + Math.cos(a) * 14, sy0 + Math.sin(a) * 14); ctx.lineTo(TCX + Math.cos(a + 0.13) * 26, sy0 + Math.sin(a + 0.13) * 26); ctx.lineTo(TCX + Math.cos(a + 0.26) * 14, sy0 + Math.sin(a + 0.26) * 14); ctx.fill();
    }
    ctx.fillStyle = '#ffd766'; disc(TCX, sy0, 15);
    // palmettes at the corners
    for (const x of [L + 8, R - 8]) {
      ctx.fillStyle = '#e6dcc6';
      for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.ellipse(x + k * 5, base - 12, 3.5, 11, k * 0.35, 0, Math.PI * 2); ctx.fill(); }
    }
    // the flame is lit when he reaches the top
    brazier(TCX, apex - 2, floor >= FLOORS ? clamp(topT, 0, 1) : 0, 1.25);
  }
  function templeBackdrop() {
    const hz = 560 + (H - 760) + cam * FH * 0.12;
    hills([{ par: 0.12, base: 560, amp: 70, col: '#a9bcd4', seed: 2.2, a: 0.9 }], 'smooth');
    seaBand(hz, '#7cc3e8', '#3d8fc6');
    hills([{ par: 0.3, base: 760, amp: 110, col: '#b6c98c', seed: 5.1 }], 'smooth', (m, base) => {
      // little white houses with blue domes on the near hill
      for (let k = 0; k < 9; k++) {
        const x = 20 + hash(k + 3) * (W - 40);
        const top = base - hillH(m, x, 'smooth');
        const w = 16 + hash(k + 8) * 12;
        ctx.fillStyle = '#fbfbf7';
        ctx.fillRect(x - w / 2, top - 6, w, 18);
        if (k % 3 === 0) { ctx.fillStyle = '#2f6fb3'; ctx.beginPath(); ctx.arc(x, top - 6, w * 0.32, Math.PI, 0); ctx.fill(); }
        ctx.fillStyle = '#5c86b8';
        ctx.fillRect(x - 2, top + 1, 4, 5);
      }
    });
  }

  // ======================= 3. GIANT TREE =======================
  const barkEdge = (y, side, f) => side * (5 * Math.sin(worldY(y) * 0.031 + side * 1.3) + 3 * Math.sin(worldY(y) * 0.083));
  function treeStorey(f, yb, yt) {
    ctx.beginPath();
    const ys = [];
    for (let y = yt - 4; y < yb + 8; y += 12) ys.push(y);
    ys.push(yb + 8);
    for (const y of ys) ctx.lineTo(TX0 - 6 + barkEdge(y, -1, f), y);
    for (let k = ys.length - 1; k >= 0; k--) ctx.lineTo(TX1 + 6 + barkEdge(ys[k], 1, f), ys[k]);
    ctx.closePath();
    ctx.fillStyle = lgrad(TX0, 0, TX1, 0, [[0, '#5a391d'], [0.25, '#8a5c33'], [0.55, '#9c6b3e'], [0.85, '#7a4f2a'], [1, '#553619']]);
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.lineWidth = 3;
    for (let x = TX0 + 14; x < TX1; x += 27) {
      ctx.strokeStyle = 'rgba(55,32,12,0.35)';
      ctx.beginPath();
      for (let y = yt; y <= yb; y += 10) ctx.lineTo(x + 5 * Math.sin(worldY(y) * 0.045 + x * 0.3), y);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(210,160,100,0.18)';
      ctx.beginPath();
      for (let y = yt; y <= yb; y += 10) ctx.lineTo(x + 5 + 5 * Math.sin(worldY(y) * 0.045 + x * 0.3), y);
      ctx.stroke();
    }
    // a knot or two
    for (let k = 0; k < 2; k++) {
      const kx = TX0 + 40 + hash(f * 3 + k) * (TW - 80);
      if (Math.abs(kx - TCX) < doorW()) continue;
      const ky = yt + 120 + hash(f * 5 + k) * 60;
      ctx.fillStyle = '#4e3018';
      ctx.beginPath(); ctx.ellipse(kx, ky, 10, 14, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(200,150,90,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(kx, ky, 14, 19, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
    const lit = f <= floor && f > 0;
    if (f > 0) sideSpots().forEach((wx) => {
      ctx.fillStyle = '#4a2c14';
      disc(wx, yt + 132, 30);
      ctx.fillStyle = lit ? '#ffd27a' : '#2b1a0c';
      disc(wx, yt + 132, 23);
      if (lit) glow(wx, yt + 132, 44, 'rgba(255,220,120,0.6)');
      ctx.strokeStyle = '#6b4423';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(wx - 23, yt + 132); ctx.lineTo(wx + 23, yt + 132); ctx.moveTo(wx, yt + 109); ctx.lineTo(wx, yt + 155); ctx.stroke();
      ctx.fillStyle = theme.leaf[0];
      ctx.beginPath(); ctx.ellipse(wx - 22, yt + 106, 10, 5, -0.6, 0, Math.PI * 2); ctx.fill();
    });
    // ivy trailing down the sides
    ctx.strokeStyle = '#3f7a30';
    ctx.lineWidth = 2.5;
    for (const [x, len] of [[TX0 + 8, 70 + hash(f) * 70], [TX1 - 8, 60 + hash(f + 9) * 80]]) {
      ctx.beginPath(); ctx.moveTo(x, yt + 40);
      for (let d = 0; d <= len; d += 8) ctx.lineTo(x + Math.sin(d * 0.12) * 4, yt + 40 + d);
      ctx.stroke();
      ctx.fillStyle = theme.leaf[1];
      for (let d = 10; d <= len; d += 16) { ctx.beginPath(); ctx.ellipse(x + Math.sin(d * 0.12) * 4 + (d % 32 ? 6 : -6), yt + 40 + d, 6, 3.5, d % 32 ? 0.5 : -0.5, 0, Math.PI * 2); ctx.fill(); }
    }
    floorBadge(f, TX0 + 22, yt + 150);
  }
  function roundDoor(x, yb, w, h) { // an arch-topped door outline
    const y = yb - h;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, yb);
    ctx.lineTo(x - w / 2, y + w / 2);
    ctx.arc(x, y + w / 2, w / 2, Math.PI, 0);
    ctx.lineTo(x + w / 2, yb);
    ctx.closePath();
  }
  function treeDoor(yb, lit, big = 1) {
    const w = doorW() * big;
    const h = DOOR_H * big;
    ctx.fillStyle = '#3a2410';
    ctx.beginPath(); ctx.ellipse(TCX, yb - h / 2 + 4, w / 2 + 14, h / 2 + 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#b07a45';
    ctx.lineWidth = 4;
    ctx.stroke();
    roundDoor(TCX, yb, w, h - 6);
    ctx.fillStyle = lgrad(TCX - w / 2, 0, TCX + w / 2, 0, [[0, theme.doorCol[1]], [0.5, theme.doorCol[0]], [1, theme.doorCol[1]]]);
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 2;
    for (let x = TCX - w / 2 + w / 4; x < TCX + w / 2; x += w / 4) { ctx.beginPath(); ctx.moveTo(x, yb - h); ctx.lineTo(x, yb); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = lit ? '#ffd27a' : '#3b4a3a';
    disc(TCX, yb - h + w * 0.34, w * 0.13);
    if (lit) glow(TCX, yb - h + w * 0.34, w * 0.4, 'rgba(255,220,120,0.5)');
    ctx.fillStyle = '#f2c14e';
    disc(TCX + w * 0.28, yb - h * 0.45, 4);
  }
  function treeDeck(f, y, litA) {
    const ext = eaveExt(70);
    const L = TX0 - ext;
    const R = TX1 + ext;
    // the branch
    ctx.fillStyle = lgrad(0, y + 6, 0, y + 44, [[0, '#9c6b3e'], [0.5, '#7a4f2a'], [1, '#553619']]);
    ctx.beginPath();
    ctx.moveTo(L, y + 14);
    ctx.quadraticCurveTo(TCX, y + 2, R, y + 14);
    ctx.lineTo(R, y + 30);
    ctx.quadraticCurveTo(TCX, y + 50, L, y + 30);
    ctx.closePath();
    ctx.fill();
    // plank walkway
    ctx.fillStyle = '#d7a868';
    ctx.fillRect(TX0 - 14, y, TW + 28, 11);
    ctx.fillStyle = '#b8864a';
    for (let x = TX0 - 14; x < TX1 + 14; x += 24) ctx.fillRect(x, y, 2, 11);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(TX0 - 14, y, TW + 28, 2);
    // leaf clusters on the ends
    for (const [x, d] of [[L + 8, -1], [R - 8, 1]]) {
      for (let k = 0; k < 6; k++) {
        const a = k * 1.1;
        ctx.fillStyle = theme.leaf[k % 3];
        disc(x + d * (Math.cos(a) * 16) , y + 14 + Math.sin(a) * 14 - 6, 17 + (k % 2) * 5);
      }
    }
    if (litA > 0) {
      ctx.save();
      ctx.globalAlpha *= litA;
      ctx.strokeStyle = 'rgba(60,40,20,0.7)';
      ctx.lineWidth = 1.5;
      const segs = 4;
      for (let s = 0; s < segs; s++) {
        const a = TX0 + (TW * s) / segs;
        const b = TX0 + (TW * (s + 1)) / segs;
        ctx.beginPath(); ctx.moveTo(a, y + 12); ctx.quadraticCurveTo((a + b) / 2, y + 40, b, y + 12); ctx.stroke();
        const cols = ['#ffd23f', '#ff6b6b', '#6be6ff', '#7dff9b'];
        for (let u = 0.2; u < 0.9; u += 0.3) {
          const px = lerp(a, b, u);
          const py = y + 12 + 28 * 4 * u * (1 - u) * 0.5 + 4;
          glow(px, py, 12, 'rgba(255,240,170,0.6)');
          ctx.fillStyle = cols[Math.round(u * 10 + s) % 4];
          disc(px, py, 3.5);
        }
      }
      ctx.restore();
    }
  }
  function mushroom(x, y, s) {
    ctx.fillStyle = '#fff4e0';
    ctx.fillRect(x - 4 * s, y - 14 * s, 8 * s, 14 * s);
    ctx.fillStyle = '#e04a3a';
    ctx.beginPath(); ctx.ellipse(x, y - 14 * s, 14 * s, 10 * s, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#fff';
    disc(x - 5 * s, y - 18 * s, 2.2 * s); disc(x + 5 * s, y - 20 * s, 2 * s); disc(x + 1 * s, y - 15 * s, 1.6 * s);
  }
  function treeGround(y) {
    ctx.fillStyle = lgrad(0, y, 0, y + 120, [[0, '#86cf5f'], [1, '#4f9a45']]);
    ctx.fillRect(0, y, W, H - y + 10);
    // roots flaring out from the trunk
    for (const d of [-1, 1]) {
      const x = d < 0 ? TX0 : TX1;
      ctx.fillStyle = '#6b4423';
      ctx.beginPath();
      ctx.moveTo(x - d * 30, y - 40);
      ctx.quadraticCurveTo(x + d * 10, y - 10, x + d * 56, y + 16);
      ctx.quadraticCurveTo(x + d * 10, y + 14, x - d * 30, y + 8);
      ctx.fill();
    }
    ctx.fillStyle = '#6b4423';
    ctx.fillRect(TX0 - 6, y - 4, TW + 12, 10);
    mushroom(narrowUI() ? 14 : 70, y + 60, 1.1);
    mushroom(narrowUI() ? W - 16 : W - 80, y + 70, 1.3);
    mushroom(TX0 - 14, y + 44, 0.8);
    ctx.font = `26px ${EMOJI_FONT}`;
    for (const [x, dy] of [[30, 34], [120, 64], [W - 120, 50], [W - 36, 80], [TX1 + 34, 90]]) emo('🌼', x, y + dy, 24);
    if (!narrowUI()) emo('🐿️', TX1 + 70, y + 40, 38);
  }
  function treeGate(yb) { treeDoor(yb, true, 1.25); }
  function treeCrown(base) {
    // big leafy canopy
    const spread = TW / 2 + Math.min(90, TX0);
    const blobs = [];
    for (let k = 0; k < 26; k++) {
      blobs.push([TCX + (hash(k + 1) - 0.5) * 2 * spread, base - 10 - hash(k + 50) * 170 + Math.abs(hash(k + 1) - 0.5) * 90, 38 + hash(k + 99) * 30]);
    }
    ctx.fillStyle = theme.leaf[2];
    for (const [x, y, r] of blobs) disc(x, y + 10, r);
    ctx.fillStyle = theme.leaf[0];
    for (const [x, y, r] of blobs) disc(x, y, r * 0.92);
    ctx.fillStyle = theme.leaf[1];
    for (const [x, y, r] of blobs) disc(x - r * 0.25, y - r * 0.3, r * 0.5);
    if (theme.blossom) {
      ctx.fillStyle = theme.blossom;
      for (let k = 0; k < 40; k++) disc(TCX + (hash(k + 300) - 0.5) * 2 * spread * 0.9, base - 20 - hash(k + 400) * 190, 3.5);
    }
    // the treehouse
    const hw = Math.min(130, TW * 0.34);
    const hy = base - 150;
    ctx.fillStyle = '#6b4423';
    ctx.fillRect(TCX - hw / 2 - 14, hy + 64, hw + 28, 10);
    ctx.fillStyle = lgrad(0, hy, 0, hy + 64, [[0, '#d7a868'], [1, '#b8864a']]);
    ctx.fillRect(TCX - hw / 2, hy, hw, 64);
    ctx.fillStyle = 'rgba(90,55,20,0.35)';
    for (let yy = hy + 12; yy < hy + 64; yy += 12) ctx.fillRect(TCX - hw / 2, yy, hw, 2);
    const lit = floor >= FLOORS;
    ctx.fillStyle = lit ? '#ffd27a' : '#4a3a2a';
    disc(TCX - hw * 0.22, hy + 28, 12);
    if (lit) glow(TCX - hw * 0.22, hy + 28, 34, 'rgba(255,220,120,0.6)');
    ctx.fillStyle = theme.doorCol[0];
    roundRect(TCX + hw * 0.1, hy + 18, hw * 0.24, 46, 8); ctx.fill();
    ctx.fillStyle = '#d8453a';
    ctx.beginPath(); ctx.moveTo(TCX - hw / 2 - 16, hy + 4); ctx.lineTo(TCX, hy - 44); ctx.lineTo(TCX + hw / 2 + 16, hy + 4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#b3342b';
    ctx.fillRect(TCX - hw / 2 - 16, hy, hw + 32, 5);
    pole(TCX, hy - 130, hy - 40);
    flag(TCX, 0, topRaise(), '#ffd23f', '#d8453a', hy - 82, hy - 126);
    if (!narrowUI()) { emo('🐦', TCX - spread * 0.7, base - 120, 30); emo('🐦', TCX + spread * 0.75, base - 60, 26); }
  }
  function treeBackdrop() {
    hills([
      { par: 0.1, base: 580, amp: 120, col: '#9fc7b3', seed: 1.1, a: 0.8 },
      { par: 0.2, base: 660, amp: 100, col: '#6fa77f', seed: 3.7, a: 0.9 },
      { par: 0.34, base: 740, amp: 80, col: '#4d8a5a', seed: 6.2 },
    ], 'trees');
  }

  // ======================= 4. MOUNTAIN =======================
  function rockEdge(y, side) { return side * (8 + 10 * hash(Math.floor(worldY(y) / 26) * 1.3 + side * 7)); }
  function mountainStorey(f, yb, yt) {
    ctx.beginPath();
    const ys = [];
    for (let y = yt - 4; y < yb + 10; y += 26) ys.push(y);
    ys.push(yb + 10);
    for (const y of ys) ctx.lineTo(TX0 + rockEdge(y, -1), y);
    for (let k = ys.length - 1; k >= 0; k--) ctx.lineTo(TX1 + rockEdge(ys[k], 1), ys[k]);
    ctx.closePath();
    ctx.fillStyle = lgrad(TX0, 0, TX1, 0, [[0, theme.rock[2]], [0.3, theme.rock[1]], [0.6, theme.rock[0]], [1, theme.rock[2]]]);
    ctx.fill();
    ctx.save();
    ctx.clip();
    for (let k = 0; k < 9; k++) {
      const cx = TX0 + hash(f * 11 + k) * TW;
      const cy = yt + hash(f * 13 + k + 5) * (yb - yt);
      const r = 30 + hash(f * 17 + k) * 40;
      ctx.fillStyle = k % 2 ? 'rgba(255,255,255,0.12)' : 'rgba(20,25,35,0.12)';
      ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx - r * 0.2, cy - r * 0.7); ctx.lineTo(cx + r, cy - r * 0.2); ctx.lineTo(cx + r * 0.4, cy + r * 0.6); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(30,30,40,0.12)';
    ctx.lineWidth = 2;
    for (let k = 0; k < 7; k++) {
      const y0 = yt + ((k * 37 + f * 11) % (yb - yt));
      ctx.beginPath(); ctx.moveTo(TX0 - 30, y0 + 20); ctx.lineTo(TX1 + 30, y0 - 20); ctx.stroke();
    }
    if (f >= 6) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (let k = 0; k < 5; k++) {
        const cx = TX0 + hash(f * 23 + k) * TW;
        const cy = yt + 80 + hash(f * 29 + k) * (yb - yt - 100);
        ctx.beginPath(); ctx.ellipse(cx, cy, 20 + hash(k) * 16, 6, -0.2, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
    if (f <= 3) {
      for (const [x, s] of [[TX0 + 20, 1], [TX1 - 22, 0.8]]) pine(x, yb - 6, s);
    }
    const lit = f <= floor && f > 0;
    if (f > 0) sideSpots().forEach((wx, i) => {
      // crystals in the rock that sparkle once he's been here
      ctx.fillStyle = lit ? theme.gem : 'rgba(40,50,70,0.35)';
      const cy = yt + 132;
      for (const [dx, hgt, w] of [[-8, 26, 9], [4, 34, 11], [14, 20, 8]]) {
        ctx.beginPath(); ctx.moveTo(wx + dx - w / 2, cy + 14); ctx.lineTo(wx + dx, cy + 14 - hgt); ctx.lineTo(wx + dx + w / 2, cy + 14); ctx.fill();
      }
      if (lit) glow(wx + 4, cy, 34 + Math.sin(time * 3 + i) * 4, 'rgba(180,230,255,0.55)');
    });
    floorBadge(f, TX0 + 22, yt + 150);
  }
  function pine(x, y, s) {
    ctx.fillStyle = '#5b3d22';
    ctx.fillRect(x - 3 * s, y - 12 * s, 6 * s, 12 * s);
    ctx.fillStyle = '#2f6b3f';
    for (let k = 0; k < 3; k++) {
      const w = (26 - k * 6) * s;
      const ty = y - (12 + k * 16) * s;
      ctx.beginPath(); ctx.moveTo(x - w, ty); ctx.lineTo(x, ty - 28 * s); ctx.lineTo(x + w, ty); ctx.closePath(); ctx.fill();
    }
  }
  function mountainDoor(yb, lit, big = 1) {
    const w = doorW() * big + 8;
    const h = DOOR_H * big;
    const pts = [];
    for (let k = 0; k <= 10; k++) {
      const a = Math.PI + (k / 10) * Math.PI;
      pts.push([TCX + Math.cos(a) * w / 2, yb - h + w / 2 + Math.sin(a) * w / 2 * 1.1]);
    }
    const path = (grow) => {
      ctx.beginPath();
      ctx.moveTo(TCX - w / 2 - grow, yb);
      for (const [px, py] of pts) ctx.lineTo(TCX + (px - TCX) * (1 + grow / w * 2), py - grow);
      ctx.lineTo(TCX + w / 2 + grow, yb);
      ctx.closePath();
    };
    ctx.fillStyle = theme.rock[3];
    path(10); ctx.fill();
    ctx.fillStyle = lgrad(0, yb - h, 0, yb, [[0, '#15120f'], [1, '#3a2f26']]);
    path(0); ctx.fill();
    if (lit) {
      glow(TCX, yb - 24, w * 0.8, 'rgba(255,170,70,0.7)');
      // a tiny campfire inside
      ctx.fillStyle = '#6b4423';
      ctx.fillRect(TCX - 12, yb - 8, 24, 5);
      const fl = Math.sin(time * 12) * 2;
      ctx.fillStyle = '#ff7a1a';
      ctx.beginPath(); ctx.moveTo(TCX - 9, yb - 8); ctx.quadraticCurveTo(TCX - 6, yb - 24, TCX + fl, yb - 32); ctx.quadraticCurveTo(TCX + 6, yb - 22, TCX + 9, yb - 8); ctx.fill();
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath(); ctx.moveTo(TCX - 4, yb - 8); ctx.quadraticCurveTo(TCX - 3, yb - 18, TCX + fl * 0.5, yb - 22); ctx.quadraticCurveTo(TCX + 3, yb - 16, TCX + 4, yb - 8); ctx.fill();
    }
  }
  function mountainDeck(f, y, litA) {
    const ext = eaveExt(40);
    const L = TX0 - ext;
    const R = TX1 + ext;
    ctx.fillStyle = lgrad(0, y, 0, y + 56, [[0, theme.rock[1]], [1, theme.rock[3]]]);
    ctx.beginPath();
    ctx.moveTo(L, y);
    ctx.lineTo(R, y);
    for (let k = 0; k <= 12; k++) {
      const x = R - ((R - L) * k) / 12;
      ctx.lineTo(x, y + 26 + hash(k + f * 5) * 26);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(L, y + 2, R - L, 4);
    const snow = f >= 5;
    ctx.fillStyle = snow ? '#ffffff' : '#79b957';
    ctx.beginPath();
    ctx.moveTo(L - 2, y - 5);
    ctx.lineTo(R + 2, y - 5);
    for (let k = 0; k <= 16; k++) ctx.lineTo(R - ((R - L) * k) / 16, y + 4 + (k % 2 ? 5 : 1) + hash(k + f) * 3);
    ctx.closePath();
    ctx.fill();
    if (!snow) {
      ctx.fillStyle = '#5c9c43';
      for (let x = L + 6; x < R; x += 17) { ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x + 3, y - 11); ctx.lineTo(x + 6, y - 4); ctx.fill(); }
    }
    if (litA > 0) {
      // a string of little flags
      ctx.save();
      ctx.globalAlpha *= litA;
      const cols = ['#e8453a', '#ffd23f', '#3fae5a', '#2f7fd8', '#ffffff'];
      ctx.strokeStyle = 'rgba(60,50,40,0.8)';
      ctx.lineWidth = 1.5;
      const a = TX0 + 10;
      const b = TX1 - 10;
      ctx.beginPath(); ctx.moveTo(a, y + 30); ctx.quadraticCurveTo(TCX, y + 64, b, y + 30); ctx.stroke();
      const n = Math.floor((b - a) / 26);
      for (let k = 1; k < n; k++) {
        const u = k / n;
        const px = lerp(a, b, u);
        const py = y + 30 + 34 * 2 * u * (1 - u) * 1;
        ctx.fillStyle = cols[k % cols.length];
        ctx.beginPath(); ctx.moveTo(px - 8, py); ctx.lineTo(px + 8, py); ctx.lineTo(px, py + 15 + Math.sin(time * 4 + k) * 2); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
  }
  function mountainGround(y) {
    ctx.fillStyle = lgrad(0, y, 0, y + 120, [[0, '#9ad06a'], [1, '#5f9f4a']]);
    ctx.fillRect(0, y, W, H - y + 10);
    ctx.fillStyle = theme.rock[1];
    for (const [x, r] of [[TX0 - 20, 26], [TX1 + 24, 30], [narrowUI() ? W - 10 : W - 70, 22]]) {
      ctx.beginPath(); ctx.ellipse(x, y + 8, r, r * 0.6, 0, Math.PI, 0); ctx.fill();
    }
    if (!narrowUI()) { pine(50, y + 50, 1.3); pine(96, y + 70, 1); pine(W - 46, y + 60, 1.4); }
    emo('🐐', narrowUI() ? W - 30 : W - 110, y + 62, narrowUI() ? 30 : 40);
    for (const [x, dy] of [[30, 84], [150, 70], [W - 150, 88], [TX0 + 30, 96], [TX1 - 40, 90]]) emo('🌼', x, y + dy, 20);
  }
  function mountainGate(yb) {
    mountainDoor(yb, true, 1.3);
    const w = doorW() * 1.3 + 8;
    ctx.fillStyle = '#7a4f2a';
    ctx.fillRect(TCX - w / 2 - 6, yb - DOOR_H * 1.3 + 10, 10, DOOR_H * 1.3 - 10);
    ctx.fillRect(TCX + w / 2 - 4, yb - DOOR_H * 1.3 + 10, 10, DOOR_H * 1.3 - 10);
    ctx.fillRect(TCX - w / 2 - 14, yb - DOOR_H * 1.3 + 2, w + 28, 12);
  }
  function mountainCrown(base) {
    const L = TX0 - eaveExt(30);
    const R = TX1 + eaveExt(30);
    const apexY = base - 200;
    const apexX = TCX + 8;
    const rockPath = () => {
      ctx.beginPath();
      ctx.moveTo(L - 10, base + 40);
      ctx.lineTo(L + 30, base - 30);
      ctx.lineTo(TCX - TW * 0.22, base - 90);
      ctx.lineTo(TCX - TW * 0.12, base - 120);
      ctx.lineTo(apexX, apexY);
      ctx.lineTo(TCX + TW * 0.16, base - 140);
      ctx.lineTo(TCX + TW * 0.3, base - 70);
      ctx.lineTo(R - 20, base - 20);
      ctx.lineTo(R + 10, base + 40);
      ctx.closePath();
    };
    rockPath();
    ctx.fillStyle = lgrad(L, 0, R, 0, [[0, theme.rock[2]], [0.45, theme.rock[0]], [1, theme.rock[2]]]);
    ctx.fill();
    ctx.save();
    rockPath();
    ctx.clip();
    ctx.fillStyle = 'rgba(20,25,35,0.16)';
    ctx.beginPath(); ctx.moveTo(apexX, apexY); ctx.lineTo(R + 20, base + 40); ctx.lineTo(TCX + 20, base + 40); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(L - 20, apexY - 10);
    ctx.lineTo(R + 20, apexY - 10);
    ctx.lineTo(R + 20, base - 118);
    for (let k = 0; k <= 14; k++) {
      const x = R + 20 - ((R - L + 40) * k) / 14;
      ctx.lineTo(x, base - 108 + (k % 2 ? 18 : 0) + hash(k + 3) * 10);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(170,200,230,0.45)';
    ctx.beginPath(); ctx.moveTo(apexX, apexY); ctx.lineTo(R + 20, base - 110); ctx.lineTo(TCX + 30, base - 100); ctx.closePath(); ctx.fill();
    ctx.restore();
    pole(apexX, apexY - 100, apexY + 6);
    flag(apexX, 0, topRaise(), '#e8453a', '#ffd23f', apexY - 44, apexY - 96);
    if (!narrowUI()) emo('🐐', TCX + TW * 0.34, base - 58, 40);
  }
  function mountainBackdrop() {
    const snow = (m, base) => {
      ctx.save();
      hillPath(m, 'peaks');
      ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(W, 0);
      for (let x = W; x >= 0; x -= 12) ctx.lineTo(x, base - m.amp * 0.62 + Math.sin(x * 0.07) * 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    hills([{ par: 0.08, base: 560, amp: 230, col: '#9fb2cf', seed: 0.7, a: 0.85 }], 'peaks', snow);
    hills([{ par: 0.18, base: 650, amp: 170, col: '#7d93b3', seed: 2.9 }], 'peaks', snow);
    hills([{ par: 0.32, base: 740, amp: 90, col: '#6f9f6a', seed: 5.5 }], 'trees');
  }

  // ======================= 5. TALL HOUSE =======================
  function houseStorey(f, yb, yt) {
    ctx.fillStyle = lgrad(TX0, 0, TX1, 0, [[0, theme.wall[1]], [0.5, theme.wall[0]], [1, theme.wall[1]]]);
    ctx.fillRect(TX0, yt, TW, yb - yt);
    ctx.fillStyle = 'rgba(0,0,0,0.045)';
    for (let y = yt + 8; y < yb; y += 18) ctx.fillRect(TX0, y, TW, 2);
    ctx.fillStyle = lgrad(0, yt, 0, yt + 80, [[0, 'rgba(60,40,20,0.25)'], [1, 'rgba(60,40,20,0)']]);
    ctx.fillRect(TX0, yt, TW, 80);
    // corner stones
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (let y = yt, k = 0; y < yb; y += 24, k++) {
      ctx.fillRect(TX0, y + 2, k % 2 ? 16 : 24, 20);
      ctx.fillRect(TX1 - (k % 2 ? 16 : 24), y + 2, k % 2 ? 16 : 24, 20);
    }
    const lit = f <= floor && f > 0;
    if (f > 0) sideSpots().forEach((wx) => {
      const ww = 54;
      const wh = 66;
      const y = yt + 96;
      ctx.fillStyle = '#ffffff';
      roundRect(wx - ww / 2 - 5, y - 5, ww + 10, wh + 10, 6); ctx.fill();
      ctx.fillStyle = lit ? lgrad(0, y, 0, y + wh, [[0, '#fff1b8'], [1, '#ffc25a']]) : lgrad(0, y, 0, y + wh, [[0, '#bfe3ff'], [1, '#7fb7e6']]);
      ctx.fillRect(wx - ww / 2, y, ww, wh);
      if (lit) glow(wx, y + wh / 2, 50, 'rgba(255,220,130,0.45)');
      ctx.fillStyle = theme.curtain;
      ctx.beginPath(); ctx.moveTo(wx - ww / 2, y); ctx.lineTo(wx - ww / 2 + 16, y); ctx.lineTo(wx - ww / 2, y + wh * 0.7); ctx.fill();
      ctx.beginPath(); ctx.moveTo(wx + ww / 2, y); ctx.lineTo(wx + ww / 2 - 16, y); ctx.lineTo(wx + ww / 2, y + wh * 0.7); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(wx - 2, y, 4, wh);
      ctx.fillRect(wx - ww / 2, y + wh * 0.45, ww, 4);
      // flower box
      ctx.fillStyle = theme.trim;
      ctx.fillRect(wx - ww / 2 - 6, y + wh + 5, ww + 12, 12);
      const cols = ['#ff5a7a', '#ffc53d', '#b28dff', '#ff8a3d'];
      for (let k = 0; k < 5; k++) { ctx.fillStyle = '#4f9a45'; disc(wx - 22 + k * 11, y + wh + 4, 5); ctx.fillStyle = cols[k % 4]; disc(wx - 22 + k * 11, y + wh + 1, 3.5); }
    });
    floorBadge(f, TX0 + 30, yt + 150);
  }
  function houseDoor(yb, lit, big = 1) {
    const w = doorW() * big;
    const h = DOOR_H * big;
    const x = TCX - w / 2;
    const y = yb - h;
    ctx.fillStyle = '#ffffff';
    roundRect(x - 7, y - 7, w + 14, h + 7, 8); ctx.fill();
    ctx.fillStyle = lgrad(x, 0, x + w, 0, [[0, theme.doorCol[1]], [0.5, theme.doorCol[0]], [1, theme.doorCol[1]]]);
    roundRect(x, y, w, h, 5); ctx.fill();
    ctx.fillStyle = lit ? '#ffe39a' : '#a9cde8';
    roundRect(x + w * 0.2, y + 10, w * 0.6, h * 0.26, 10); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + w * 0.18, y + h * 0.45, w * 0.64, h * 0.42);
    ctx.fillStyle = '#f2c14e';
    disc(x + w * 0.8, y + h * 0.56, 3.8);
    // porch lamp
    ctx.fillStyle = '#3b3b3b';
    ctx.fillRect(x + w + 12, y + 10, 4, 12);
    ctx.fillStyle = lit ? '#ffd766' : '#d7d2c4';
    roundRect(x + w + 7, y + 20, 14, 18, 4); ctx.fill();
    if (lit) glow(x + w + 14, y + 30, 34, 'rgba(255,220,120,0.65)');
  }
  function houseDeck(f, y, litA) {
    const ext = eaveExt(22);
    const L = TX0 - ext;
    const R = TX1 + ext;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(L, y, R - L, 14);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(L, y + 14, R - L, 4);
    ctx.fillStyle = theme.wall[1];
    ctx.fillRect(TX0, y + 18, TW, 12);
    // railing behind him
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(L + 4, y - 32, R - L - 8, 6);
    for (let x = L + 10; x < R - 6; x += 15) ctx.fillRect(x, y - 28, 5, 28);
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(L + 4, y - 26, R - L - 8, 2);
    for (const x of [L + 16, R - 16]) {
      ctx.fillStyle = '#c8643b';
      ctx.beginPath(); ctx.moveTo(x - 11, y - 20); ctx.lineTo(x + 11, y - 20); ctx.lineTo(x + 8, y); ctx.lineTo(x - 8, y); ctx.fill();
      ctx.fillStyle = '#4f9a45';
      disc(x - 6, y - 26, 9); disc(x + 6, y - 27, 9); disc(x, y - 35, 9);
    }
    if (litA > 0) {
      ctx.save();
      ctx.globalAlpha *= litA;
      for (let x = L + 20; x < R - 20; x += 22) {
        const py = y - 30 + 5 * Math.sin((x - L) * 0.143);
        glow(x, py + 4, 12, 'rgba(255,230,150,0.7)');
        ctx.fillStyle = '#ffe9a0';
        disc(x, py + 4, 3.2);
      }
      ctx.restore();
    }
  }
  function houseGround(y) {
    ctx.fillStyle = lgrad(0, y, 0, y + 120, [[0, '#8fd06a'], [1, '#5a9f4a']]);
    ctx.fillRect(0, y, W, H - y + 10);
    ctx.fillStyle = '#d9d6cf';
    ctx.fillRect(0, y, W, 26);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let x = 0; x < W; x += 44) ctx.fillRect(x, y, 2, 26);
    ctx.fillRect(0, y + 24, W, 3);
    ctx.fillStyle = '#b9b5ad';
    ctx.fillRect(TCX - doorW() * 0.8, y, doorW() * 1.6, 8);
    for (const x of [TX0 + 24, TX1 - 24]) {
      ctx.fillStyle = '#3f8a3a';
      disc(x - 14, y - 6, 16); disc(x + 12, y - 8, 18); disc(x, y - 18, 16);
    }
    if (!narrowUI()) {
      // street lamp + a round tree
      ctx.fillStyle = '#3b4250';
      ctx.fillRect(58, y - 150, 6, 160);
      ctx.fillRect(58, y - 150, 30, 5);
      ctx.fillStyle = '#ffe9a0';
      roundRect(80, y - 148, 16, 18, 5); ctx.fill();
      ctx.fillStyle = '#6b4423';
      ctx.fillRect(W - 76, y - 60, 12, 70);
      ctx.fillStyle = '#4f9a45'; disc(W - 70, y - 90, 44);
      ctx.fillStyle = '#6cbf4a'; disc(W - 84, y - 104, 22);
      // mailbox
      ctx.fillStyle = '#3b4250';
      ctx.fillRect(TX1 + 40, y - 40, 4, 44);
      ctx.fillStyle = '#e8453a';
      roundRect(TX1 + 28, y - 60, 30, 22, 8); ctx.fill();
    }
    emo('🐈', narrowUI() ? W - 26 : TX0 - 40, y + 60, narrowUI() ? 28 : 36);
  }
  function houseGate(yb) {
    houseDoor(yb, true, 1.2);
    const w = doorW() * 1.2 + 40;
    const y = yb - DOOR_H * 1.2 - 24;
    ctx.save();
    ctx.beginPath(); ctx.moveTo(TCX - w / 2, y + 20); ctx.lineTo(TCX + w / 2, y + 20); ctx.lineTo(TCX + w / 2 - 10, y); ctx.lineTo(TCX - w / 2 + 10, y); ctx.closePath();
    ctx.clip();
    for (let x = TCX - w / 2, k = 0; x < TCX + w / 2; x += 14, k++) { ctx.fillStyle = k % 2 ? '#ffffff' : theme.trim; ctx.fillRect(x, y, 14, 20); }
    ctx.restore();
  }
  function houseCrown(base) {
    const ext = eaveExt(34);
    const L = TX0 - ext;
    const R = TX1 + ext;
    const apex = base - Math.min(160, TW * 0.32);
    // chimney first (behind the roof)
    const cx = TCX + TW * 0.24;
    const cTop = lerp(base, apex, 0.62) - 40;
    ctx.fillStyle = '#b3533f';
    ctx.fillRect(cx - 16, cTop, 32, base - cTop);
    ctx.fillStyle = '#8a3f30';
    ctx.fillRect(cx - 20, cTop - 8, 40, 10);
    for (let k = 0; k < 4; k++) {
      const t = (time * 0.35 + k / 4) % 1;
      ctx.fillStyle = `rgba(240,240,245,${0.6 * (1 - t)})`;
      disc(cx + Math.sin(t * 6 + k) * 8 + t * 20, cTop - 16 - t * 90, 8 + t * 16);
    }
    ctx.beginPath(); ctx.moveTo(L, base + 6); ctx.lineTo(TCX, apex); ctx.lineTo(R, base + 6); ctx.closePath();
    ctx.fillStyle = theme.roof[0];
    ctx.fill();
    ctx.save();
    ctx.clip();
    for (let y = base, r = 0; y > apex - 20; y -= 16, r++) {
      ctx.fillStyle = r % 2 ? theme.roof[1] : theme.roof[0];
      for (let x = L - 20 + (r % 2) * 11; x < R + 20; x += 22) { ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI); ctx.fill(); }
    }
    ctx.restore();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(L - 6, base + 8); ctx.lineTo(TCX, apex - 4); ctx.lineTo(R + 6, base + 8); ctx.stroke();
    // round attic window
    const wy = lerp(base, apex, 0.42);
    const lit = floor >= FLOORS;
    ctx.fillStyle = '#ffffff'; disc(TCX, wy, 24);
    ctx.fillStyle = lit ? '#ffe39a' : '#a9cde8'; disc(TCX, wy, 19);
    if (lit) glow(TCX, wy, 50, 'rgba(255,220,130,0.5)');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(TCX - 19, wy - 2, 38, 4); ctx.fillRect(TCX - 2, wy - 19, 4, 38);
    pole(TCX, apex - 100, apex - 2);
    flag(TCX, 0, topRaise(), '#ffd23f', theme.trim, apex - 44, apex - 96);
    if (!narrowUI()) emo('🐈‍⬛', lerp(TCX, L, 0.55), lerp(apex, base, 0.55) - 2, 34);
  }
  function houseBackdrop() {
    city(1.3, 0.1, 600, 220, 'rgba(160,185,215,0.85)', false);
    city(4.7, 0.2, 690, 200, 'rgba(120,150,190,0.9)', true);
    hills([{ par: 0.34, base: 740, amp: 60, col: '#6fae63', seed: 3.3 }], 'trees');
  }

  // ======================= 6. LIGHTHOUSE =======================
  function lighthouseStorey(f, yb, yt) {
    const red = f % 2 === 0;
    const cols = red ? [theme.stripe[2], theme.stripe[0], theme.stripe[1], theme.stripe[2]] : ['#c6cbcf', '#ffffff', '#f0f0ea', '#bfc4c8'];
    ctx.fillStyle = lgrad(TX0, 0, TX1, 0, [[0, cols[0]], [0.35, cols[1]], [0.7, cols[2]], [1, cols[3]]]);
    ctx.fillRect(TX0, yt, TW, yb - yt);
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    for (let x = TX0 + 30; x < TX1; x += 60) ctx.fillRect(x, yt, 2, yb - yt);
    ctx.fillStyle = lgrad(0, yt, 0, yt + 70, [[0, 'rgba(0,0,0,0.22)'], [1, 'rgba(0,0,0,0)']]);
    ctx.fillRect(TX0, yt, TW, 70);
    const lit = f <= floor && f > 0;
    if (f > 0) sideSpots().forEach((wx) => {
      const y = yt + 130;
      ctx.fillStyle = '#c9a45a'; disc(wx, y, 27);
      ctx.fillStyle = '#8a6a2a'; disc(wx, y, 22);
      ctx.fillStyle = lit ? '#ffe08a' : lgrad(0, y - 20, 0, y + 20, [[0, '#7fb7e6'], [1, '#2f5f96']]);
      disc(wx, y, 19);
      if (lit) glow(wx, y, 46, 'rgba(255,220,120,0.5)');
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.ellipse(wx - 7, y - 7, 5, 8, -0.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8a6a2a';
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; disc(wx + Math.cos(a) * 24.5, y + Math.sin(a) * 24.5, 1.6); }
    });
    floorBadge(f, TX0 + 24, yt + 150);
  }
  function lighthouseDoor(yb, lit, big = 1) {
    const w = doorW() * big;
    const h = DOOR_H * big;
    ctx.fillStyle = '#9aa0a6';
    roundDoor(TCX, yb, w + 16, h + 8); ctx.fill();
    ctx.fillStyle = lgrad(TCX - w / 2, 0, TCX + w / 2, 0, [[0, '#5a3a1e'], [0.5, '#8a5c33'], [1, '#5a3a1e']]);
    roundDoor(TCX, yb, w, h); ctx.fill();
    ctx.fillStyle = '#2f2f35';
    ctx.fillRect(TCX - w / 2, yb - h * 0.72, w, 5);
    ctx.fillRect(TCX - w / 2, yb - h * 0.3, w, 5);
    ctx.fillStyle = '#f2c14e';
    disc(TCX + w * 0.3, yb - h * 0.5, 4);
    ctx.fillStyle = lit ? '#ffe08a' : '#5b6b7b';
    disc(TCX, yb - h + w * 0.42, w * 0.14);
    if (lit) glow(TCX, yb - h + w * 0.42, w * 0.5, 'rgba(255,220,120,0.6)');
  }
  function gallery(y, ext, litA) {
    const L = TX0 - ext;
    const R = TX1 + ext;
    ctx.strokeStyle = '#2b3440';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(L + 4, y - 30); ctx.lineTo(R - 4, y - 30);
    ctx.moveTo(L + 4, y - 16); ctx.lineTo(R - 4, y - 16);
    for (let x = L + 6; x < R - 2; x += 12) { ctx.moveTo(x, y - 30); ctx.lineTo(x, y); }
    ctx.stroke();
    ctx.fillStyle = '#2b3440';
    ctx.fillRect(L + 2, y - 33, R - L - 4, 4);
    ctx.fillStyle = lgrad(0, y, 0, y + 12, [[0, '#56606e'], [1, '#2b3440']]);
    ctx.fillRect(L, y, R - L, 12);
    ctx.fillStyle = '#2b3440';
    for (let x = TX0 + 10; x < TX1; x += 44) { ctx.beginPath(); ctx.moveTo(x - 8, y + 12); ctx.lineTo(x + 8, y + 12); ctx.lineTo(x, y + 34); ctx.fill(); }
    if (litA > 0) {
      ctx.save();
      ctx.globalAlpha *= litA;
      for (const x of [L + 12, R - 12]) { glow(x, y - 40, 26, 'rgba(255,230,150,0.7)'); ctx.fillStyle = '#ffe9a0'; disc(x, y - 40, 5); }
      ctx.restore();
    }
  }
  function lighthouseDeck(f, y, litA) { gallery(y, eaveExt(26), litA); }
  function waves(y, x0, x1) {
    ctx.fillStyle = lgrad(0, y, 0, H, [[0, '#4fa3d6'], [1, '#2c6fa3']]);
    ctx.fillRect(x0, y, x1 - x0, H - y);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (let r = 0; r < 3; r++) {
      const yy = y + 8 + r * 26;
      ctx.beginPath();
      ctx.moveTo(x0, yy + 6);
      for (let x = x0; x <= x1; x += 10) ctx.lineTo(x, yy + Math.sin(x * 0.06 + time * 2 + r) * 3);
      ctx.lineTo(x1, yy + 6);
      ctx.closePath();
      ctx.fill();
    }
  }
  function lighthouseGround(y) {
    waves(y + 20, 0, W);
    ctx.fillStyle = '#e8d6a8';
    ctx.beginPath(); ctx.moveTo(TX0 - 110, y + 70); ctx.quadraticCurveTo(TCX, y - 10, TX1 + 110, y + 70); ctx.closePath(); ctx.fill();
    ctx.fillStyle = lgrad(0, y - 20, 0, y + 50, [[0, '#9aa3ad'], [1, '#5f6973']]);
    for (let k = 0; k < 9; k++) {
      const x = TX0 - 50 + k * ((TW + 100) / 8);
      ctx.beginPath(); ctx.ellipse(x, y + 16 + (k % 2) * 8, 34, 22, 0, Math.PI, 0); ctx.fill();
    }
    ctx.fillStyle = '#6f7983';
    ctx.fillRect(TX0 - 20, y - 2, TW + 40, 12);
    if (!narrowUI()) {
      // a little sailboat
      const bx = 90 + Math.sin(time * 0.5) * 10;
      const by = y + 48 + Math.sin(time * 2) * 2;
      ctx.fillStyle = '#8a4a2a';
      ctx.beginPath(); ctx.moveTo(bx - 28, by); ctx.lineTo(bx + 28, by); ctx.lineTo(bx + 18, by + 12); ctx.lineTo(bx - 18, by + 12); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.moveTo(bx, by - 2); ctx.lineTo(bx, by - 52); ctx.lineTo(bx + 26, by - 6); ctx.fill();
      ctx.fillStyle = theme.stripe[0];
      ctx.beginPath(); ctx.moveTo(bx - 3, by - 2); ctx.lineTo(bx - 3, by - 40); ctx.lineTo(bx - 20, by - 6); ctx.fill();
      emo('🦀', W - 80, y + 44, 30);
    }
  }
  function lighthouseGate(yb) { lighthouseDoor(yb, true, 1.3); }
  function lighthouseCrown(base) {
    const lit = floor >= FLOORS ? clamp(topT, 0, 1) : 0;
    const rw = Math.min(170, TW * 0.44);
    const top = base - 100;
    // beams sweep round once he is at the top
    if (lit > 0) {
      const c = Math.cos(time * 1.4);
      for (const d of [1, -1]) {
        const a = Math.max(0, c * d) * lit;
        if (a <= 0.01) continue;
        ctx.save();
        ctx.globalAlpha = a * 0.55;
        ctx.fillStyle = lgrad(TCX, 0, TCX + d * W, 0, [[0, 'rgba(255,245,190,0.95)'], [1, 'rgba(255,245,190,0)']]);
        ctx.beginPath(); ctx.moveTo(TCX, top + 46); ctx.lineTo(TCX + d * W, top - 60); ctx.lineTo(TCX + d * W, top + 150); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
    gallery(base, eaveExt(30), lit);
    ctx.fillStyle = '#2b3440';
    ctx.fillRect(TCX - rw / 2 - 6, top + 86, rw + 12, 14);
    ctx.fillStyle = lit ? `rgba(255,236,160,${0.55 + 0.4 * lit})` : 'rgba(170,210,240,0.55)';
    ctx.fillRect(TCX - rw / 2, top, rw, 86);
    if (lit) glow(TCX, top + 46, 90, 'rgba(255,240,170,0.9)', lit);
    ctx.fillStyle = lit ? '#fff6c9' : '#e2c45a';
    disc(TCX, top + 46, 20);
    ctx.fillStyle = '#2b3440';
    for (let k = 0; k <= 4; k++) ctx.fillRect(TCX - rw / 2 + (rw * k) / 4 - 2, top, 4, 86);
    ctx.fillRect(TCX - rw / 2, top + 40, rw, 3);
    ctx.fillStyle = lgrad(TCX - rw / 2, 0, TCX + rw / 2, 0, [[0, theme.stripe[2]], [0.4, theme.stripe[0]], [1, theme.stripe[2]]]);
    ctx.beginPath(); ctx.moveTo(TCX - rw / 2 - 12, top + 2); ctx.quadraticCurveTo(TCX, top - 88, TCX + rw / 2 + 12, top + 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2b3440';
    ctx.fillRect(TCX - rw / 2 - 14, top - 2, rw + 28, 6);
    pole(TCX, top - 110, top - 40);
    flag(TCX, 0, topRaise(), '#ffffff', theme.stripe[0], top - 62, top - 108);
  }
  function lighthouseBackdrop() {
    const hz = 590 + (H - 760) + cam * FH * 0.12;
    hills([{ par: 0.12, base: 590, amp: 90, col: '#8fa3bf', seed: 4.4, a: 0.9 }], 'smooth');
    seaBand(hz, '#6fb4de', '#2f6fa8');
    if (hz < H) {
      for (let k = 0; k < 3; k++) {
        const x = ((hash(k + 5) * W + time * (8 + k * 3)) % (W + 60)) - 30;
        const y = hz + 16 + k * 22;
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 22 + k * 3); ctx.lineTo(x + 14, y); ctx.fill();
        ctx.fillStyle = 'rgba(80,60,50,0.8)';
        ctx.fillRect(x - 10, y, 26, 4);
      }
    }
  }

  // ======================= 7. BEANSTALK =======================
  function vine(yt, yb, phase, amp, width) {
    ctx.beginPath();
    for (let y = yt - 20; y <= yb + 20; y += 8) ctx.lineTo(TCX + amp * Math.sin(worldY(y) * 0.011 + phase), y);
  }
  function beanStorey(f, yb, yt) {
    const amp = TW * 0.3;
    for (let k = 0; k < 3; k++) {
      const ph = k * 2.1;
      vine(yt, yb, ph, amp);
      ctx.lineWidth = 30; ctx.strokeStyle = '#2f7d32'; ctx.lineCap = 'round'; ctx.stroke();
      vine(yt, yb, ph, amp);
      ctx.lineWidth = 16; ctx.strokeStyle = '#4caf50'; ctx.stroke();
      vine(yt, yb, ph + 0.05, amp);
      ctx.lineWidth = 4; ctx.strokeStyle = '#9be07a'; ctx.stroke();
      ctx.lineCap = 'butt';
      // heart-shaped leaves along the vine
      const wy0 = Math.ceil(worldY(yt) / 60) * 60;
      for (let wy = wy0; wy <= worldY(yb); wy += 60) {
        const y = wy + camOff();
        const x = TCX + amp * Math.sin(wy * 0.011 + ph);
        const d = Math.round(wy / 60 + k) % 2 ? 1 : -1;
        ctx.save();
        ctx.translate(x + d * 12, y);
        ctx.rotate(d * 0.9);
        ctx.fillStyle = '#5cbf4f';
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(-16, -8, -12, -30, 0, -26); ctx.bezierCurveTo(12, -30, 16, -8, 0, 0); ctx.fill();
        ctx.strokeStyle = '#2f7d32'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(0, -2); ctx.lineTo(0, -22); ctx.stroke();
        ctx.restore();
      }
    }
    const lit = f <= floor && f > 0;
    if (lit) {
      for (let k = 0; k < 4; k++) {
        const wy = worldY(yt) + 60 + k * 44;
        const x = TCX + amp * Math.sin(wy * 0.011 + (k % 3) * 2.1);
        const y = wy + camOff();
        glow(x, y, 20 + Math.sin(time * 3 + k) * 3, 'rgba(255,240,150,0.7)');
        ctx.fillStyle = '#ffd23f';
        for (let p = 0; p < 5; p++) { const a = (p / 5) * Math.PI * 2; disc(x + Math.cos(a) * 5, y + Math.sin(a) * 5, 4); }
        ctx.fillStyle = '#ff9f1c'; disc(x, y, 3);
      }
    }
    floorBadge(f, TX0 + 18, yt + 150);
  }
  function bigLeaf(x, yb, w, h) {
    ctx.fillStyle = lgrad(x - w / 2, 0, x + w / 2, 0, [[0, '#3f9d3f'], [0.5, '#7ed36a'], [1, '#3f9d3f']]);
    ctx.beginPath();
    ctx.moveTo(x, yb);
    ctx.bezierCurveTo(x - w * 0.75, yb - h * 0.25, x - w * 0.55, yb - h * 0.95, x, yb - h);
    ctx.bezierCurveTo(x + w * 0.55, yb - h * 0.95, x + w * 0.75, yb - h * 0.25, x, yb);
    ctx.fill();
    ctx.strokeStyle = '#2f7d32';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x, yb); ctx.lineTo(x, yb - h * 0.92); ctx.stroke();
    ctx.lineWidth = 1.5;
    for (let k = 1; k < 5; k++) {
      const yy = yb - (h * k) / 5.5;
      ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x - w * 0.3, yy - 14); ctx.moveTo(x, yy); ctx.lineTo(x + w * 0.3, yy - 14); ctx.stroke();
    }
  }
  function beanDoor(yb, lit, big = 1) {
    bigLeaf(TCX, yb, doorW() * 1.35 * big, (DOOR_H + 10) * big);
    if (lit) glow(TCX, yb - DOOR_H * 0.55 * big, 40 * big, 'rgba(255,240,150,0.45)');
  }
  function beanDeck(f, y, litA) {
    const ext = eaveExt(46);
    const L = TX0 - ext;
    const R = TX1 + ext;
    ctx.fillStyle = lgrad(0, y + 12, 0, y + 30, [[0, '#4caf50'], [1, '#2f7d32']]);
    roundRect(L + 26, y + 12, R - L - 52, 16, 8); ctx.fill();
    ctx.fillStyle = lgrad(0, y - 4, 0, y + 26, [[0, '#8fe07a'], [0.5, '#5cbf4f'], [1, '#3f9d3f']]);
    ctx.beginPath();
    ctx.moveTo(L, y - 6);
    ctx.quadraticCurveTo(L + 20, y, L + 50, y);
    ctx.lineTo(R - 50, y);
    ctx.quadraticCurveTo(R - 20, y, R, y - 6);
    ctx.quadraticCurveTo(R - 30, y + 30, TCX, y + 26);
    ctx.quadraticCurveTo(L + 30, y + 30, L, y - 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(40,110,40,0.7)';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(L + 10, y + 4); ctx.quadraticCurveTo(TCX, y + 16, R - 10, y + 4); ctx.stroke();
    ctx.lineWidth = 1.5;
    for (let x = L + 40; x < R - 30; x += 34) { ctx.beginPath(); ctx.moveTo(x, y + 10); ctx.lineTo(x + 16, y + 1); ctx.moveTo(x, y + 10); ctx.lineTo(x + 14, y + 20); ctx.stroke(); }
    if (litA > 0) {
      ctx.save();
      ctx.globalAlpha *= litA;
      for (let k = 0; k < 6; k++) {
        const x = lerp(L + 30, R - 30, (k + 0.5) / 6);
        const tw = 0.5 + 0.5 * Math.sin(time * 4 + k * 1.7);
        ctx.globalAlpha = litA * tw;
        glow(x, y + 8, 12, 'rgba(255,255,255,0.9)');
      }
      ctx.restore();
    }
  }
  function beanGround(y) {
    ctx.fillStyle = lgrad(0, y, 0, y + 120, [[0, '#9ad06a'], [1, '#62a34a']]);
    ctx.fillRect(0, y, W, H - y + 10);
    ctx.fillStyle = '#7a5230';
    ctx.beginPath(); ctx.ellipse(TCX, y + 6, TW * 0.36, 18, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#5a3a1e';
    for (let k = 0; k < 8; k++) disc(TCX - TW * 0.3 + k * TW * 0.086, y + 4 + (k % 2) * 4, 5);
    // fence
    ctx.fillStyle = '#e8d6b0';
    ctx.fillRect(0, y + 44, W, 6);
    ctx.fillRect(0, y + 60, W, 6);
    for (let x = 8; x < W; x += 30) { ctx.fillRect(x, y + 34, 8, 44); ctx.beginPath(); ctx.moveTo(x, y + 34); ctx.lineTo(x + 4, y + 28); ctx.lineTo(x + 8, y + 34); ctx.fill(); }
    if (!narrowUI()) {
      // a little cottage
      const cx = 86;
      ctx.fillStyle = '#f3e2c0'; ctx.fillRect(cx - 40, y - 56, 80, 56);
      ctx.fillStyle = '#c99a4a';
      ctx.beginPath(); ctx.moveTo(cx - 52, y - 52); ctx.lineTo(cx, y - 100); ctx.lineTo(cx + 52, y - 52); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#8a5c33'; ctx.fillRect(cx - 10, y - 32, 20, 32);
      ctx.fillStyle = '#a9cde8'; ctx.fillRect(cx + 16, y - 40, 16, 14); ctx.fillRect(cx - 32, y - 40, 16, 14);
      emo('🐄', W - 90, y + 30, 46);
    }
    emo('🐔', narrowUI() ? W - 24 : TX1 + 40, y + 96, 28);
  }
  function beanGate(yb) {
    ctx.fillStyle = '#2f7d32';
    ctx.beginPath(); ctx.moveTo(TCX - 70, yb); ctx.quadraticCurveTo(TCX - 30, yb - 40, TCX - 20, yb - 140); ctx.lineTo(TCX + 20, yb - 140); ctx.quadraticCurveTo(TCX + 30, yb - 40, TCX + 70, yb); ctx.closePath(); ctx.fill();
    beanDoor(yb, true, 1.3);
  }
  function puffyCloud(cx, cy, w, h, shade) {
    const n = Math.max(5, Math.round(w / 90));
    const puffs = [];
    for (let k = 0; k < n; k++) {
      const u = (k + 0.5) / n;
      const edge = Math.sin(Math.PI * u); // bigger in the middle
      const r = h * (0.45 + 0.5 * edge) * (0.85 + 0.3 * hash(k + 7));
      puffs.push([cx - w / 2 + w * u + (hash(k + 2) - 0.5) * 20, cy - r * 0.45, r]);
    }
    for (const [col, dy] of [[shade, 10], ['#ffffff', 0]]) {
      ctx.fillStyle = col;
      roundRect(cx - w / 2 - h * 0.2, cy - h * 0.15 + dy, w + h * 0.4, h * 0.6, h * 0.3); ctx.fill();
      for (const [x, y, r] of puffs) disc(x, y + dy, r);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (const [x, y, r] of puffs) disc(x - r * 0.25, y - r * 0.3, r * 0.35);
  }
  function beanCrown(base) {
    const cw = TW + 2 * eaveExt(70);
    // a little golden castle sitting on a cloud
    const kw = Math.min(120, TW * 0.3);
    const ky = base - 34;
    const gold = lgrad(0, ky - 90, 0, ky, [[0, '#ffe38a'], [1, '#e8b93f']]);
    for (const d of [-1, 1]) {
      const tx = TCX + d * (kw / 2 + 18);
      ctx.fillStyle = gold;
      ctx.fillRect(tx - 18, ky - 110, 36, 110);
      ctx.fillStyle = d < 0 ? '#5aa0e0' : '#e8453a';
      ctx.beginPath(); ctx.moveTo(tx - 24, ky - 108); ctx.lineTo(tx, ky - 156); ctx.lineTo(tx + 24, ky - 108); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#b8860b';
      ctx.fillRect(tx - 5, ky - 80, 10, 16);
    }
    ctx.fillStyle = gold;
    ctx.fillRect(TCX - kw / 2, ky - 84, kw, 84);
    for (let x = TCX - kw / 2; x < TCX + kw / 2 - 4; x += 20) ctx.fillRect(x, ky - 96, 12, 14);
    ctx.fillStyle = '#b8860b';
    ctx.beginPath(); ctx.moveTo(TCX - 16, ky); ctx.lineTo(TCX - 16, ky - 30); ctx.arc(TCX, ky - 30, 16, Math.PI, 0); ctx.lineTo(TCX + 16, ky); ctx.fill();
    const lit = floor >= FLOORS;
    ctx.fillStyle = lit ? '#fff6c9' : '#c89a2a';
    disc(TCX, ky - 60, 9);
    if (lit) glow(TCX, ky - 60, 30, 'rgba(255,240,170,0.8)');
    pole(TCX, ky - 190, ky - 96);
    flag(TCX, 0, topRaise(), '#e8453a', '#ffe38a', ky - 136, ky - 186);
    puffyCloud(TCX, base + 14, cw, 50, '#cfe3f5');
  }
  function beanBackdrop() {
    hills([
      { par: 0.1, base: 590, amp: 110, col: '#b3d7a0', seed: 2.4, a: 0.85 },
      { par: 0.2, base: 670, amp: 90, col: '#d9cf7a', seed: 5.3, a: 0.95 },
      { par: 0.34, base: 745, amp: 70, col: '#7fbf5a', seed: 8.8 },
    ], 'smooth', (m, base) => {
      if (m.par < 0.15) return;
      ctx.save();
      hillPath(m, 'smooth');
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 3;
      for (let x = -40; x < W + 40; x += 26) { ctx.beginPath(); ctx.moveTo(x, base - m.amp); ctx.lineTo(x + 40, H); ctx.stroke(); }
      ctx.restore();
    });
  }

  // ======================= 8. ROCKET TOWER =======================
  function rocketStorey(f, yb, yt) {
    ctx.fillStyle = lgrad(0, yt, 0, yb, [[0, '#262c4a'], [1, '#353d63']]);
    ctx.fillRect(TX0, yt, TW, yb - yt);
    ctx.strokeStyle = 'rgba(120,135,180,0.35)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(TX0 + 20, yt + 40); ctx.lineTo(TCX, yb - 10); ctx.lineTo(TX1 - 20, yt + 40);
    ctx.moveTo(TX0 + 20, yb - 10); ctx.lineTo(TCX, yt + 40); ctx.lineTo(TX1 - 20, yb - 10);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let y = yt + 46; y < yb; y += 46) ctx.fillRect(TX0, y, TW, 2);
    for (const x of [TX0, TX1 - 22]) {
      ctx.fillStyle = lgrad(x, 0, x + 22, 0, [[0, '#9c3a1a'], [0.4, '#e8653a'], [1, '#9c3a1a']]);
      ctx.fillRect(x, yt, 22, yb - yt);
      ctx.strokeStyle = 'rgba(60,20,10,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let y = yt; y < yb; y += 22) { ctx.moveTo(x + 3, y); ctx.lineTo(x + 19, y + 11); ctx.lineTo(x + 3, y + 22); }
      ctx.stroke();
      const on = Math.sin(time * 3 + f + x) > 0.3;
      ctx.fillStyle = on ? '#ff4d4d' : '#6b2020';
      disc(x + 11, yt + 96, 5);
      if (on) glow(x + 11, yt + 96, 18, 'rgba(255,90,90,0.7)');
    }
    const lit = f <= floor && f > 0;
    if (f > 0) sideSpots().forEach((wx, i) => {
      const y = yt + 100;
      ctx.fillStyle = '#8e97ad';
      roundRect(wx - 32, y - 4, 64, 54, 8); ctx.fill();
      ctx.fillStyle = lit ? '#0e3b4f' : '#11162a';
      roundRect(wx - 27, y + 1, 54, 44, 5); ctx.fill();
      if (lit) {
        glow(wx, y + 23, 46, 'rgba(110,230,255,0.35)');
        ctx.strokeStyle = '#7fe6ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let x = -22; x <= 22; x += 4) ctx.lineTo(wx + x, y + 30 - Math.abs(Math.sin((x + time * 20 + i * 9) * 0.25)) * 12);
        ctx.stroke();
        ctx.fillStyle = '#7dff9b'; disc(wx + 18, y + 10, 3);
      }
    });
    floorBadge(f, TX0 + 11, yt + 150);
  }
  function rocketDoor(yb, lit, big = 1) {
    const w = doorW() * big;
    const h = DOOR_H * big;
    const x = TCX - w / 2;
    const y = yb - h;
    ctx.fillStyle = '#8e97ad';
    roundRect(x - 8, y - 8, w + 16, h + 8, 6); ctx.fill();
    ctx.fillStyle = lgrad(x, 0, x + w, 0, [[0, '#b7bfcf'], [0.5, '#e7ebf2'], [1, '#aab2c2']]);
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#6d7689';
    ctx.fillRect(TCX - 1.5, y, 3, h);
    ctx.fillStyle = 'rgba(40,50,70,0.2)';
    ctx.fillRect(x + 6, y + h * 0.35, w / 2 - 10, 4); ctx.fillRect(TCX + 4, y + h * 0.35, w / 2 - 10, 4);
    ctx.fillStyle = lit ? '#7dff9b' : '#3b4a3f';
    ctx.beginPath(); ctx.moveTo(TCX - 8, y - 12); ctx.lineTo(TCX, y - 22); ctx.lineTo(TCX + 8, y - 12); ctx.fill();
    if (lit) glow(TCX, y - 16, 20, 'rgba(125,255,155,0.6)');
    ctx.fillStyle = '#2b3048';
    roundRect(x + w + 12, y + h * 0.4, 12, 22, 3); ctx.fill();
    ctx.fillStyle = lit ? '#ffd23f' : '#6b6f80';
    disc(x + w + 18, y + h * 0.4 + 7, 3); disc(x + w + 18, y + h * 0.4 + 15, 3);
  }
  function truss(y, ext, litA) {
    const L = TX0 - ext;
    const R = TX1 + ext;
    ctx.fillStyle = '#e8653a';
    ctx.fillRect(L, y + 8, R - L, 8);
    ctx.fillRect(L + 10, y + 34, R - L - 20, 6);
    ctx.strokeStyle = '#c4502a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let x = L + 10, k = 0; x < R - 20; x += 24, k++) { ctx.moveTo(x, y + 16); ctx.lineTo(x + 12, y + 34); ctx.lineTo(x + 24, y + 16); }
    ctx.stroke();
    ctx.save();
    ctx.beginPath(); ctx.rect(L, y, R - L, 8); ctx.clip();
    ctx.fillStyle = '#ffcc1f'; ctx.fillRect(L, y, R - L, 8);
    ctx.fillStyle = '#26262e';
    for (let x = L - 8; x < R; x += 16) { ctx.beginPath(); ctx.moveTo(x, y + 8); ctx.lineTo(x + 8, y + 8); ctx.lineTo(x + 16, y); ctx.lineTo(x + 8, y); ctx.fill(); }
    ctx.restore();
    if (litA > 0) {
      ctx.save();
      ctx.globalAlpha *= litA;
      for (let x = L + 16; x < R - 10; x += 60) { glow(x, y + 44, 16, 'rgba(160,240,255,0.8)'); ctx.fillStyle = '#dff9ff'; disc(x, y + 44, 3.5); }
      ctx.restore();
    }
  }
  function rocketDeck(f, y, litA) { truss(y, eaveExt(30), litA); }
  function rocketGround(y) {
    ctx.fillStyle = lgrad(0, y, 0, y + 120, [[0, '#4a3f5e'], [1, '#2c2540']]);
    ctx.fillRect(0, y, W, H - y + 10);
    const L = Math.max(0, TX0 - 70);
    const R = Math.min(W, TX1 + 70);
    ctx.fillStyle = lgrad(0, y, 0, y + 36, [[0, '#b9bccb'], [1, '#7e8296']]);
    ctx.fillRect(L, y, R - L, 36);
    ctx.fillStyle = '#ffcc1f';
    for (let x = L + 12; x < R - 20; x += 40) ctx.fillRect(x, y + 16, 22, 4);
    // searchlights
    for (const d of [-1, 1]) {
      const a = Math.sin(time * 0.6 + d) * 0.35 - Math.PI / 2 + d * 0.35;
      const bx = d < 0 ? 20 : W - 20;
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = '#e8f2ff';
      ctx.beginPath(); ctx.moveTo(bx, y); ctx.lineTo(bx + Math.cos(a - 0.06) * 900, y + Math.sin(a - 0.06) * 900); ctx.lineTo(bx + Math.cos(a + 0.06) * 900, y + Math.sin(a + 0.06) * 900); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    if (!narrowUI()) {
      for (const x of [70, W - 70]) {
        ctx.fillStyle = '#8e97ad';
        ctx.fillRect(x - 24, y - 16, 4, 20); ctx.fillRect(x + 20, y - 16, 4, 20);
        ctx.fillStyle = lgrad(x - 30, 0, x + 30, 0, [[0, '#c9cfdc'], [0.4, '#ffffff'], [1, '#aab2c2']]);
        disc(x, y - 44, 32);
      }
      emo('🌵', 140, y + 70, 40);
    }
    emo('🌵', narrowUI() ? W - 20 : W - 150, y + 80, narrowUI() ? 28 : 34);
  }
  function rocketGate(yb) {
    rocketDoor(yb, true, 1.2);
    const w = doorW() * 1.2 + 16;
    const h = DOOR_H * 1.2 + 8;
    ctx.save();
    ctx.beginPath(); ctx.rect(TCX - w / 2 - 8, yb - h - 8, w + 16, 8); ctx.clip();
    ctx.fillStyle = '#ffcc1f'; ctx.fillRect(TCX - w / 2 - 8, yb - h - 8, w + 16, 8);
    ctx.fillStyle = '#26262e';
    for (let x = TCX - w / 2 - 16; x < TCX + w / 2 + 8; x += 16) { ctx.beginPath(); ctx.moveTo(x, yb - h); ctx.lineTo(x + 8, yb - h); ctx.lineTo(x + 16, yb - h - 8); ctx.lineTo(x + 8, yb - h - 8); ctx.fill(); }
    ctx.restore();
  }
  function rocketCrown(base) {
    truss(base, eaveExt(30), floor >= FLOORS ? 1 : 0);
    const rw = Math.min(84, TW * 0.2);
    const rh = 210;
    const launch = floor >= FLOORS ? Math.max(0, topT - 1.3) : 0;
    const lift = launch * launch * 170;
    const bx = TCX;
    const by = base - 6 - lift;
    // exhaust + smoke
    if (launch > 0) {
      for (let k = 0; k < 10; k++) {
        const t = (time * 1.6 + k / 10) % 1;
        ctx.fillStyle = `rgba(235,235,245,${0.55 * (1 - t)})`;
        disc(bx + (hash(k) - 0.5) * 30 + (k % 2 ? 1 : -1) * t * 90, base - 4 - t * 20, 16 + t * 30);
      }
      const fl = 36 + Math.sin(time * 30) * 6 + Math.min(60, launch * 60);
      glow(bx, by + 20, 70, 'rgba(255,190,90,0.8)');
      ctx.fillStyle = '#ff7a1a';
      ctx.beginPath(); ctx.moveTo(bx - rw * 0.3, by); ctx.quadraticCurveTo(bx, by + fl * 1.6, bx + rw * 0.3, by); ctx.fill();
      ctx.fillStyle = '#ffe38a';
      ctx.beginPath(); ctx.moveTo(bx - rw * 0.16, by); ctx.quadraticCurveTo(bx, by + fl, bx + rw * 0.16, by); ctx.fill();
    }
    ctx.save();
    ctx.translate(bx, by);
    // fins
    ctx.fillStyle = '#d8342a';
    for (const d of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(d * rw / 2, -70); ctx.quadraticCurveTo(d * (rw / 2 + 30), -30, d * (rw / 2 + 26), 0); ctx.lineTo(d * rw / 2, -8); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = '#3b3f52';
    ctx.fillRect(-rw * 0.3, -8, rw * 0.6, 10);
    ctx.fillStyle = lgrad(-rw / 2, 0, rw / 2, 0, [[0, '#c9cfdc'], [0.4, '#ffffff'], [1, '#aab2c2']]);
    ctx.beginPath();
    ctx.moveTo(-rw / 2, -8);
    ctx.lineTo(-rw / 2, -rh * 0.62);
    ctx.quadraticCurveTo(-rw / 2, -rh * 0.9, 0, -rh);
    ctx.quadraticCurveTo(rw / 2, -rh * 0.9, rw / 2, -rh * 0.62);
    ctx.lineTo(rw / 2, -8);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = '#d8342a';
    ctx.fillRect(-rw, -rh, rw * 2, rh * 0.26);
    ctx.fillRect(-rw, -rh * 0.36, rw * 2, 8);
    ctx.restore();
    ctx.fillStyle = '#8e97ad'; disc(0, -rh * 0.56, rw * 0.24);
    ctx.fillStyle = floor >= FLOORS ? '#9fe8ff' : '#4a86c5'; disc(0, -rh * 0.56, rw * 0.18);
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; disc(-rw * 0.06, -rh * 0.58, rw * 0.06);
    ctx.fillStyle = '#d8342a';
    ctx.font = `900 ${Math.round(rw * 0.2)}px ${UI_FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('★', 0, -rh * 0.24);
    ctx.restore();
  }
  function rocketBackdrop() {
    const hz = 620 + (H - 760) + cam * FH * 0.12;
    if (hz - 160 < H) {
      ctx.fillStyle = lgrad(0, hz - 160, 0, hz, [[0, 'rgba(255,120,160,0)'], [1, 'rgba(255,150,120,0.35)']]);
      ctx.fillRect(0, hz - 160, W, 160);
    }
    hills([
      { par: 0.1, base: 630, amp: 150, col: '#3a2f5c', seed: 1.9 },
      { par: 0.22, base: 700, amp: 110, col: '#2a2247', seed: 6.3 },
    ], 'mesa');
    // a ringed planet high up
    const px = Math.min(W * 0.1, TX0 * 0.5) + 30;
    const py = 250 + cam * FH * 0.03;
    if (py < H + 60) {
      ctx.fillStyle = lgrad(px - 30, py - 30, px + 30, py + 30, [[0, '#ffd08a'], [1, '#d97a4a']]);
      disc(px, py, 28);
      ctx.strokeStyle = 'rgba(255,230,190,0.8)';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(px, py, 48, 12, -0.35, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // ======================= The list =======================
  const T_SKY = {
    temple: [[[0, '#3c9be6'], [0.45, '#5f8fd6'], [0.75, '#6a5fb0'], [1, '#232a66']], [[0, '#a6dcf8'], [0.45, '#f7d6a6'], [0.75, '#f0a080'], [1, '#6a4b92']], [[0, '#f2fbff'], [0.45, '#fff0cc'], [0.75, '#ffc89a'], [1, '#e7897c']]],
    tree: [[[0, '#79c7ef'], [0.45, '#86b8e6'], [0.75, '#6e6fb8'], [1, '#26305e']], [[0, '#c7ecf7'], [0.45, '#f8dcb0'], [0.75, '#f0a78a'], [1, '#6d5098']], [[0, '#f3fde8'], [0.45, '#fff2d0'], [0.75, '#ffcf9a'], [1, '#e8907e']]],
    mountain: [[[0, '#3f8ede'], [0.5, '#3a6cc0'], [0.8, '#2a3c86'], [1, '#101a44']], [[0, '#a9d3f5'], [0.5, '#bcd2f0'], [0.8, '#c29ad0'], [1, '#553f86']], [[0, '#eaf6ff'], [0.5, '#f4f0ff'], [0.8, '#ffc6b0'], [1, '#d9808a']]],
    house: [[[0, '#7cc0f0'], [0.45, '#8ab0e8'], [0.75, '#7a64b8'], [1, '#262a60']], [[0, '#c6e8fb'], [0.45, '#ffd3b0'], [0.75, '#f59a88'], [1, '#6f4b95']], [[0, '#f1fbff'], [0.45, '#ffe9c8'], [0.75, '#ffbf8e'], [1, '#e5857c']]],
    lighthouse: [[[0, '#5b8fd6'], [0.4, '#5a6cb8'], [0.75, '#2c3478'], [1, '#0e1440']], [[0, '#f4c3b0'], [0.4, '#e89a90'], [0.75, '#7a5aa0'], [1, '#2b2a66']], [[0, '#ffe2b0'], [0.4, '#ffb98a'], [0.75, '#e0857c'], [1, '#6a4b8a']]],
    bean: [[[0, '#4fb0f2'], [0.5, '#5aa0ee'], [0.8, '#7b7fe0'], [1, '#4a4aa8']], [[0, '#bfe6ff'], [0.5, '#d2e8ff'], [0.8, '#e6c8f5'], [1, '#b88ad8']], [[0, '#eafaff'], [0.5, '#f4fbff'], [0.8, '#ffe6f0'], [1, '#f3b8c8']]],
    rocket: [[[0, '#0a0f33'], [1, '#02030f']], [[0, '#1c2466'], [1, '#0b0f36']], [[0, '#3b3f8a'], [1, '#1a1a4a']]],
  };
  const TREE_SEASONS = [
    { leaf: ['#4f9a3a', '#7cc95a', '#3c7a2c'], blossom: null },
    { leaf: ['#e08a2b', '#f2b53a', '#b8572b'], blossom: null },
    { leaf: ['#5aa844', '#86d060', '#407f33'], blossom: '#ffb3cf' },
  ];
  const HOUSE_COLORS = [
    { wall: ['#f8dc90', '#e9c56e'], doorCol: ['#3f8fd8', '#2d6fb0'], trim: '#e0663a', curtain: '#ff9fb2', roof: ['#c9503a', '#b3432f'] },
    { wall: ['#f9c6bd', '#e9a99e'], doorCol: ['#3fae8a', '#2d8a6a'], trim: '#3f8fd8', curtain: '#fff0a0', roof: ['#5a6f9a', '#4a5d86'] },
    { wall: ['#bfe6cc', '#9fd2b0'], doorCol: ['#e0663a', '#b8502a'], trim: '#e0663a', curtain: '#ffc2dc', roof: ['#b3533f', '#9c4535'] },
    { wall: ['#d6ccf4', '#bcb0e6'], doorCol: ['#e8b93f', '#c99a2a'], trim: '#8a6ad8', curtain: '#ffe38a', roof: ['#6a5aa8', '#5a4a96'] },
  ];
  const STRIPES = [['#d8342a', '#b3261e', '#8a1a14'], ['#2f6fb3', '#245a96', '#173e6b'], ['#2f9d6a', '#257f55', '#18583b']];
  const THEMES = [
    {
      id: 'pagoda', name: 'Pagoda', zh: '宝塔', emoji: '🏯', icon: '🏮', floatie: 'lantern',
      sky: [SKY_TOP, SKY_MID, SKY_LOW], banner: ['#e2432f', '#a8231a', '#f2c14e'], badge: ['#e0b23f', '#8a2016', '#ffe9a8'],
      ledge: 'stone', ink: '#4a2610', chunk: ['#cbb58f', '#f0e4cc', '#8c7556'],
      backdrop: pagodaBackdrop, storey: pagodaStorey, door: pagodaDoor, gate: drawGate,
      deck: (f, y, a) => drawDeck(f, a), ground: () => drawGround(), crown: () => drawCrown(),
    },
    {
      id: 'temple', name: 'Stone Temple', zh: '神庙', emoji: '🏛️', icon: '🔥', floatie: 'dove',
      sky: T_SKY.temple, banner: ['#3a7cc4', '#1d4a86', '#f2d27a'], badge: ['#e8d9b0', '#2f5f96', '#ffffff'],
      ledge: 'marble', ink: '#2c3e5c', chunk: ['#e9e2d2', '#fffdf8', '#a89c86'],
      variants: [{ accent: '#c8643b' }, { accent: '#2f6fb3' }],
      backdrop: templeBackdrop, storey: templeStorey, door: templeDoor, gate: templeGate, deck: templeDeck, ground: templeGround, crown: templeCrown,
    },
    {
      id: 'tree', name: 'Giant Tree', zh: '大树', emoji: '🌳', icon: '🍃', floatie: 'butterfly',
      sky: T_SKY.tree, banner: ['#8a5a2b', '#5e3a19', '#bfe07a'], badge: ['#d7a868', '#5a3a1e', '#fff3c4'],
      ledge: 'wood', ink: '#4a2a10', chunk: ['#d7a868', '#f6d9a3', '#7a4f2a'], doorCol: ['#5a9a4a', '#3f7a33'],
      variants: TREE_SEASONS,
      backdrop: treeBackdrop, storey: treeStorey, door: treeDoor, gate: treeGate, deck: treeDeck, ground: treeGround, crown: treeCrown,
    },
    {
      id: 'mountain', name: 'Tall Mountain', zh: '高山', emoji: '🏔️', icon: '🚩', floatie: 'bird',
      sky: T_SKY.mountain, banner: ['#4f6d8a', '#2f4660', '#e8f2ff'], badge: ['#e8f2ff', '#3f5a78', '#ffffff'],
      ledge: 'rock', ink: '#233040', chunk: ['#b5bdc6', '#e2e6ea', '#6e7883'], gem: '#9fe0ff',
      variants: [{ rock: ['#c9cfd6', '#a3acb6', '#7f8995', '#626c78'] }, { rock: ['#d6c3ad', '#b8a086', '#957c63', '#6f5a47'] }],
      backdrop: mountainBackdrop, storey: mountainStorey, door: mountainDoor, gate: mountainGate, deck: mountainDeck, ground: mountainGround, crown: mountainCrown,
    },
    {
      id: 'house', name: 'Tall House', zh: '房子', emoji: '🏠', icon: '🪟', floatie: 'balloon',
      sky: T_SKY.house, banner: ['#2f9d8f', '#1f6f65', '#fff1c9'], badge: ['#ffffff', '#2f9d8f', '#ffffff'],
      ledge: 'flowerbox', ink: '#5a2b12', chunk: ['#f1dfbd', '#fffaf0', '#c8643b'],
      variants: HOUSE_COLORS,
      backdrop: houseBackdrop, storey: houseStorey, door: houseDoor, gate: houseGate, deck: houseDeck, ground: houseGround, crown: houseCrown,
    },
    {
      id: 'lighthouse', name: 'Lighthouse', zh: '灯塔', emoji: '⛵', icon: '💡', floatie: 'gull',
      sky: T_SKY.lighthouse, banner: ['#274b8a', '#16305e', '#ffd23f'], badge: ['#ffd23f', '#274b8a', '#ffffff'],
      ledge: 'plank', ink: '#1d2f55', chunk: ['#e6ebf1', '#ffffff', '#8b96a5'],
      variants: STRIPES.map((s) => ({ stripe: s, accent: s[0] })),
      backdrop: lighthouseBackdrop, storey: lighthouseStorey, door: lighthouseDoor, gate: lighthouseGate, deck: lighthouseDeck, ground: lighthouseGround, crown: lighthouseCrown,
    },
    {
      id: 'bean', name: 'Magic Beanstalk', zh: '魔豆', emoji: '🌱', icon: '🫛', floatie: 'sparkle', cloudy: true,
      sky: T_SKY.bean, banner: ['#3f9d3f', '#2a6e2a', '#ffe38a'], badge: ['#ffe38a', '#2f7d32', '#ffffff'],
      ledge: 'cloud', ink: '#24527f', chunk: ['#ffffff', '#ffffff', '#b9d6ee'], puffy: true,
      backdrop: beanBackdrop, storey: beanStorey, door: beanDoor, gate: beanGate, deck: beanDeck, ground: beanGround, crown: beanCrown,
    },
    {
      id: 'rocket', name: 'Rocket Tower', zh: '火箭塔', emoji: '🚀', icon: '⭐', floatie: 'sparkle', night: true,
      sky: T_SKY.rocket, banner: ['#3a3f9a', '#15183f', '#7fe6ff'], badge: ['#7fe6ff', '#2b3048', '#ffffff'],
      ledge: 'steel', ink: '#1b2233', chunk: ['#c6ccd6', '#f3f5f9', '#5e6778'],
      backdrop: rocketBackdrop, storey: rocketStorey, door: rocketDoor, gate: rocketGate, deck: rocketDeck, ground: rocketGround, crown: rocketCrown,
    },
  ];
  let theme = THEMES[0];
  function chooseTheme(idx) {
    const base = THEMES[((idx % THEMES.length) + THEMES.length) % THEMES.length];
    const vs = base.variants;
    theme = vs ? Object.assign({}, base, vs[(g.level - 1) % vs.length]) : base;
  }

  // The sky and the distant scenery only change when the camera moves (or slowly, for twinkling
  // stars and waves), so they are painted into a cached layer instead of every frame.
  const bg = { canvas: document.createElement('canvas'), key: '', theme: null, at: -1 };
  const bgAnimated = () => theme.night || heightT() > 0.6 || theme.id === 'temple' || theme.id === 'lighthouse';
  function drawBackground() {
    const key = `${W}|${H}|${pixelScale}|${cam.toFixed(4)}`;
    if (key !== bg.key || theme !== bg.theme || (bgAnimated() && time - bg.at > 0.1)) {
      const c = bg.canvas;
      const pw = Math.round(W * pixelScale);
      const ph = Math.round(H * pixelScale);
      if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
      const main = ctx;
      ctx = c.getContext('2d');
      ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
      ctx.clearRect(0, 0, W, H);
      drawSky();
      theme.backdrop();
      ctx = main;
      bg.key = key; bg.theme = theme; bg.at = time;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bg.canvas, 0, 0);
    ctx.restore();
  }

  function draw() {
    drawBackground();
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
    placeWashBadge();
    const dpr = window.devicePixelRatio || 1;
    let cssW;
    let cssH;
    let scale;
    const oldW = W;
    if (layout === 'wide') {
      // Laptop: the scene fills the window (the HUD floats over its top corners). It is always
      // 760 units tall; a wide window just shows more scenery on both sides of the tower.
      const availW = Math.max(300, window.innerWidth - 24);
      const availH = Math.max(300, window.innerHeight - 24);
      const logicalW = clamp((availW / availH) * 760, 880, 1900);
      setGeometry(logicalW, 760);
      scale = Math.min(availW / W, availH / H);
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
    if (W !== oldW) for (const c of clouds) c.x = ((c.x + 160) / (oldW + 320)) * (W + 320) - 160; // spread the clouds over the new width
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
    get theme() { return theme.id; },
    themes: THEMES.map((t) => t.id),
    setTheme(i) { chooseTheme(i); updateHud(); if (state === 'intro') showIntro(); },
    skipTo(n) { // test hook: jump straight to floor n (0-9)
      floor = clamp(n, 0, FLOORS - 1);
      cam = camFrom = camTo = floor;
      floorsDone = Array(floor).fill('first');
      nextProblem();
      heroP.lane = heroP.from = HOME;
      heroP.t = 1;
      updateHud();
    },
    geometry: () => ({ W, H, TX0, TX1, HERO_Y, ledgeW: ledgeW(), ledgeY: sy(floor + 1), ledgeH: LEDGE_H, laneX: Array.from({ length: lanes }, (_, i) => laneX(i)) }),
    get problem() {
      if (!problem) return null;
      return {
        text: problem.text, key: problem.key, answer: problem.answer, skill: problem.skill,
        ledges: problem.ledges.map((l) => l.v), alive: problem.ledges.map((l) => l.alive),
        firstAttempt: problem.firstAttempt, source: problem.source, hinted: problem.hinted, tries: problem.tries, tip: problem.tip,
      };
    },
    get stats() { return stats; },
    problems: P,
  };

  // Key reminders float up when he has not pressed anything for a while (keyboard only).
  MQ.Idle.attach(stage, {
    delay: g.played < 2 ? 2500 : 4000,
    active: () => state === 'play' && !!problem && !touchUI(),
    keys: () => {
      const walk = [['←', '→'], 'walk'];
      const hear = [['↓'], 'hear it'];
      const canJump = heroP.lane === HOME ? lanes % 2 === 1 : problem.ledges[heroP.lane].alive;
      return canJump ? [walk, [['↑', 'space'], 'jump'], hear] : [walk, hear];
    },
  });

  resize();
  MQ.Music.play('elise');
  newClimb();
  showIntro();
  requestAnimationFrame(frame);
})();
