/* Coin Crossing — hop across roads, collect coins that add up to exactly the castle's
   target amount, then hop into the castle. Difficulty adapts to how each level went. */
(function () {
  'use strict';

  // Row 0 is the (tall) castle, the last row is the start. The grid shape is picked from the
  // screen when a level starts: the wide 13-column board on a laptop, a narrow 7-column board
  // on a portrait phone (so coins stay big), and a shorter 13-column board on a landscape phone.
  // Everything is drawn in board units (CELL = 64) and scaled to fit the screen.
  const CELL = 64;
  const GRIDS = {
    desk: { cols: 13, rows: 10, castle: 160 },
    port: { cols: 7, rows: 10, castle: 120 },
    land: { cols: 13, rows: 8, castle: 112 },
  };
  let COLS, ROWS, CASTLE_H, W, H, START_ROW, START_COL, gridKey;
  const BANK_ROW = 0;
  function setGrid(key) {
    const gr = GRIDS[key];
    gridKey = key;
    COLS = gr.cols;
    ROWS = gr.rows;
    CASTLE_H = gr.castle;
    W = COLS * CELL;
    H = CASTLE_H + (ROWS - 1) * CELL;
    START_ROW = ROWS - 1;
    START_COL = Math.floor(COLS / 2);
  }
  const rowTop = (r) => (r === BANK_ROW ? 0 : CASTLE_H + (r - 1) * CELL);
  const rowMid = (r) => (r === BANK_ROW ? CASTLE_H - Math.round(34 * CASTLE_H / 160) : rowTop(r) + CELL / 2);

  // Screen layout: 'desk' (laptop, unchanged), 'port' (portrait phone), 'land' (landscape phone).
  function layoutFor() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (vw <= 700 && vh >= vw) return 'port';
    if (vh <= 520 && vw > vh) return 'land';
    return 'desk';
  }
  let layout = layoutFor();
  function applyLayoutClass() {
    const root = document.documentElement;
    root.classList.remove('lay-desk', 'lay-port', 'lay-land');
    root.classList.add(`lay-${layout}`);
  }
  applyLayoutClass();
  setGrid(layout);
  const HOP_TIME = 0.13;
  const GAME_ID = 'coinCrossing';
  const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

  const COINS = {
    1: { name: 'penny', r: 15, hi: '#e7a36b', mid: '#c8793a', lo: '#8a4f1f', text: '#fff' },
    5: { name: 'nickel', r: 18, hi: '#f1f3f5', mid: '#c3c7cc', lo: '#80868d', text: '#333' },
    10: { name: 'dime', r: 13, hi: '#ffffff', mid: '#d3d7dc', lo: '#8f959c', text: '#333' },
    25: { name: 'quarter', r: 21, hi: '#f4f5f6', mid: '#b8bdc3', lo: '#7b8188', text: '#333' },
    100: { name: 'dollar bill', bill: true, fill: '#a8d8a0', edge: '#2f6b2f', text: '#1f4d1f' },
    500: { name: 'five-dollar bill', bill: true, fill: '#c9c3e8', edge: '#4b3f8f', text: '#2f2766' },
  };
  const CAR_COLORS = ['#ff5a5f', '#ffb400', '#3db2ff', '#8f6bff', '#ff7ac6', '#2ec4a6', '#ff8c42'];

  // ---------- Save data ----------
  const data = MQ.load();
  MQ.applySettings(data.settings);
  const g = (data.games[GAME_ID] = Object.assign(
    { level: 1, maxLevel: 1, played: 0, struggles: 0, goodStreak: 0, seconds: 0, history: [], quiz: {} },
    data.games[GAME_ID] || {}
  ));
  const hero = data.player.hero || '🐥';
  function persist() { MQ.save(data); }

  // ---------- DOM ----------
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const stage = document.getElementById('stage');
  const overlay = document.getElementById('overlay');
  const el = (id) => document.getElementById(id);
  const UI_FONT = getComputedStyle(document.body).fontFamily;

  // ---------- Level design: what changes as he levels up ----------
  function configFor(L) {
    const c = {};
    if (L <= 1) Object.assign(c, { denoms: [1, 5], min: 3, max: 10 });
    else if (L <= 2) Object.assign(c, { denoms: [1, 5], min: 6, max: 20 });
    else if (L <= 3) Object.assign(c, { denoms: [1, 5, 10], min: 11, max: 35 });
    else if (L <= 4) Object.assign(c, { denoms: [1, 5, 10], min: 20, max: 60 });
    else if (L <= 5) Object.assign(c, { denoms: [1, 5, 10, 25], min: 25, max: 60 });
    else if (L <= 7) Object.assign(c, { denoms: [1, 5, 10, 25], min: 30, max: 99 });
    else if (L <= 9) Object.assign(c, { denoms: [1, 5, 10, 25, 100], min: 100, max: 199 });
    else if (L <= 11) Object.assign(c, { denoms: [1, 5, 10, 25, 100], min: 100, max: 299 });
    else if (L <= 13) Object.assign(c, { denoms: [5, 10, 25, 100], min: 100, max: 400, step: 5 });
    else Object.assign(c, { denoms: [1, 5, 10, 25, 100, 500], min: 200, max: Math.min(999, 450 + (L - 14) * 60) });

    // How amounts are written: cents first, then dollars, then mixed so he has to convert.
    c.format = L <= 7 ? 'cents' : L <= 9 ? 'dollars' : 'mixed';
    c.roads = Math.min(2 + Math.floor((L - 1) / 3), 5);
    c.maxRun = L < 10 ? 2 : 3; // longest stretch of back-to-back roads
    c.speed = Math.min(1.0 + 0.12 * (L - 1), 3.4);
    c.maxCars = L <= 2 ? 2 : L <= 11 ? 3 : 4;
    c.buses = L >= 5;
    c.extras = Math.min(3 + Math.floor(L / 3), 7);
    // Levels 1-2 are training wheels: "Need N more" is shown, a coin that would go over is
    // refused, and the gate opens by itself at the exact amount. From level 3 he does the
    // adding: every coin goes in the pouch (it can go over) and the gate judges him only when
    // he hops in. "Need N more" comes back as help after 2 wrong tries at the gate.
    c.judge = L >= 3;
    c.showNeed = !c.judge;
    return c;
  }

  // ---------- Helpers ----------
  const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => 1 - Math.pow(1 - t, 3);

  function decompose(target, denoms) {
    const sorted = [...denoms].sort((a, b) => a - b);
    for (let attempt = 0; attempt < 30; attempt++) {
      const coins = [];
      let rem = target;
      while (rem > 0) {
        const opts = sorted.filter((d) => d <= rem);
        const d = Math.random() < 0.6 ? opts[opts.length - 1] : pick(opts);
        coins.push(d);
        rem -= d;
      }
      if (coins.length <= 9) return coins;
    }
    const coins = []; // plain greedy fallback
    let rem = target;
    for (let i = sorted.length - 1; i >= 0; i--) {
      while (rem >= sorted[i]) { coins.push(sorted[i]); rem -= sorted[i]; }
    }
    return coins;
  }

  // Can the coins still on the board make exactly `need`? (small subset-sum)
  function canMake(need, values) {
    const reach = new Uint8Array(need + 1);
    reach[0] = 1;
    for (const v of values) {
      for (let s = need; s >= v; s--) if (reach[s - v]) reach[s] = 1;
    }
    return !!reach[need];
  }

  // ---------- Game state ----------
  let cfg, target, coins, lanes, laneByRow, player, pouch, stats, targetFmt, pouchFmt;
  let needRevealed = false;
  let state = 'intro'; // intro | play | pause | won | result | quiz | quizDone
  let particles = [];
  let floaters = [];
  let time = 0;
  let queuedMove = null;
  let lastSaveAt = 0;
  let gateLift = 0; // 0 = portcullis down, 1 = fully raised
  let gateUnlocked = false; // level 3+: the gate opens only once he walks in with the exact amount
  let gateCooldown = 0; // level 3+: a moment after a wrong try before the gate listens again
  const WRONG_TRIES_FOR_HELP = 2;

  function total() { return pouch.reduce((s, c) => s + c.v, 0); }
  // Is the gate open (drawn raised and golden)? Levels 1-2: as soon as the amount is exact.
  // Level 3+: never while he is still collecting, so it can't tell him when he's done.
  function gateOpen() { return cfg.judge ? gateUnlocked : total() === target; }
  // Level 3+: has he earned the "Need N more" / "put a coin back" help yet?
  const helpOn = () => !cfg.judge || stats.wrongGate >= WRONG_TRIES_FOR_HELP;

  function newLevel() {
    cfg = configFor(g.level);
    const step = cfg.step || 1;
    target = rand(Math.ceil(cfg.min / step), Math.floor(cfg.max / step)) * step;

    if (cfg.format === 'mixed') {
      const flip = g.played % 2 === 0;
      targetFmt = flip ? 'dollars' : 'cents';
      pouchFmt = flip ? 'cents' : 'dollars';
    } else {
      targetFmt = pouchFmt = cfg.format;
    }

    pouch = [];
    // wrongGate (level 3+) is for this round's stars only; it is not saved.
    stats = { overshoots: 0, bonks: 0, putBacks: 0, wrongGate: 0, seconds: 0 };
    needRevealed = cfg.showNeed;
    buildBoard();
  }

  // Roads, cars, coins and the hero for the current target, on a grid that fits this screen.
  function buildBoard() {
    setGrid(layout);
    const roads = Math.min(cfg.roads, ROWS - 4);

    // Lanes: row 0 is the castle, the bottom row is the safe start, some middle rows are roads.
    // Roads come in short groups with safe grass rows between them.
    let roadRows;
    for (let attempt = 0; attempt < 200; attempt++) {
      const middle = shuffle(Array.from({ length: ROWS - 2 }, (_, i) => i + 1));
      roadRows = new Set(middle.slice(0, roads));
      let run = 0;
      let ok = true;
      for (let r = 1; r <= ROWS - 2; r++) {
        run = roadRows.has(r) ? run + 1 : 0;
        if (run > cfg.maxRun) { ok = false; break; }
      }
      if (ok) break;
    }
    lanes = [];
    laneByRow = {};
    for (const row of roadRows) {
      const lane = makeLane(row);
      lanes.push(lane);
      laneByRow[row] = lane;
    }

    // Coins: an exact solution plus a few extra coins to think about.
    const values = decompose(target, cfg.denoms);
    for (let i = 0; i < cfg.extras; i++) values.push(pick(cfg.denoms));
    const cells = [];
    for (let r = 1; r <= ROWS - 2; r++) for (let c = 0; c < COLS; c++) cells.push({ r, c });
    shuffle(cells);
    coins = values.map((v, i) => ({
      v, r: cells[i].r, c: cells[i].c, taken: false, warned: false, bob: Math.random() * 6, fly: null,
    }));

    player = { r: START_ROW, c: START_COL, fromR: START_ROW, fromC: START_COL, t: 1, inv: 0, land: 0 };
    bgSeed = Math.floor(Math.random() * 1e9);
    bgCanvas = null;
    initAmbient();
    gateLift = 0;
    gateUnlocked = false;
    gateCooldown = 0;
    particles = [];
    floaters = [];
    queuedMove = null;
    ripples = [];
    updateHud();
    resize();
  }

  function makeLane(row) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    // A short (narrow-board) lane gets fewer cars and a little less speed, since cars
    // come into view closer to the hero. The 13-column board is unchanged.
    const span = COLS + 4;
    const narrow = COLS < 13;
    const speed = cfg.speed * (narrow ? 0.9 : 1) * (0.75 + Math.random() * 0.5);
    const maxCars = narrow ? Math.max(1, Math.round(cfg.maxCars * span / 17 - 0.25)) : cfg.maxCars;
    const n = rand(1, maxCars);
    const gap = span / n;
    const cars = [];
    for (let i = 0; i < n; i++) {
      const len = cfg.buses && Math.random() < 0.3 ? 2 : 1;
      cars.push({ x: -2 + i * gap + Math.random() * Math.max(0, gap - len - 2), len, color: pick(CAR_COLORS) });
    }
    return { row, dir, speed, cars, span };
  }

  // ---------- HUD ----------
  function coinChip(v, big = false) {
    const style = big ? ' style="transform:scale(1.5);margin:8px"' : '';
    if (v >= 100) return `<span class="bill ${v === 500 ? 'b5' : ''}"${style}>$${v / 100}</span>`;
    return `<span class="coin c${v}"${style}>${v}¢</span>`;
  }

  function updateHud() {
    const t = total();
    el('level').textContent = g.level;
    el('stars').textContent = data.stars;
    el('target').textContent = MQ.money(target, targetFmt);
    el('pouch').textContent = MQ.money(t, pouchFmt);
    el('target-zh').textContent = data.settings.chinese ? MQ.zhMoney(target) : '';
    el('pouch-zh').textContent = data.settings.chinese ? MQ.zhMoney(t) : '';
    el('pouch-coins').innerHTML = pouch.map((c) => coinChip(c.v)).join('');
    const need = el('need');
    const need2 = el('need2'); // compact copy for the phone HUD (next to the target)
    if (cfg.judge) {
      // Level 3+: no live "you're done" cue. Neutral until he has earned the help.
      need.classList.remove('done');
      need2.classList.remove('done');
      if (!needRevealed) {
        need.textContent = `Hop into the castle 🏰 when you think you have exactly ${MQ.money(target, targetFmt)}`;
        need2.textContent = 'Then hop in 🏰';
      } else if (t > target) {
        need.textContent = need2.textContent = `${MQ.money(t - target, targetFmt)} too many`;
      } else {
        need.textContent = need2.textContent = `Need ${MQ.money(target - t, targetFmt)} more`;
      }
    } else {
      need.classList.toggle('done', t === target);
      if (t === target) need.textContent = '✅ Exactly right! Hop to the castle ⬆';
      else if (needRevealed) need.textContent = `Need ${MQ.money(target - t, targetFmt)} more`;
      else need.textContent = 'How much more do you need? 🤔';
      need2.classList.toggle('done', t === target);
      if (t === target) need2.textContent = '✅ Exactly! ⬆';
      else if (needRevealed) need2.textContent = `Need ${MQ.money(target - t, targetFmt)} more`;
      else need2.textContent = 'Need ? more 🤔';
    }
    el('btn-back').classList.toggle('empty', pouch.length === 0);
  }

  // Phones show the panda's message as a toast over the board that fades after a moment.
  let toastTimer = 0;
  let toastLow = false;
  function say(text, { speak = false } = {}) {
    el('message').textContent = text;
    const b = el('bubble');
    b.classList.remove('pop');
    void b.offsetWidth;
    b.classList.add('pop', 'show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => b.classList.remove('show'), 2600 + text.length * 45);
    if (speak) MQ.Voice.say(text.replace(/\p{Extended_Pictographic}/gu, ''), 'en-US', { interrupt: true });
  }

  // Touch wording vs keyboard wording.
  let usedTouch = MQ.isTouch;
  const touchUI = () => usedTouch || layout !== 'desk';
  const PUT_BACK = () => (touchUI() ? 'Tap ↩ Put back' : 'Press SPACE');
  // Read something aloud in plain words (money as "86 cents", not "86¢").
  const speak = (text) => MQ.Voice.say(text, 'en-US', { interrupt: true });

  // ---------- Input ----------
  const DIRS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

  window.addEventListener('keydown', (e) => {
    const k = e.key;
    if (DIRS[k] || k === ' ' || k === 'Enter' || k === 'Escape') e.preventDefault();
    MQ.Sound.ensure();

    if ((k === 'm' || k === 'M') && !e.repeat) { toggleMusic(); return; }
    if (state === 'play') {
      if (DIRS[k] && !e.repeat) tryMove(...DIRS[k]);
      else if (k === ' ' && !e.repeat) putBack();
      else if (k === 'Escape' || k === 'p') showPause();
      return;
    }
    if (overlayKeys) overlayKeys(k, e);
  });

  function toggleMusic() {
    data.settings.music = data.settings.music === false;
    MQ.applySettings(data.settings);
    persist();
    syncMusicBtn();
    say(data.settings.music ? '🎵 Music on' : '🔇 Music off');
  }
  function syncMusicBtn() {
    const b = el('btn-music');
    const on = data.settings.music !== false;
    b.textContent = on ? '🎵' : '🔇';
    b.classList.toggle('off', !on);
  }

  // ---------- Touch: tap a cell = hop one step toward it, swipe = hop that way ----------
  const wrap = el('stage-wrap');
  let touch = null; // the one finger we are following
  let ripples = [];
  const SWIPE = 26; // CSS px before a drag counts as a swipe
  // Right after Start (or Keep playing) the board ignores taps for a moment, so the second
  // tap of an excited double-tap doesn't hop the hero (maybe into a car).
  const QUIET_MS = 400;
  let boardQuietUntil = 0;
  function resumePlay() {
    hideOverlay();
    state = 'play';
    boardQuietUntil = performance.now() + QUIET_MS;
  }

  function boardPoint(e) {
    const rect = canvas.getBoundingClientRect();
    const k = W / rect.width;
    return { x: (e.clientX - rect.left) * k, y: (e.clientY - rect.top) * k, inside: e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom };
  }
  function cellAt(x, y) {
    const r = y < CASTLE_H ? BANK_ROW : 1 + Math.floor((y - CASTLE_H) / CELL);
    return { r: Math.max(0, Math.min(START_ROW, r)), c: Math.max(0, Math.min(COLS - 1, Math.floor(x / CELL))) };
  }
  function boardInput(e) {
    if (e.target.closest && e.target.closest('.overlay, .touch-hint')) return false;
    if (e.pointerType === 'mouse' && layout === 'desk') return false; // laptop: keyboard, as before
    return true;
  }

  wrap.addEventListener('pointerdown', (e) => {
    if (!boardInput(e)) return;
    if (e.pointerType !== 'mouse') usedTouch = true;
    if (touch || state !== 'play') return;
    e.preventDefault();
    if (performance.now() < boardQuietUntil) return;
    MQ.Sound.ensure();
    touch = { id: e.pointerId, x: e.clientX, y: e.clientY, done: false };
    try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!touch || e.pointerId !== touch.id || touch.done || state !== 'play') return;
    const dx = e.clientX - touch.x;
    const dy = e.clientY - touch.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE) return;
    touch.done = true; // one hop per swipe
    if (Math.abs(dx) > Math.abs(dy)) touchMove(0, dx > 0 ? 1 : -1);
    else touchMove(dy > 0 ? 1 : -1, 0);
  });
  const endTouch = (e) => {
    if (!touch || e.pointerId !== touch.id) return;
    const t = touch;
    touch = null;
    if (t.done || state !== 'play' || e.type === 'pointercancel') return;
    const p = boardPoint(e);
    // Which cell was tapped (not clamped, so a tap just off the board still has a direction)?
    const r = p.y < CASTLE_H ? BANK_ROW : 1 + Math.floor((p.y - CASTLE_H) / CELL);
    const c = Math.floor(p.x / CELL);
    const dr = r - player.r;
    const dc = c - player.c;
    if (dr === 0 && dc === 0) return; // tapped the hero itself: stay put
    ripples.push({ x: p.x, y: p.y, life: 1 });
    // The castle spans the whole top row, so the step toward it is always up.
    if (r === BANK_ROW) { touchMove(-1, 0); return; }
    // Next to the hero: hop there. Farther away (a coin he wants): ONE hop toward it,
    // along whichever way is farther (a diagonal tie goes by where the finger landed).
    let upDown = Math.abs(dr) > Math.abs(dc);
    if (Math.abs(dr) === Math.abs(dc)) {
      const h = cellCenter(player.r, player.c);
      upDown = Math.abs(p.y - h.y) > Math.abs(p.x - h.x);
    }
    if (upDown) touchMove(Math.sign(dr), 0);
    else touchMove(0, Math.sign(dc));
  };
  wrap.addEventListener('pointerup', endTouch);
  wrap.addEventListener('pointercancel', endTouch);
  function touchMove(dr, dc) {
    hideTouchHint();
    tryMove(dr, dc);
  }

  // Big on-screen buttons (phones and tablets).
  function onTap(id, fn) {
    const b = el(id);
    b.addEventListener('click', (e) => { e.preventDefault(); MQ.Sound.ensure(); fn(); b.blur(); });
  }
  onTap('btn-back', () => { if (state === 'play') putBack(); });
  onTap('btn-pause', () => {
    if (state === 'play') showPause();
    else if (state === 'pause') resumePlay();
  });
  onTap('btn-music', toggleMusic);

  // One-time animated "tap to hop, swipe to turn" hint.
  let hintTimer = 0;
  function maybeShowTouchHint() {
    if (!touchUI() || g.touchHintSeen) return;
    g.touchHintSeen = true;
    persist();
    el('touch-hint').hidden = false;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(hideTouchHint, 7000);
  }
  function hideTouchHint() {
    const h = el('touch-hint');
    if (!h.hidden) h.hidden = true;
  }

  function tryMove(dr, dc) {
    if (player.t < 1) { queuedMove = [dr, dc]; return; }
    const nr = player.r + dr;
    const nc = player.c + dc;
    if (nc < 0 || nc >= COLS || nr > START_ROW || nr < BANK_ROW) return;
    // Level 3+: he may always hop up to the gate; it judges the pouch when he gets there.
    if (nr === BANK_ROW && cfg.judge && time < gateCooldown) return;
    if (nr === BANK_ROW && !cfg.judge && total() !== target) {
      MQ.Sound.nope();
      const t = total();
      if (t === 0) say('The castle is locked 🔒. Collect coins first!');
      else if (needRevealed) say(`Locked 🔒! You have ${MQ.money(t, pouchFmt)}. You need ${MQ.money(target - t, targetFmt)} more.`);
      else say(`Locked 🔒! You have ${MQ.money(t, pouchFmt)}, but the castle needs ${MQ.money(target, targetFmt)}.`);
      return;
    }
    player.fromR = player.r;
    player.fromC = player.c;
    player.r = nr;
    player.c = nc;
    player.t = 0;
    player.bounce = false;
    MQ.Sound.hop(START_ROW - Math.max(nr, 1), dr === 0);
  }

  function onLand() {
    player.land = 0.16;
    const pos = cellCenter(player.r, player.c);
    for (let i = 0; i < 6; i++) {
      particles.push({ x: pos.x + (Math.random() - 0.5) * 20, y: pos.y + 20, vx: (Math.random() - 0.5) * 60, vy: -20 - Math.random() * 30, life: 0.4, color: 'rgba(255,255,255,0.8)', size: 3 + Math.random() * 3, dust: true });
    }
    if (player.r === BANK_ROW) {
      if (!cfg.judge || total() === target) win();
      else notYet();
      return;
    }
    const bounced = player.bounce;
    player.bounce = false;
    const coin = !bounced && coins.find((c) => !c.taken && !c.fly && c.r === player.r && c.c === player.c);
    if (coin) touchCoin(coin);
    if (queuedMove) { const m = queuedMove; queuedMove = null; tryMove(...m); }
  }

  // Level 3+: he hopped into the castle without the exact amount. Kindly bounce him back one
  // row and tell him (aloud too) what he has and what the castle needs, so he can work it out.
  function notYet() {
    const t = total();
    MQ.Sound.nope();
    queuedMove = null;
    player.fromR = BANK_ROW;
    player.fromC = player.c;
    player.r = BANK_ROW + 1;
    player.t = 0;
    player.bounce = true; // don't grab a coin on the way back down
    gateCooldown = time + 0.8;
    const { x, y } = cellCenter(BANK_ROW, player.c);
    floaters.push({ x, y: y - 24, text: 'Not yet!', life: 1.2, color: '#e07b00' });
    if (t === 0) {
      // Nothing in the pouch is not a wrong answer, just a reminder.
      say(`Collect coins first! The castle needs ${MQ.money(target, targetFmt)}.`);
      speak(`Collect some coins first! The castle needs ${MQ.moneyWords(target)}.`);
      return;
    }
    stats.wrongGate++;
    if (stats.wrongGate >= WRONG_TRIES_FOR_HELP) needRevealed = true;
    updateHud();
    let text = `Not yet! You have ${MQ.money(t, pouchFmt)}. The castle needs ${MQ.money(target, targetFmt)}.`;
    let words = `Not yet! You have ${MQ.moneyWords(t)}. The castle needs ${MQ.moneyWords(target)}.`;
    if (!helpOn()) {
      text += ' 🤔';
    } else if (t > target) {
      text += ` That's ${MQ.money(t - target, targetFmt)} too many. ${PUT_BACK()} to put a coin back.`;
      words += ` That's ${MQ.moneyWords(t - target)} too many. Put a coin back.`;
    } else {
      const left = coins.filter((c) => !c.taken).map((c) => c.v);
      text += ` You need ${MQ.money(target - t, targetFmt)} more.`;
      words += ` You need ${MQ.moneyWords(target - t)} more.`;
      if (!canMake(target - t, left)) {
        text += ` The coins left can't make that — ${PUT_BACK()} to put a coin back.`;
        words += ' The coins left can\'t make that. Put a coin back.';
      }
    }
    say(text);
    speak(words);
  }

  function touchCoin(coin) {
    const t = total();
    const name = COINS[coin.v].name;
    if (cfg.judge) { takeCoin(coin); return; }
    if (t === target) {
      say(`You already have exactly ${MQ.money(t, pouchFmt)}! Hop up to the castle ⬆`);
      return;
    }
    if (t + coin.v > target) {
      MQ.Sound.nope();
      if (!coin.warned) { stats.overshoots++; coin.warned = true; }
      needRevealed = true;
      say(`Too much! ${MQ.money(t, pouchFmt)} + a ${name} (${MQ.money(coin.v, 'cents')}) would be ${MQ.money(t + coin.v, pouchFmt)}. You only need ${MQ.money(target - t, targetFmt)} more.`);
      updateHud();
      return;
    }
    coin.taken = true;
    pouch.push(coin);
    MQ.Sound.coin(coin.v);
    const { x, y } = cellCenter(coin.r, coin.c);
    burst(x, y, coin.v >= 100 ? '#6fcf6f' : '#ffd23f', 14);
    floaters.push({ x, y: y - 20, text: `+${coin.v >= 100 ? MQ.dollars(coin.v) : coin.v + '¢'}`, life: 1 });
    const now = total();
    updateHud();
    if (now === target) {
      MQ.Sound.open();
      say(`You made ${MQ.money(now, targetFmt)}! The castle gate is open — hop to the top! ⬆`);
      MQ.Voice.say(`You made ${MQ.moneyWords(now)}! The castle gate is open. Hop to the top!`, 'en-US', { interrupt: true });
    } else {
      const left = coins.filter((c) => !c.taken).map((c) => c.v);
      if (!canMake(target - now, left)) {
        say(`Hmm… the coins left can't make exactly ${MQ.money(target, targetFmt)}. ${PUT_BACK()} to put a coin back.`);
      } else {
        say(`You picked up a ${name}. Now you have ${MQ.money(now, pouchFmt)}.`);
      }
    }
  }

  function putBack() {
    const coin = pouch.pop();
    if (!coin) { say('Your pouch is empty.'); return; }
    stats.putBacks++;
    const from = cellCenter(player.r, player.c);
    coin.taken = false;
    coin.warned = false;
    coin.fly = { t: 0, x: from.x, y: from.y - 20 };
    MQ.Sound.putBack();
    updateHud();
    say(`You put back a ${COINS[coin.v].name}. Now you have ${MQ.money(total(), pouchFmt)}.`);
  }

  function bonk() {
    stats.bonks++;
    MQ.Sound.bonk();
    const { x, y } = cellCenter(player.r, player.c);
    burst(x, y, '#ffffff', 10);
    floaters.push({ x, y: y - 10, text: 'Bonk!', life: 1, color: '#ff4d4d' });
    player.r = player.fromR = START_ROW;
    player.c = player.fromC = START_COL;
    player.t = 1;
    player.inv = 1.4;
    queuedMove = null;
    // A car hit starts the level over: every collected coin flies back to its spot.
    const lost = pouch.length;
    while (pouch.length) {
      const coin = pouch.pop();
      coin.taken = false;
      coin.warned = false;
      coin.fly = { t: 0, x, y: y - 20 };
    }
    for (const c of coins) c.warned = false;
    updateHud();
    const again = lost ? 'Bonk! The coins went back — start over from the bottom.' : 'Bonk! Back to the start.';
    say(stats.bonks >= 3 ? `${MQ.CHEER.zh} (${MQ.CHEER.py}) Wait for a gap, then hop! ${again}` : again);
  }

  // ---------- Win / results / adapting difficulty ----------
  function win() {
    state = 'won';
    MQ.Sound.win();
    const { x, y } = cellCenter(0, player.c);
    for (let i = 0; i < 5; i++) setTimeout(() => burst(x + rand(-150, 150), y + rand(0, 200), pick(CAR_COLORS), 26), i * 150);
    const praise = MQ.pick(MQ.PRAISE);
    say(`${praise.zh} ${praise.en}`);
    if (data.settings.chinese) MQ.Voice.say(praise.zh, 'zh-CN', { interrupt: true });
    else MQ.Voice.say(praise.en, 'en-US', { interrupt: true });
    setTimeout(() => showResult(praise), 1300);
  }

  function starsFor(s) {
    if (s.overshoots <= 1 && s.bonks <= 1) return 3;
    if (s.overshoots <= 3 && s.bonks <= 3) return 2;
    return 1;
  }

  function adapt(stars) {
    const before = g.level;
    g.played++;
    if (stars === 3) {
      g.level++;
      g.struggles = 0;
      g.goodStreak = 0;
    } else if (stars === 2) {
      g.struggles = 0;
      g.goodStreak++;
      if (g.goodStreak >= 2) { g.level++; g.goodStreak = 0; }
    } else {
      g.goodStreak = 0;
      g.struggles++;
      if (g.struggles >= 2 && g.level > 1) { g.level--; g.struggles = 0; }
    }
    g.maxLevel = Math.max(g.maxLevel, g.level);
    if (g.level > before) return { text: '⬆ Level up! Next one is a little harder.', kind: 'up' };
    if (g.level < before) return { text: "Let's practice an easier one, then come back up!", kind: 'down' };
    return { text: "Let's try this level again to get more stars!", kind: 'same' };
  }

  function showResult(praise) {
    const stars = starsFor(stats);
    const level = g.level;
    g.history.push({
      level, stars, target, overshoots: stats.overshoots, bonks: stats.bonks,
      putBacks: stats.putBacks, seconds: Math.round(stats.seconds), date: new Date().toISOString(),
    });
    if (g.history.length > 200) g.history.splice(0, g.history.length - 200);
    const heroesBefore = MQ.unlockedHeroes(data.stars).length;
    data.stars += stars;
    const newHero = MQ.unlockedHeroes(data.stars).slice(heroesBefore)[0];
    const move = adapt(stars);
    persist();
    updateHud();

    state = 'result';
    const starHtml = [1, 2, 3].map((i) => `<span class="${i <= stars ? '' : 'off'}">⭐</span>`).join('');
    showOverlay(`
      <div class="card">
        <h2>Level ${level} complete!</h2>
        <div class="stars-row">${starHtml}</div>
        <div class="praise"><span class="zh">${praise.zh}</span><small>${praise.py} · ${praise.en}</small></div>
        <div class="stats">
          <span>🎯 ${MQ.money(target, targetFmt)}</span>
          <span>🙈 ${stats.overshoots} too-much</span>
          <span>🚗 ${stats.bonks} bonk${stats.bonks === 1 ? '' : 's'}</span>
        </div>
        <div class="next">${move.text}</div>
        ${newHero ? `<div class="next">🎉 New hero unlocked: ${newHero.emoji} ${newHero.name}! Pick it in the portal.</div>` : ''}
        <div class="press keys-only">Press <span class="key">return</span> for a bonus question ⭐</div>
        <button class="btn go touch-only" data-go>Bonus question ⭐ ▶</button>
      </div>`,
      (k) => { if (k === 'Enter' || k === ' ') startQuiz(); }
    );
    onGo(startQuiz);
  }

  // ---------- Bonus questions between levels ----------
  const ITEMS = [
    ['🍎', 'apple'], ['🍌', 'banana'], ['🧃', 'juice box'], ['✏️', 'pencil'], ['🍪', 'cookie'],
    ['🎈', 'balloon'], ['🥟', 'dumpling'], ['🍡', 'snack'], ['🧸', 'teddy bear'], ['⚽', 'ball'],
  ];

  function numberOptions(ans, fmt = (n) => String(n)) {
    const set = new Set([ans]);
    const tries = [ans + 1, ans - 1, ans + 10, ans - 10, ans + 5, ans - 5, ans + 2, ans - 2];
    shuffle(tries);
    for (const t of tries) { if (set.size >= 3) break; if (t > 0) set.add(t); }
    return shuffle([...set]).map(fmt);
  }

  const QUIZ = {
    add: {
      label: 'Adding', min: 1,
      make(L) {
        let nums;
        if (L <= 2) nums = [rand(1, 10), rand(1, 10)];
        else if (L <= 4) nums = Math.random() < 0.5 ? [rand(2, 10), rand(2, 10), rand(2, 10)] : [rand(10, 30), rand(2, 9)];
        else if (L <= 7) nums = Math.random() < 0.5 ? [rand(11, 49), rand(11, 49)] : [pick([10, 20, 25]), pick([5, 10, 15]), rand(2, 9)];
        else nums = Math.random() < 0.5 ? [rand(15, 65), rand(15, 35)] : [rand(10, 40), rand(10, 30), rand(5, 25)];
        const ans = nums.reduce((a, b) => a + b, 0);
        return {
          q: `${nums.join(' + ')} = ?`, speak: `What is ${nums.join(' plus ')}?`,
          answer: String(ans), options: numberOptions(ans),
          explain: `${nums.join(' + ')} = ${ans}`,
        };
      },
    },
    count: {
      label: 'Counting coins', min: 1,
      make(L) {
        const denoms = configFor(L).denoms.filter((d) => d < 100);
        const n = L <= 2 ? rand(2, 3) : L <= 5 ? rand(3, 4) : rand(4, 6);
        const vals = Array.from({ length: n }, () => pick(denoms)).sort((a, b) => b - a);
        const ans = vals.reduce((a, b) => a + b, 0);
        const opts = new Set([ans]);
        if (n !== ans) opts.add(n); // classic mistake: counting coins instead of their value
        return {
          q: 'How much money is this?', speak: 'How much money is this?',
          visual: vals.map((v) => coinChip(v, true)).join(''),
          answer: `${ans}¢`,
          options: shuffle([...new Set([...opts, ...numberOptions(ans).map(Number)])].slice(0, 3)).map((x) => `${x}¢`),
          explain: `${vals.map((v) => `${v}¢`).join(' + ')} = ${ans}¢`,
        };
      },
    },
    sub: {
      label: 'Subtracting', min: 2,
      make(L) {
        let a, b;
        if (L <= 3) { a = rand(6, 20); b = rand(1, a - 1); }
        else if (L <= 6) { a = rand(20, 60); b = rand(3, a - 5); }
        else { a = rand(40, 99); b = rand(11, a - 8); }
        const ans = a - b;
        return {
          q: `${a} − ${b} = ?`, speak: `What is ${a} minus ${b}?`,
          answer: String(ans), options: numberOptions(ans), explain: `${a} − ${b} = ${ans}`,
        };
      },
    },
    change: {
      label: 'Making change', min: 4,
      make(L) {
        const [emoji, name] = pick(ITEMS);
        let have, price;
        if (L <= 7) have = pick([25, 50, 75, 100]);
        else have = pick([100, 200, 500]);
        price = rand(1, have / 5 - 1) * 5 + (L >= 6 ? rand(0, 4) : 0);
        price = Math.min(price, have - 1);
        const fmt = have >= 100 && L >= 8 ? 'dollars' : 'cents';
        const ans = have - price;
        return {
          q: `You have ${MQ.money(have, fmt)}. ${emoji} costs ${MQ.money(price, fmt)}. How much is left?`,
          speak: `You have ${MQ.moneyWords(have)}. The ${name} costs ${MQ.moneyWords(price)}. How much money is left?`,
          visual: emoji,
          answer: MQ.money(ans, fmt), options: numberOptions(ans).map((n) => MQ.money(Number(n), fmt)),
          explain: `${MQ.money(have, fmt)} − ${MQ.money(price, fmt)} = ${MQ.money(ans, fmt)}`,
        };
      },
    },
    c2d: {
      label: 'Cents → dollars', min: 7,
      make() {
        const c = Math.random() < 0.3 ? rand(1, 9) * 100 + rand(1, 9) : rand(101, 999);
        const wrong = [`$${Math.floor(c / 10)}.${c % 10}0`, `$0.${String(c % 100).padStart(2, '0')}`, `$${Math.floor(c / 100)}.${(c % 100) % 10}${Math.floor((c % 100) / 10)}`];
        return {
          q: `${c}¢ = ?`, speak: `How do you write ${c} cents with a dollar sign?`,
          answer: MQ.dollars(c),
          options: shuffle([...new Set([MQ.dollars(c), ...wrong])].slice(0, 3)),
          explain: `100¢ = $1.00, so ${c}¢ = ${MQ.dollars(c)}`,
        };
      },
    },
    d2c: {
      label: 'Dollars → cents', min: 7,
      make() {
        const c = Math.random() < 0.3 ? rand(1, 9) * 100 + rand(1, 9) : rand(101, 999);
        const d = Math.floor(c / 100);
        const r = c % 100;
        const wrong = [`${d}${r}¢`, `${c * 10}¢`, `${r}¢`];
        return {
          q: `${MQ.dollars(c)} = ? ¢`, speak: `How many cents is ${MQ.moneyWords(c)}?`,
          answer: `${c}¢`,
          options: shuffle([...new Set([`${c}¢`, ...wrong])].slice(0, 3)),
          explain: `$1.00 = 100¢, so ${MQ.dollars(c)} = ${c}¢`,
        };
      },
    },
  };

  function chooseQuizType() {
    // Practice weaker skills more often.
    const L = Math.max(1, g.level - 1);
    const types = Object.keys(QUIZ).filter((k) => L >= QUIZ[k].min);
    const weights = types.map((k) => {
      const s = g.quiz[k] || { right: 0, tries: 0 };
      const acc = (s.right + 1) / (s.tries + 2);
      return 0.5 + 2.5 * (1 - acc);
    });
    let x = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < types.length; i++) { x -= weights[i]; if (x <= 0) return types[i]; }
    return types[0];
  }

  function startQuiz() {
    state = 'quiz';
    const type = chooseQuizType();
    const q = QUIZ[type].make(Math.max(1, g.level - 1));
    if (!q.options.includes(q.answer)) q.options[0] = q.answer;
    while (q.options.length < 3) q.options.push(String(Number(q.options[q.options.length - 1]) + 2));
    // Nothing is pre-selected: every choice looks the same until the child picks one
    // (no "leading the witness"). The first arrow press picks from the middle outwards.
    let sel = -1;
    let done = false;
    let nudge = false;

    const render = (result) => {
      const choices = q.options.map((o, i) => {
        let cls = 'choice';
        if (result) { if (o === q.answer) cls += ' right'; else if (i === sel) cls += ' wrong'; }
        else if (i === sel) cls += ' sel';
        return `<button class="${cls}" data-i="${i}">${MQ.escapeHtml(o)}</button>`;
      }).join('');
      const keyHint = result ? 'Press <span class="key">return</span> to keep going'
        : sel < 0 ? `<span class="${nudge ? 'nudge' : ''}">${nudge ? 'Pick an answer first — use' : 'Pick one! Use'} <span class="key">←</span> <span class="key">→</span></span>`
        : 'Pick with <span class="key">←</span> <span class="key">→</span> then press <span class="key">return</span>';
      const feedback = !result ? '' : result === 'right'
        ? `<div class="explain good">✔ Correct! <span class="zh">对了!</span> +1 ⭐</div>`
        : `<div class="explain bad">The answer is ${MQ.escapeHtml(q.answer)}. ${MQ.escapeHtml(q.explain)}</div>`;
      showOverlay(`
        <div class="card">
          <div class="hint">🐼 Bonus question · ${QUIZ[type].label}</div>
          ${q.visual ? `<div class="quiz-visual">${q.visual}</div>` : ''}
          <div class="quiz-q">${MQ.escapeHtml(q.q)}</div>
          <div class="choices${!result && sel < 0 ? ' waiting' : ''}">${choices}</div>
          ${feedback}
          <div class="press keys-only">${keyHint}</div>
          ${result ? '<button class="btn go touch-only" data-go>Next level ▶</button>' : '<div class="press touch-only">Tap your answer 👆</div>'}
        </div>`, keys);
      overlay.querySelectorAll('.choice').forEach((b) => b.addEventListener('click', () => {
        if (done) { if (!MQ.isTouch) nextLevel(); return; } // on touch, the Next button moves on (no accidental double tap)
        sel = Number(b.dataset.i);
        answer();
      }));
      if (result) onGo(nextLevel);
    };

    const answer = () => {
      done = true;
      const right = q.options[sel] === q.answer;
      const s = (g.quiz[type] = g.quiz[type] || { right: 0, tries: 0 });
      s.tries++;
      if (right) { s.right++; data.stars++; MQ.Sound.correct(); MQ.Voice.say(data.settings.chinese ? '对了!' : 'Correct!', data.settings.chinese ? 'zh-CN' : 'en-US', { interrupt: true }); }
      else { MQ.Sound.wrong(); MQ.Voice.say(`The answer is ${q.answer.replace('¢', ' cents')}`, 'en-US', { interrupt: true }); }
      persist();
      updateHud();
      render(right ? 'right' : 'wrong');
    };

    const keys = (k) => {
      if (done) { if (k === 'Enter' || k === ' ') nextLevel(); return; }
      const n = q.options.length;
      const mid = (n - 1) / 2; // first press steps out of the middle toward the arrow's side
      if (k === 'ArrowLeft') { sel = sel < 0 ? Math.ceil(mid) - 1 : Math.max(0, sel - 1); nudge = false; MQ.Sound.click(); render(); }
      else if (k === 'ArrowRight') { sel = sel < 0 ? Math.floor(mid) + 1 : Math.min(n - 1, sel + 1); nudge = false; MQ.Sound.click(); render(); }
      else if (k === 'Enter' || k === ' ') {
        if (sel < 0) { nudge = true; MQ.Sound.click(); render(); return; }
        answer();
      }
    };

    render();
    MQ.Voice.say(q.speak, 'en-US', { interrupt: true });
  }

  function nextLevel() {
    newLevel();
    showIntro();
  }

  // ---------- Overlays ----------
  let overlayKeys = null;
  function showOverlay(html, keys) {
    overlay.innerHTML = html;
    overlay.hidden = false;
    overlayKeys = keys;
  }
  function hideOverlay() {
    overlay.hidden = true;
    overlay.innerHTML = '';
    overlayKeys = null;
  }
  // The big Start / Next button on a card (touch). Only the first tap counts.
  function onGo(fn) {
    const b = overlay.querySelector('[data-go]');
    if (!b) return;
    b.addEventListener('click', (e) => {
      e.preventDefault();
      if (b.disabled) return;
      b.disabled = true;
      MQ.Sound.click();
      fn();
    });
  }

  function showIntro() {
    state = 'intro';
    const legend = cfg.denoms.map((v) => `<div>${coinChip(v)}<span>${COINS[v].name}</span></div>`).join('');
    const first = g.played === 0;
    const zh = data.settings.chinese ? `<div class="goal-zh zh">${MQ.zhMoney(target)}</div>` : '';
    const convert = targetFmt !== pouchFmt
      ? `<p class="hint">🧠 Tricky! The castle counts in ${targetFmt === 'dollars' ? 'dollars' : 'cents'}, your pouch counts in ${pouchFmt === 'dollars' ? 'dollars' : 'cents'}.</p>`
      : '';
    showOverlay(`
      <div class="card">
        <h1>${hero} Level ${g.level}</h1>
        <p>Collect coins that add up to <b>exactly</b></p>
        <div class="goal">${MQ.money(target, targetFmt)}</div>
        ${zh}
        ${convert}
        <div class="legend">${legend}</div>
        ${first ? `<p class="hint keys-only">Hop with the arrow keys. Stay away from the cars! 🚗<br>Grabbed the wrong coin? Press <span class="key">space</span> to put it back.<br>When you have the exact amount, hop into the castle 🏰 at the top.</p>
        <p class="hint touch-only">Tap to hop, swipe to turn. Stay away from the cars! 🚗<br>Wrong coin? Tap <b>↩ Put back</b>.<br>Exact amount? Hop into the castle 🏰!</p>` : ''}
        <div class="press keys-only">Press <span class="key">return</span> to start</div>
        <button class="btn go touch-only" data-go>Start ▶</button>
      </div>`,
      (k) => { if (k === 'Enter' || k === ' ') startPlay(); }
    );
    onGo(startPlay);
    MQ.Voice.say(`Level ${g.level}. Collect exactly ${MQ.moneyWords(target)}.`, 'en-US', { interrupt: true });
    if (first) MQ.Voice.say(touchUI() ? 'Tap to hop. Watch out for the cars! When you have exactly the right money, hop into the castle.' : 'Hop with the arrow keys. Watch out for the cars! When you have exactly the right money, hop into the castle.', 'en-US');
    if (data.settings.chinese) MQ.Voice.say(MQ.zhMoney(target), 'zh-CN');
    say(`Collect exactly ${MQ.money(target, targetFmt)}!`);
  }

  function startPlay() {
    if (state !== 'intro') return;
    hideOverlay();
    state = 'play';
    MQ.Sound.click();
    say(`Collect exactly ${MQ.money(target, targetFmt)}, then hop into the castle!`);
    maybeShowTouchHint();
  }

  function showPause() {
    state = 'pause';
    let sel = 0;
    const items = [['▶ Keep playing', () => { hideOverlay(); state = 'play'; }], ['🏠 Back to the portal', () => { persist(); location.href = '../../index.html'; }]];
    const render = () => {
      showOverlay(`
        <div class="card">
          <h2>⏸ Paused</h2>
          <div class="menu">${items.map((it, i) => `<button class="btn ${i === 0 ? '' : 'secondary'} ${i === sel ? 'sel' : ''}" data-i="${i}">${it[0]}</button>`).join('')}</div>
          <div class="press keys-only">Use <span class="key">↑</span> <span class="key">↓</span> and <span class="key">return</span></div>
        </div>`,
        (k) => {
          if (k === 'ArrowUp' || k === 'ArrowDown') { sel = 1 - sel; render(); }
          else if (k === 'Enter' || k === ' ') items[sel][1]();
          else if (k === 'Escape') items[0][1]();
        });
      overlay.querySelectorAll('.menu .btn').forEach((b) => b.addEventListener('click', () => items[Number(b.dataset.i)][1]()));
    };
    render();
  }

  // ---------- Update loop ----------
  function cellCenter(r, c) { return { x: c * CELL + CELL / 2, y: rowMid(r) }; }

  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 60 + Math.random() * 180;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 80, life: 0.8 + Math.random() * 0.5, color, size: 3 + Math.random() * 4 });
    }
  }

  function update(dt) {
    time += dt;
    const gateGoal = total() === target ? 1 : 0;
    gateLift += Math.sign(gateGoal - gateLift) * Math.min(Math.abs(gateGoal - gateLift), dt * 2.5);
    for (const c of coins) {
      if (c.fly) { c.fly.t += dt / 0.35; if (c.fly.t >= 1) c.fly = null; }
    }

    if (state === 'play') {
      stats.seconds += dt;
      g.seconds += dt;
      data.playSeconds += dt;
      if (time - lastSaveAt > 15) { lastSaveAt = time; persist(); }
    }

    if (state === 'play' || state === 'intro' || state === 'won') {
      for (const lane of lanes) {
        for (const car of lane.cars) {
          car.x += lane.dir * lane.speed * dt;
          if (lane.dir > 0 && car.x > COLS + 2) car.x -= lane.span;
          if (lane.dir < 0 && car.x + car.len < -2) car.x += lane.span;
        }
      }
    }

    if (state === 'play') {
      const low = player.r < ROWS / 2;
      if (low !== toastLow) { toastLow = low; el('bubble').classList.toggle('low', low); }
      if (player.t < 1) {
        player.t = Math.min(1, player.t + dt / HOP_TIME);
        if (player.t === 1) onLand();
      }
      if (player.inv > 0) player.inv -= dt;
      if (player.land > 0) player.land -= dt;
      const lane = laneByRow[player.r];
      if (lane && player.inv <= 0 && state === 'play') {
        const x0 = player.c + 0.22;
        const x1 = player.c + 0.78;
        if (lane.cars.some((car) => car.x < x1 && car.x + car.len > x0)) bonk();
      }
    }

    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.dust ? 40 : 400) * dt; p.life -= dt; }
    particles = particles.filter((p) => p.life > 0);
    for (const f of floaters) { f.y -= 40 * dt; f.life -= dt; }
    floaters = floaters.filter((f) => f.life > 0);
  }

  // ---------- Drawing ----------
  function roundRect(x, y, w, h, r, c = ctx) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function seeded(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }

  // The ground (grass, roads, curbs, flowers) is painted once per level onto an offscreen canvas.
  let bgCanvas = null;
  let bgSeed = 1;

  function buildBackground() {
    bgCanvas = document.createElement('canvas');
    bgCanvas.width = Math.max(1, Math.round(W * pixelScale));
    bgCanvas.height = Math.max(1, Math.round(H * pixelScale));
    const b = bgCanvas.getContext('2d');
    b.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
    const rnd = seeded(bgSeed);
    const isRoad = (r) => !!laneByRow[r];

    for (let r = 1; r < ROWS; r++) {
      const y = rowTop(r);
      if (isRoad(r)) {
        const asphalt = b.createLinearGradient(0, y, 0, y + CELL);
        asphalt.addColorStop(0, '#5d636c'); asphalt.addColorStop(1, '#4f555d');
        b.fillStyle = asphalt;
        b.fillRect(0, y, W, CELL);
        for (let i = 0; i < 260; i++) {
          b.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.10)';
          b.fillRect(rnd() * W, y + rnd() * CELL, 1.5, 1.5);
        }
        // Stone curbs where the road meets grass
        for (const [edge, yy] of [[r - 1, y], [r + 1, y + CELL - 6]]) {
          if (isRoad(edge) || edge === BANK_ROW) continue;
          b.fillStyle = '#c9c2b3';
          b.fillRect(0, yy, W, 6);
          b.fillStyle = 'rgba(0,0,0,0.12)';
          for (let x = 0; x < W; x += 24) b.fillRect(x, yy, 2, 6);
        }
        if (isRoad(r + 1)) {
          b.fillStyle = 'rgba(255,245,200,0.75)';
          for (let x = 10; x < W; x += 52) { roundRect(x, y + CELL - 2.5, 28, 5, 2.5, b); b.fill(); }
        }
      } else {
        const start = r === START_ROW;
        const base = start ? ['#a9e38d', '#a0dc83'] : r % 2 ? ['#83d464', '#7bcb5c'] : ['#8bda6b', '#83d263'];
        for (let c = 0; c < COLS; c++) {
          b.fillStyle = base[(c + r) % 2];
          b.fillRect(c * CELL, y, CELL, CELL);
        }
        // Soft light from the top of each grass band
        const sheen = b.createLinearGradient(0, y, 0, y + CELL);
        sheen.addColorStop(0, 'rgba(255,255,255,0.10)'); sheen.addColorStop(1, 'rgba(0,0,0,0.04)');
        b.fillStyle = sheen;
        b.fillRect(0, y, W, CELL);
        // Grass tufts, tiny flowers and pebbles
        for (let c = 0; c < COLS; c++) {
          const tufts = 2 + Math.floor(rnd() * 3);
          for (let k = 0; k < tufts; k++) {
            const tx = c * CELL + 6 + rnd() * (CELL - 12);
            const ty = y + 8 + rnd() * (CELL - 14);
            b.strokeStyle = start ? 'rgba(70,140,50,0.45)' : 'rgba(60,130,40,0.5)';
            b.lineWidth = 1.6;
            b.lineCap = 'round';
            for (const dx of [-3, 0, 3]) { b.beginPath(); b.moveTo(tx + dx * 0.4, ty + 5); b.quadraticCurveTo(tx + dx, ty + 1, tx + dx * 1.3, ty - 2); b.stroke(); }
          }
          const roll = rnd();
          if (roll < 0.14) {
            const fx = c * CELL + 10 + rnd() * (CELL - 20);
            const fy = y + 10 + rnd() * (CELL - 20);
            const petal = ['#ffffff', '#ffd6e8', '#fff3a3', '#d9c8ff'][Math.floor(rnd() * 4)];
            b.fillStyle = petal;
            for (let a = 0; a < 5; a++) { b.beginPath(); b.arc(fx + Math.cos(a * 1.257) * 3, fy + Math.sin(a * 1.257) * 3, 2.4, 0, Math.PI * 2); b.fill(); }
            b.fillStyle = '#ffb703';
            b.beginPath(); b.arc(fx, fy, 1.8, 0, Math.PI * 2); b.fill();
          } else if (roll < 0.2) {
            b.fillStyle = 'rgba(120,110,95,0.35)';
            b.beginPath(); b.ellipse(c * CELL + 12 + rnd() * 40, y + 14 + rnd() * 36, 3.5, 2.5, 0, 0, Math.PI * 2); b.fill();
          }
        }
        // Shadow cast onto the grass by a curb just above
        if (isRoad(r - 1)) {
          const sh = b.createLinearGradient(0, y, 0, y + 10);
          sh.addColorStop(0, 'rgba(0,0,0,0.14)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
          b.fillStyle = sh;
          b.fillRect(0, y, W, 10);
        }
        if (start) {
          // A little stone pad where the hero starts
          b.fillStyle = 'rgba(255,255,255,0.35)';
          roundRect(START_COL * CELL + 6, y + 6, CELL - 12, CELL - 12, 12, b); b.fill();
          b.strokeStyle = 'rgba(120,100,70,0.25)'; b.lineWidth = 2; b.stroke();
          b.font = `20px ${EMOJI_FONT}`;
          b.fillStyle = '#000';
          b.textAlign = 'center'; b.textBaseline = 'middle';
          for (let c = 0; c < COLS; c += 2) if (Math.abs(c - START_COL) >= 2) b.fillText(c % 4 === 0 ? '🌷' : '🌼', c * CELL + 32, y + 34);
        }
      }
    }
  }

  function drawRows() {
    if (!bgCanvas) buildBackground();
    ctx.drawImage(bgCanvas, 0, 0, W, H);
  }

  // Slow cloud shadows and a couple of butterflies keep the scene gently alive.
  // Spread over the board, whatever its shape (736 = the laptop board's height).
  let clouds = [];
  let butterflies = [];
  function initAmbient() {
    const k = H / 736;
    clouds = [0, 1, 2].map((i) => ({ x: i * (W / 2.6) + Math.random() * 100, y: (220 + i * 170) * k, s: (0.8 + Math.random() * 0.6) * Math.min(1, W / 832 + 0.2) }));
    butterflies = [0, 1].map((i) => ({ x: Math.random() * W, y: (240 + Math.random() * 300) * k, phase: Math.random() * 6, dir: i ? 1 : -1 }));
  }

  function drawAmbient(dt) {
    for (const cl of clouds) {
      cl.x += 8 * dt;
      if (cl.x > W + 200) cl.x = -200;
      ctx.fillStyle = 'rgba(20,40,60,0.07)';
      ctx.beginPath();
      ctx.ellipse(cl.x, cl.y, 110 * cl.s, 34 * cl.s, 0, 0, Math.PI * 2);
      ctx.ellipse(cl.x + 60 * cl.s, cl.y - 14 * cl.s, 70 * cl.s, 28 * cl.s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.font = `18px ${EMOJI_FONT}`;
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const bf of butterflies) {
      bf.x += bf.dir * 18 * dt;
      if (bf.x > W + 30) bf.x = -30;
      if (bf.x < -30) bf.x = W + 30;
      const flap = 0.6 + 0.4 * Math.abs(Math.sin(time * 9 + bf.phase));
      ctx.save();
      ctx.translate(bf.x, bf.y + Math.sin(time * 1.3 + bf.phase) * 30);
      ctx.scale(flap * bf.dir, 1);
      ctx.globalAlpha = 0.85;
      ctx.fillText('🦋', 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function bricks(x, y, w, h, color, mortar) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.strokeStyle = mortar;
    ctx.lineWidth = 2;
    for (let row = 0, by = y; by < y + h; row++, by += 16) {
      ctx.beginPath(); ctx.moveTo(x, by); ctx.lineTo(x + w, by); ctx.stroke();
      for (let bx = x + (row % 2) * 16; bx < x + w; bx += 32) { ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx, by + 16); ctx.stroke(); }
    }
    ctx.restore();
  }

  function merlons(x, y, w, color) {
    ctx.fillStyle = color;
    for (let mx = x; mx < x + w - 4; mx += 28) ctx.fillRect(mx, y, 16, 14);
  }

  // A wooden sign; the text shrinks to fit narrow signs. (w 176 × h 60 is the laptop size.)
  function sign(cx, cy, title, big, color, w = 176, h = 60) {
    roundRect(cx - w / 2, cy - h / 2, w, h, 10);
    ctx.fillStyle = '#fff4d6'; ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = '#8a5a2b'; ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const fit = (text, weight, px) => {
      ctx.font = `${weight} ${px}px ${UI_FONT}`;
      const tw = ctx.measureText(text).width;
      if (tw > w - 14) ctx.font = `${weight} ${Math.floor(px * (w - 14) / tw)}px ${UI_FONT}`;
    };
    ctx.fillStyle = '#8a5a2b';
    fit(title, 800, Math.round(h * 13 / 60));
    ctx.fillText(title, cx, cy - h / 4);
    ctx.fillStyle = color;
    fit(big, 900, Math.round(h * 26 / 60));
    ctx.fillText(big, cx, cy + h * 0.15);
  }

  // The castle is designed 160 units tall. On shorter castle bands it is drawn scaled down
  // (s < 1) across a correspondingly wider design width CW; narrow boards get slimmer parts.
  function drawCastle() {
    const s = CASTLE_H / 160;
    ctx.save();
    ctx.scale(s, s);
    drawCastleParts(W / s, 160);
    ctx.restore();
  }

  function drawCastleParts(W, CASTLE_H) {
    const open = total() === target;
    const brick = '#c96a4a';
    const mortar = 'rgba(90,30,20,0.35)';
    const slim = W < 800;
    const towerW = slim ? 84 : 100;
    const towerX = slim ? 48 : 70;

    // Sky behind the castle
    const sky = ctx.createLinearGradient(0, 0, 0, CASTLE_H);
    sky.addColorStop(0, '#a9ddff'); sky.addColorStop(1, '#dff3ff');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, CASTLE_H);

    // Long outer wall
    bricks(0, 62, W, CASTLE_H - 62, brick, mortar);
    merlons(0, 48, W, brick);

    // Corner towers with pointy roofs and flags
    for (const tx of [towerX, W - towerX]) {
      bricks(tx - towerW / 2, 40, towerW, CASTLE_H - 40, '#b85c3e', mortar);
      ctx.fillStyle = '#e0473c';
      ctx.beginPath(); ctx.moveTo(tx - towerW / 2 - 8, 42); ctx.lineTo(tx + towerW / 2 + 8, 42); ctx.lineTo(tx, -6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#3b2a25';
      roundRect(tx - 12, 70, 24, 34, 12); ctx.fill();
    }

    // Central keep
    const kw = slim ? 230 : 300;
    const kx = W / 2 - kw / 2;
    bricks(kx, 22, kw, CASTLE_H - 22, '#d7795a', mortar);
    merlons(kx, 8, kw, '#d7795a');
    for (const fx of [kx + 30, kx + kw - 30]) {
      ctx.fillStyle = '#6b4a2b'; ctx.fillRect(fx - 2, -4, 4, 30);
      ctx.fillStyle = fx < W / 2 ? '#ffcf33' : '#4aa8ff';
      const wave = Math.sin(time * 4 + fx) * 3;
      ctx.beginPath(); ctx.moveTo(fx + 2, -2); ctx.lineTo(fx + 26, 6 + wave); ctx.lineTo(fx + 2, 14); ctx.closePath(); ctx.fill();
    }

    // Gate: an arch with a portcullis that rises when the amount is exactly right.
    const gw = slim ? 124 : 140;
    const gx = W / 2 - gw / 2;
    const gTop = 44;
    const archR = gw / 2;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(gx, CASTLE_H);
    ctx.lineTo(gx, gTop + archR);
    ctx.arc(W / 2, gTop + archR, archR, Math.PI, 0);
    ctx.lineTo(gx + gw, CASTLE_H);
    ctx.closePath();
    ctx.fillStyle = open ? '#ffe27a' : '#3a2a22';
    ctx.fill();
    ctx.lineWidth = 6; ctx.strokeStyle = '#7a3b26'; ctx.stroke();
    ctx.clip();
    if (gateLift > 0) {
      const inner = ctx.createRadialGradient(W / 2, CASTLE_H - 20, 5, W / 2, CASTLE_H - 20, 120);
      inner.addColorStop(0, `rgba(255,255,255,${0.9 * gateLift})`);
      inner.addColorStop(1, 'rgba(255,200,0,0)');
      ctx.fillStyle = inner;
      ctx.fillRect(gx, gTop, gw, CASTLE_H - gTop);
      ctx.font = `30px ${EMOJI_FONT}`;
      ctx.fillStyle = '#000';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = gateLift;
      ctx.fillText('💰', W / 2 - 34, CASTLE_H - 22);
      ctx.fillText('👑', W / 2 + 34, CASTLE_H - 24);
      ctx.fillText('✨', W / 2, gTop + 40 + Math.sin(time * 5) * 4);
      ctx.globalAlpha = 1;
    }
    // Portcullis bars slide up as gateLift goes 0 → 1
    const lift = gateLift * (CASTLE_H - gTop);
    ctx.strokeStyle = '#8d8f94';
    ctx.lineWidth = 6;
    for (let bx = gx + 14; bx < gx + gw; bx += 22) {
      ctx.beginPath(); ctx.moveTo(bx, gTop - lift); ctx.lineTo(bx, CASTLE_H - lift); ctx.stroke();
    }
    ctx.lineWidth = 5;
    for (let by = gTop + 30; by < CASTLE_H; by += 26) {
      ctx.beginPath(); ctx.moveTo(gx, by - lift); ctx.lineTo(gx + gw, by - lift); ctx.stroke();
    }
    ctx.restore();

    if (gateLift < 1) {
      ctx.font = `36px ${EMOJI_FONT}`;
      ctx.fillStyle = '#000';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = 1 - gateLift;
      ctx.fillText('🔒', W / 2, CASTLE_H - 40);
      ctx.globalAlpha = 1;
    }

    // Signs on either side of the gate (smaller ones between the towers and keep on a narrow board)
    if (slim) {
      const sw = Math.min(150, W / 2 - kw / 2 - (towerX + towerW / 2) - 10);
      const scx = (towerX + towerW / 2 + W / 2 - kw / 2) / 2;
      sign(scx, 108, 'NEEDS', MQ.money(target, targetFmt), '#b3471a', sw, 64);
      sign(W - scx, 108, 'GATE', open ? 'OPEN ⬆' : 'LOCKED', open ? '#2e9e5b' : '#6b6475', sw, 64);
    } else if (W > 1000) {
      // Landscape phone: a very wide, short castle, so the signs can be bigger.
      sign(250, 100, 'CASTLE NEEDS', MQ.money(target, targetFmt), '#b3471a', 240, 84);
      sign(W - 250, 100, 'THE GATE IS', open ? 'OPEN! ⬆' : 'LOCKED', open ? '#2e9e5b' : '#6b6475', 240, 84);
    } else {
      sign(230, 104, 'CASTLE NEEDS', MQ.money(target, targetFmt), '#b3471a');
      sign(W - 230, 104, 'THE GATE IS', open ? 'OPEN! ⬆' : 'LOCKED', open ? '#2e9e5b' : '#6b6475');
    }

    // Golden doorstep glows along the whole wall when open (any column can enter).
    if (open) {
      ctx.fillStyle = `rgba(255,215,0,${0.55 + 0.35 * Math.sin(time * 6)})`;
      ctx.fillRect(0, CASTLE_H - 8, W, 8);
    }
  }

  function drawCoin(v, x, y, scale = 1, seed = 0) {
    const k = COINS[v];
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(0, 22, 17, 5, 0, 0, Math.PI * 2); ctx.fill();
    if (k.bill) {
      ctx.rotate(-0.06);
      roundRect(-25, -15, 50, 30, 5);
      const paper = ctx.createLinearGradient(0, -15, 0, 15);
      paper.addColorStop(0, shade(k.fill, 0.08)); paper.addColorStop(1, shade(k.fill, -0.06));
      ctx.fillStyle = paper; ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = k.edge; ctx.stroke();
      roundRect(-20, -10, 40, 20, 3);
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.ellipse(0, 0, 9, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = k.text;
      ctx.font = `900 15px ${UI_FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`$${v / 100}`, 0, 1);
    } else {
      // Rim, face gradient, ridges on dimes & quarters, and a soft highlight
      ctx.fillStyle = k.lo;
      ctx.beginPath(); ctx.arc(0, 1.5, k.r, 0, Math.PI * 2); ctx.fill();
      const face = ctx.createRadialGradient(-k.r * 0.35, -k.r * 0.45, 1, 0, 0, k.r);
      face.addColorStop(0, k.hi); face.addColorStop(0.55, k.mid); face.addColorStop(1, k.lo);
      ctx.fillStyle = face;
      ctx.beginPath(); ctx.arc(0, 0, k.r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath(); ctx.arc(0, 0, k.r - 3, 0, Math.PI * 2); ctx.stroke();
      if (v === 10 || v === 25) {
        ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1;
        for (let a = 0; a < Math.PI * 2; a += 0.22) {
          ctx.beginPath(); ctx.moveTo(Math.cos(a) * (k.r - 1.5), Math.sin(a) * (k.r - 1.5)); ctx.lineTo(Math.cos(a) * k.r, Math.sin(a) * k.r); ctx.stroke();
        }
      }
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.ellipse(-k.r * 0.35, -k.r * 0.45, k.r * 0.35, k.r * 0.18, -0.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = k.text;
      ctx.font = `900 ${v >= 10 ? 12 : 13}px ${UI_FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`${v}¢`, 0, 1);
    }
    // Occasional twinkle
    const tw = Math.sin(time * 1.7 + seed * 3.1);
    if (tw > 0.93) {
      const a = (tw - 0.93) / 0.07;
      ctx.globalAlpha = a;
      ctx.fillStyle = '#fff';
      const sx = 10, sy = -12, L = 8 * a + 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy - L); ctx.lineTo(sx + 2, sy - 2); ctx.lineTo(sx + L, sy); ctx.lineTo(sx + 2, sy + 2);
      ctx.lineTo(sx, sy + L); ctx.lineTo(sx - 2, sy + 2); ctx.lineTo(sx - L, sy); ctx.lineTo(sx - 2, sy - 2); ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawCoins() {
    for (const c of coins) {
      if (c.taken) continue;
      const home = cellCenter(c.r, c.c);
      if (c.fly) {
        const t = ease(c.fly.t);
        drawCoin(c.v, lerp(c.fly.x, home.x, t), lerp(c.fly.y, home.y, t) - Math.sin(Math.PI * t) * 50, 1, c.bob);
      } else {
        drawCoin(c.v, home.x, home.y + Math.sin(time * 3 + c.bob) * 3, 1, c.bob);
      }
    }
  }

  // Top-down cars: glossy body, glass cabin, wheels, headlight beams. Long vehicles are buses.
  function drawCar(car, lane) {
    const y = rowTop(lane.row);
    const x = car.x * CELL + 5;
    const w = car.len * CELL - 10;
    const front = lane.dir > 0 ? x + w : x;
    const fwd = lane.dir;
    const bus = car.len > 1;
    const color = bus ? '#ffc93c' : car.color;

    // Headlight beams
    const beam = ctx.createLinearGradient(front, 0, front + fwd * 34, 0);
    beam.addColorStop(0, 'rgba(255,245,170,0.35)'); beam.addColorStop(1, 'rgba(255,245,170,0)');
    ctx.fillStyle = beam;
    for (const by of [y + 20, y + 44]) {
      ctx.beginPath(); ctx.moveTo(front, by - 3); ctx.lineTo(front + fwd * 34, by - 9); ctx.lineTo(front + fwd * 34, by + 9); ctx.lineTo(front, by + 3); ctx.closePath(); ctx.fill();
    }
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    roundRect(x + 3, y + 13, w, 44, 12); ctx.fill();
    // Wheels peek out on both sides
    ctx.fillStyle = '#23262b';
    for (const wx of bus ? [x + 12, x + w / 2 - 6, x + w - 26] : [x + 9, x + w - 23]) {
      roundRect(wx, y + 6, 14, 8, 3); ctx.fill();
      roundRect(wx, y + 50, 14, 8, 3); ctx.fill();
    }
    // Body
    const body = ctx.createLinearGradient(0, y + 10, 0, y + 54);
    body.addColorStop(0, shade(color, 0.18)); body.addColorStop(0.5, color); body.addColorStop(1, shade(color, -0.18));
    ctx.fillStyle = body;
    roundRect(x, y + 10, w, 44, 13); ctx.fill();
    ctx.strokeStyle = shade(color, -0.3); ctx.lineWidth = 1.5; ctx.stroke();

    const glass = ctx.createLinearGradient(0, y + 16, 0, y + 48);
    glass.addColorStop(0, '#d9f1ff'); glass.addColorStop(1, '#7fb3d6');
    if (bus) {
      ctx.fillStyle = shade(color, 0.12);
      roundRect(x + 8, y + 15, w - 16, 34, 8); ctx.fill();
      ctx.fillStyle = glass;
      const n = 5;
      const ww = (w - 30) / n;
      for (let i = 0; i < n; i++) { roundRect(x + 15 + i * ww, y + 18, ww - 5, 9, 3); ctx.fill(); roundRect(x + 15 + i * ww, y + 37, ww - 5, 9, 3); ctx.fill(); }
      ctx.fillStyle = '#2b2b2b';
      ctx.fillRect(x + 12, y + 30, w - 24, 3);
    } else {
      // Windshield toward the front, rear window toward the back, roof in between
      const wsx = fwd > 0 ? x + w * 0.56 : x + w * 0.14;
      const rwx = fwd > 0 ? x + w * 0.16 : x + w * 0.66;
      ctx.fillStyle = glass;
      roundRect(wsx, y + 16, w * 0.3, 32, 7); ctx.fill();
      roundRect(rwx, y + 18, w * 0.18, 28, 6); ctx.fill();
      ctx.fillStyle = shade(color, 0.08);
      roundRect(x + w * 0.3, y + 17, w * 0.36, 30, 8); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      roundRect(x + w * 0.33, y + 19, w * 0.3, 6, 3); ctx.fill();
    }
    // Head- and tail-lights
    ctx.fillStyle = '#fff6b0';
    const hx = fwd > 0 ? x + w - 5 : x + 1;
    roundRect(hx, y + 15, 4, 8, 2); ctx.fill();
    roundRect(hx, y + 41, 4, 8, 2); ctx.fill();
    ctx.fillStyle = '#ff5a5a';
    const tx = fwd > 0 ? x + 1 : x + w - 5;
    roundRect(tx, y + 16, 4, 6, 2); ctx.fill();
    roundRect(tx, y + 42, 4, 6, 2); ctx.fill();
  }

  function drawCars() {
    for (const lane of lanes) for (const car of lane.cars) drawCar(car, lane);
  }

  function drawPlayer() {
    const e = ease(player.t);
    const x = lerp(player.fromC, player.c, e) * CELL + CELL / 2;
    const yGround = lerp(rowMid(player.fromR), rowMid(player.r), e);
    const hop = Math.sin(Math.PI * player.t) * 18;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(x, yGround + 22, 18 - hop * 0.3, 6, 0, 0, Math.PI * 2); ctx.fill();
    if (player.inv > 0 && Math.floor(player.inv * 10) % 2 === 0) return;
    // Squash on landing, stretch in the air
    let sx = 1, sy = 1;
    if (player.t < 1) { sx = 0.94; sy = 1.08; }
    else if (player.land > 0) { const q = player.land / 0.16; sx = 1 + 0.14 * q; sy = 1 - 0.14 * q; }
    // Idle breathing
    const breathe = player.t >= 1 && player.land <= 0 ? 1 + Math.sin(time * 3) * 0.02 : 1;
    ctx.save();
    ctx.translate(x, yGround + 16 - hop);
    ctx.scale(sx, sy * breathe);
    ctx.font = `46px ${EMOJI_FONT}`;
    ctx.fillStyle = '#000'; // color emoji inherit the fill's opacity
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(hero, 0, -2);
    ctx.restore();
  }

  function drawEffects() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
      ctx.fillStyle = p.color;
      if (p.dust) { ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill(); }
      else ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 24px ${UI_FONT}`;
    for (const f of floaters) {
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life * 1.5));
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#fff';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color || '#e07b00';
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  function draw(dt) {
    ctx.clearRect(0, 0, W, H);
    drawRows();
    drawCastle();
    drawCoins();
    drawCars();
    drawPlayer();
    drawAmbient(dt);
    drawEffects();
    drawRipples(dt);
  }

  // A soft ring where a finger tapped, so every tap visibly "did something".
  function drawRipples(dt) {
    for (const rp of ripples) {
      rp.life -= dt * 2.5;
      if (rp.life <= 0) continue;
      ctx.globalAlpha = rp.life * 0.8;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(rp.x, rp.y, 14 + (1 - rp.life) * 26, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ripples = ripples.filter((rp) => rp.life > 0);
  }

  // ---------- Sizing (crisp on Retina screens) ----------
  let pixelScale = 1;
  function resize() {
    let availW, availH, minScale = 0.4;
    if (layout === 'desk') {
      const narrow = window.innerWidth <= 860;
      availW = narrow ? window.innerWidth - 24 : window.innerWidth - 300 - 20 - 36;
      availH = narrow ? window.innerHeight * 0.7 : window.innerHeight - 24;
    } else {
      // Phones: the board fills whatever the grid gives the stage area.
      availW = wrap.clientWidth;
      availH = wrap.clientHeight;
      minScale = 0.2;
    }
    const scale = Math.max(minScale, Math.min(availW / W, availH / H, 1.5));
    document.documentElement.style.setProperty('--board-w', `${Math.round(W * scale)}px`);
    const dpr = window.devicePixelRatio || 1;
    stage.style.width = `${Math.round(W * scale)}px`;
    stage.style.height = `${Math.round(H * scale)}px`;
    canvas.style.width = `${Math.round(W * scale)}px`;
    canvas.style.height = `${Math.round(H * scale)}px`;
    canvas.width = Math.round(W * scale * dpr);
    canvas.height = Math.round(H * scale * dpr);
    pixelScale = scale * dpr;
    ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
    bgCanvas = null; // repaint the ground at the new size
  }

  // Rotating the phone switches layout. Before play starts the board is rebuilt to the new
  // shape (same target); mid-level the board is kept and just rescaled, so nothing jumps.
  let relayoutQueued = false;
  function relayout() {
    relayoutQueued = false;
    const next = layoutFor();
    if (next !== layout) {
      layout = next;
      applyLayoutClass();
      if (state === 'intro' && gridKey !== layout) buildBoard();
    }
    resize();
  }
  function queueRelayout() {
    if (relayoutQueued) return;
    relayoutQueued = true;
    requestAnimationFrame(relayout);
  }
  window.addEventListener('resize', queueRelayout);
  window.addEventListener('orientationchange', () => { queueRelayout(); setTimeout(relayout, 300); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', queueRelayout);

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    draw(dt);
    requestAnimationFrame(frame);
  }

  window.addEventListener('beforeunload', persist);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { persist(); if (state === 'play') showPause(); }
  });

  // Small hook for automated tests.
  window.__coinCrossing = { quiz: QUIZ, get state() { return state; }, get target() { return target; }, get coins() { return coins; }, get player() { return player; }, total, get level() { return g.level; }, get layout() { return layout; }, get lanes() { return lanes; }, get grid() { return { cols: COLS, rows: ROWS, castle: CASTLE_H, w: W, h: H }; }, startQuiz };

  syncMusicBtn();
  resize();
  MQ.Music.play('prelude');
  newLevel();
  showIntro();
  requestAnimationFrame(frame);
})();
