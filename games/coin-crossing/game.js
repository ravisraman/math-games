/* Coin Crossing — hop across roads, collect coins that add up to exactly the castle's
   target amount, then hop into the castle. Difficulty adapts to how each level went. */
(function () {
  'use strict';

  const COLS = 9;
  const ROWS = 11;
  const CELL = 64;
  const W = COLS * CELL;
  const H = ROWS * CELL;
  const BANK_ROW = 0;
  const START_ROW = ROWS - 1;
  const START_COL = 4;
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
    c.roads = Math.min(2 + Math.floor((L - 1) / 2), 6);
    c.speed = Math.min(1.0 + 0.12 * (L - 1), 3.4);
    c.maxCars = L <= 2 ? 1 : L <= 6 ? 2 : 3;
    c.buses = L >= 5;
    c.extras = Math.min(3 + Math.floor(L / 3), 7);
    c.showNeed = L <= 4;
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

  function total() { return pouch.reduce((s, c) => s + c.v, 0); }

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

    // Lanes: row 0 is the castle, the bottom row is the safe start, some middle rows are roads.
    const middle = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const roadRows = new Set(middle.slice(0, cfg.roads));
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
    for (let r = 1; r <= 9; r++) for (let c = 0; c < COLS; c++) cells.push({ r, c });
    shuffle(cells);
    coins = values.map((v, i) => ({
      v, r: cells[i].r, c: cells[i].c, taken: false, warned: false, bob: Math.random() * 6, fly: null,
    }));

    player = { r: START_ROW, c: START_COL, fromR: START_ROW, fromC: START_COL, t: 1, inv: 0 };
    pouch = [];
    stats = { overshoots: 0, bonks: 0, putBacks: 0, seconds: 0 };
    needRevealed = cfg.showNeed;
    particles = [];
    floaters = [];
    queuedMove = null;
    updateHud();
  }

  function makeLane(row) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    const speed = cfg.speed * (0.75 + Math.random() * 0.5);
    const n = rand(1, cfg.maxCars);
    const span = COLS + 4;
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
    need.classList.toggle('done', t === target);
    if (t === target) need.textContent = '✅ Exactly right! Hop to the castle ⬆';
    else if (needRevealed) need.textContent = `Need ${MQ.money(target - t, targetFmt)} more`;
    else need.textContent = 'How much more do you need? 🤔';
  }

  function say(text, { speak = false } = {}) {
    el('message').textContent = text;
    const b = el('bubble');
    b.classList.remove('pop');
    void b.offsetWidth;
    b.classList.add('pop');
    if (speak) MQ.Voice.say(text.replace(/\p{Extended_Pictographic}/gu, ''), 'en-US', { interrupt: true });
  }

  // ---------- Input ----------
  const DIRS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

  window.addEventListener('keydown', (e) => {
    const k = e.key;
    if (DIRS[k] || k === ' ' || k === 'Enter' || k === 'Escape') e.preventDefault();
    MQ.Sound.ensure();

    if (state === 'play') {
      if (DIRS[k] && !e.repeat) tryMove(...DIRS[k]);
      else if (k === ' ' && !e.repeat) putBack();
      else if (k === 'Escape' || k === 'p') showPause();
      return;
    }
    if (overlayKeys) overlayKeys(k, e);
  });

  function tryMove(dr, dc) {
    if (player.t < 1) { queuedMove = [dr, dc]; return; }
    const nr = player.r + dr;
    const nc = player.c + dc;
    if (nc < 0 || nc >= COLS || nr > START_ROW || nr < BANK_ROW) return;
    if (nr === BANK_ROW && total() !== target) {
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
    MQ.Sound.hop();
  }

  function onLand() {
    if (player.r === BANK_ROW) { win(); return; }
    const coin = coins.find((c) => !c.taken && !c.fly && c.r === player.r && c.c === player.c);
    if (coin) touchCoin(coin);
    if (queuedMove) { const m = queuedMove; queuedMove = null; tryMove(...m); }
  }

  function touchCoin(coin) {
    const t = total();
    const name = COINS[coin.v].name;
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
    MQ.Sound.coin();
    const { x, y } = cellCenter(coin.r, coin.c);
    burst(x, y, coin.v >= 100 ? '#6fcf6f' : '#ffd23f', 14);
    floaters.push({ x, y: y - 20, text: `+${coin.v >= 100 ? MQ.dollars(coin.v) : coin.v + '¢'}`, life: 1 });
    const now = total();
    updateHud();
    if (now === target) {
      MQ.Sound.open();
      say(`You made ${MQ.money(now, targetFmt)}! The castle gate is open — hop to the top! ⬆`, { speak: true });
    } else {
      const left = coins.filter((c) => !c.taken).map((c) => c.v);
      if (!canMake(target - now, left)) {
        say(`Hmm… the coins left can't make exactly ${MQ.money(target, targetFmt)}. Press SPACE to put a coin back.`);
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
    say(stats.bonks >= 3 ? `${MQ.CHEER.zh} (${MQ.CHEER.py}) Wait for a gap, then hop! Your coins are safe.` : 'Bonk! Back to the start — your coins are safe.');
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
        <div class="press">Press <span class="key">return</span> for a bonus question ⭐</div>
      </div>`,
      (k) => { if (k === 'Enter' || k === ' ') startQuiz(); }
    );
    MQ.Sound.star();
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
    let sel = 1;
    let done = false;

    const render = (result) => {
      const choices = q.options.map((o, i) => {
        let cls = 'choice';
        if (result) { if (o === q.answer) cls += ' right'; else if (i === sel) cls += ' wrong'; }
        else if (i === sel) cls += ' sel';
        return `<button class="${cls}" data-i="${i}">${MQ.escapeHtml(o)}</button>`;
      }).join('');
      const feedback = !result ? '' : result === 'right'
        ? `<div class="explain good">✔ Correct! <span class="zh">对了!</span> +1 ⭐</div>`
        : `<div class="explain bad">The answer is ${MQ.escapeHtml(q.answer)}. ${MQ.escapeHtml(q.explain)}</div>`;
      showOverlay(`
        <div class="card">
          <div class="hint">🐼 Bonus question · ${QUIZ[type].label}</div>
          ${q.visual ? `<div class="quiz-visual">${q.visual}</div>` : ''}
          <div class="quiz-q">${MQ.escapeHtml(q.q)}</div>
          <div class="choices">${choices}</div>
          ${feedback}
          <div class="press">${result ? 'Press <span class="key">return</span> to keep going' : 'Pick with <span class="key">←</span> <span class="key">→</span> then press <span class="key">return</span>'}</div>
        </div>`, keys);
      overlay.querySelectorAll('.choice').forEach((b) => b.addEventListener('click', () => {
        if (done) { nextLevel(); return; }
        sel = Number(b.dataset.i);
        answer();
      }));
    };

    const answer = () => {
      done = true;
      const right = q.options[sel] === q.answer;
      const s = (g.quiz[type] = g.quiz[type] || { right: 0, tries: 0 });
      s.tries++;
      if (right) { s.right++; data.stars++; MQ.Sound.star(); MQ.Voice.say(data.settings.chinese ? '对了!' : 'Correct!', data.settings.chinese ? 'zh-CN' : 'en-US', { interrupt: true }); }
      else { MQ.Sound.nope(); MQ.Voice.say(`The answer is ${q.answer.replace('¢', ' cents')}`, 'en-US', { interrupt: true }); }
      persist();
      updateHud();
      render(right ? 'right' : 'wrong');
    };

    const keys = (k) => {
      if (done) { if (k === 'Enter' || k === ' ') nextLevel(); return; }
      if (k === 'ArrowLeft') { sel = Math.max(0, sel - 1); MQ.Sound.click(); render(); }
      else if (k === 'ArrowRight') { sel = Math.min(q.options.length - 1, sel + 1); MQ.Sound.click(); render(); }
      else if (k === 'Enter' || k === ' ') answer();
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
        ${first ? `<p class="hint">Hop with the arrow keys. Stay away from the cars! 🚗<br>Grabbed the wrong coin? Press <span class="key">space</span> to put it back.<br>When you have the exact amount, hop into the castle 🏰 at the top.</p>` : ''}
        <div class="press">Press <span class="key">return</span> to start</div>
      </div>`,
      (k) => { if (k === 'Enter' || k === ' ') startPlay(); }
    );
    MQ.Voice.say(`Level ${g.level}. Collect exactly ${MQ.moneyWords(target)}.`, 'en-US', { interrupt: true });
    if (data.settings.chinese) MQ.Voice.say(MQ.zhMoney(target), 'zh-CN');
    say(`Collect exactly ${MQ.money(target, targetFmt)}!`);
  }

  function startPlay() {
    hideOverlay();
    state = 'play';
    MQ.Sound.click();
    say(`Collect exactly ${MQ.money(target, targetFmt)}, then hop into the castle!`);
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
          <div class="press">Use <span class="key">↑</span> <span class="key">↓</span> and <span class="key">return</span></div>
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
  function cellCenter(r, c) { return { x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 }; }

  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 60 + Math.random() * 180;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 80, life: 0.8 + Math.random() * 0.5, color, size: 3 + Math.random() * 4 });
    }
  }

  function update(dt) {
    time += dt;
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
      if (player.t < 1) {
        player.t = Math.min(1, player.t + dt / HOP_TIME);
        if (player.t === 1) onLand();
      }
      if (player.inv > 0) player.inv -= dt;
      const lane = laneByRow[player.r];
      if (lane && player.inv <= 0 && state === 'play') {
        const x0 = player.c + 0.22;
        const x1 = player.c + 0.78;
        if (lane.cars.some((car) => car.x < x1 && car.x + car.len > x0)) bonk();
      }
    }

    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 400 * dt; p.life -= dt; }
    particles = particles.filter((p) => p.life > 0);
    for (const f of floaters) { f.y -= 40 * dt; f.life -= dt; }
    floaters = floaters.filter((f) => f.life > 0);
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

  function drawRows() {
    for (let r = 0; r < ROWS; r++) {
      const y = r * CELL;
      if (r === BANK_ROW) continue;
      if (laneByRow[r]) {
        ctx.fillStyle = '#585e66';
        ctx.fillRect(0, y, W, CELL);
        ctx.fillStyle = '#6b727b';
        ctx.fillRect(0, y, W, 3);
        ctx.fillRect(0, y + CELL - 3, W, 3);
        if (laneByRow[r + 1]) {
          ctx.fillStyle = 'rgba(255,255,255,0.7)';
          for (let x = 8; x < W; x += 48) ctx.fillRect(x, y + CELL - 2, 26, 4);
        }
      } else {
        const base = r === START_ROW ? ['#a6e38a', '#9bdc7d'] : r % 2 ? ['#7fd160', '#77c958'] : ['#86d767', '#7ecf5f'];
        for (let c = 0; c < COLS; c++) {
          ctx.fillStyle = base[(c + r) % 2];
          ctx.fillRect(c * CELL, y, CELL, CELL);
        }
        if (r === START_ROW) {
          ctx.font = `20px ${EMOJI_FONT}`;
          ctx.fillStyle = '#000';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          for (const c of [0, 2, 6, 8]) ctx.fillText('🌼', c * CELL + 32, y + 32);
        }
      }
    }
  }

  function drawCastle() {
    const open = total() === target;
    ctx.fillStyle = '#c96a4a';
    ctx.fillRect(0, 0, W, CELL);
    ctx.strokeStyle = 'rgba(90,30,20,0.35)';
    ctx.lineWidth = 2;
    for (let row = 0; row < 3; row++) {
      const y = 12 + row * 17;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      for (let x = (row % 2) * 20; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 17); ctx.stroke(); }
    }
    // Battlements
    ctx.fillStyle = '#b25a3c';
    for (let x = 0; x < W; x += 32) ctx.fillRect(x, 0, 18, 10);
    // Gate across the whole top row: glows gold when open.
    const glow = open ? 0.55 + 0.35 * Math.sin(time * 6) : 0;
    if (open) {
      ctx.fillStyle = `rgba(255,215,0,${glow})`;
      ctx.fillRect(0, CELL - 10, W, 10);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `34px ${EMOJI_FONT}`;
    ctx.fillStyle = '#000';
    ctx.fillText('🏰', W / 2, CELL / 2 + 2);
    ctx.font = `22px ${EMOJI_FONT}`;
    ctx.fillText(open ? '🔓' : '🔒', W / 2 + 38, CELL / 2 + 8);
    ctx.font = `bold 20px ${UI_FONT}`;
    ctx.fillStyle = '#fff4d6';
    ctx.fillText(MQ.money(target, targetFmt), 70, CELL / 2 + 2);
    ctx.fillText(open ? 'OPEN!' : 'LOCKED', W - 70, CELL / 2 + 2);
  }

  function drawCoin(v, x, y, scale = 1) {
    const k = COINS[v];
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(0, 22, 18, 5, 0, 0, Math.PI * 2); ctx.fill();
    if (k.bill) {
      roundRect(-24, -14, 48, 28, 5);
      ctx.fillStyle = k.fill; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = k.edge; ctx.stroke();
      ctx.fillStyle = k.text;
      ctx.font = `900 16px ${UI_FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`$${v / 100}`, 0, 1);
    } else {
      const g2 = ctx.createRadialGradient(-k.r * 0.35, -k.r * 0.4, 2, 0, 0, k.r);
      g2.addColorStop(0, k.hi); g2.addColorStop(0.6, k.mid); g2.addColorStop(1, k.lo);
      ctx.fillStyle = g2;
      ctx.beginPath(); ctx.arc(0, 0, k.r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = k.lo; ctx.stroke();
      ctx.fillStyle = k.text;
      ctx.font = `900 ${v >= 10 ? 12 : 13}px ${UI_FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`${v}¢`, 0, 1);
    }
    ctx.restore();
  }

  function drawCoins() {
    for (const c of coins) {
      if (c.taken) continue;
      const home = cellCenter(c.r, c.c);
      if (c.fly) {
        const t = ease(c.fly.t);
        drawCoin(c.v, lerp(c.fly.x, home.x, t), lerp(c.fly.y, home.y, t) - Math.sin(Math.PI * t) * 50, 1);
      } else {
        drawCoin(c.v, home.x, home.y + Math.sin(time * 3 + c.bob) * 3, 1);
      }
    }
  }

  function drawCars() {
    for (const lane of lanes) {
      const y = lane.row * CELL;
      for (const car of lane.cars) {
        const x = car.x * CELL + 4;
        const w = car.len * CELL - 8;
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        roundRect(x + 3, y + 14, w, 42, 10); ctx.fill();
        ctx.fillStyle = car.color;
        roundRect(x, y + 10, w, 40, 10); ctx.fill();
        // Roof + windows
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        if (car.len === 1) {
          roundRect(x + w * 0.22, y + 16, w * 0.56, 28, 6); ctx.fill();
          ctx.fillStyle = car.color;
          ctx.fillRect(x + w * 0.48, y + 16, 4, 28);
        } else {
          for (let i = 0; i < 4; i++) { roundRect(x + 12 + i * (w - 24) / 4, y + 17, (w - 24) / 4 - 6, 22, 4); ctx.fill(); }
        }
        // Wheels
        ctx.fillStyle = '#222';
        for (const wx of [x + 10, x + w - 22]) { ctx.fillRect(wx, y + 6, 12, 6); ctx.fillRect(wx, y + 48, 12, 6); }
        // Headlights on the front
        ctx.fillStyle = '#fff59d';
        const fx = lane.dir > 0 ? x + w - 6 : x + 2;
        ctx.fillRect(fx, y + 14, 4, 8); ctx.fillRect(fx, y + 38, 4, 8);
      }
    }
  }

  function drawPlayer() {
    const e = ease(player.t);
    const x = lerp(player.fromC, player.c, e) * CELL + CELL / 2;
    const yGround = lerp(player.fromR, player.r, e) * CELL + CELL / 2;
    const hop = Math.sin(Math.PI * player.t) * 18;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(x, yGround + 22, 18 - hop * 0.3, 6, 0, 0, Math.PI * 2); ctx.fill();
    if (player.inv > 0 && Math.floor(player.inv * 10) % 2 === 0) return;
    ctx.font = `44px ${EMOJI_FONT}`;
    ctx.fillStyle = '#000'; // color emoji inherit the fill's opacity
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(hero, x, yGround - hop);
  }

  function drawEffects() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
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

  function draw() {
    ctx.clearRect(0, 0, W, H);
    drawRows();
    drawCastle();
    drawCoins();
    drawCars();
    drawPlayer();
    drawEffects();
  }

  // ---------- Sizing (crisp on Retina screens) ----------
  let pixelScale = 1;
  function resize() {
    const narrow = window.innerWidth <= 860;
    const availW = narrow ? window.innerWidth - 24 : window.innerWidth - 300 - 20 - 36;
    const availH = narrow ? window.innerHeight * 0.7 : window.innerHeight - 24;
    const scale = Math.max(0.4, Math.min(availW / W, availH / H, 1.5));
    const dpr = window.devicePixelRatio || 1;
    stage.style.width = `${Math.round(W * scale)}px`;
    stage.style.height = `${Math.round(H * scale)}px`;
    canvas.style.width = `${Math.round(W * scale)}px`;
    canvas.style.height = `${Math.round(H * scale)}px`;
    canvas.width = Math.round(W * scale * dpr);
    canvas.height = Math.round(H * scale * dpr);
    pixelScale = scale * dpr;
    ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
  }
  window.addEventListener('resize', resize);

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  window.addEventListener('beforeunload', persist);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { persist(); if (state === 'play') showPause(); }
  });

  // Small hook for automated tests.
  window.__coinCrossing = { quiz: QUIZ, get state() { return state; }, get target() { return target; }, get coins() { return coins; }, get player() { return player; }, total, get level() { return g.level; } };

  resize();
  newLevel();
  showIntro();
  requestAnimationFrame(frame);
})();
