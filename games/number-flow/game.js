/* Number Flow — a Flow Free–style path puzzle. Draw a path from each colored dot to its twin;
   the numbers the path passes through must add up to exactly the number on the dots.
   Difficulty adapts: bigger boards, more pairs, bigger numbers as he levels up. */
(function () {
  'use strict';

  const GAME_ID = 'numberFlow';
  const W = 800; // logical board size (square); scaled to fit the window
  const H = 800;
  const PAD = 26;
  const MAX_CELL = 172;
  const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  const STEP_TIME = 0.09; // seconds for a path segment to "grow" into the next cell

  // Path colors (Flow Free–like, a touch warmer). ink = text color on the dot.
  const COLORS = [
    { name: 'red', emoji: '🔴', c: '#ff5a6e', dark: '#c9304a', light: '#ffb3bd', ink: '#fff' },
    { name: 'blue', emoji: '🔵', c: '#4c8dff', dark: '#2a5fcf', light: '#b3cfff', ink: '#fff' },
    { name: 'green', emoji: '🟢', c: '#35c97a', dark: '#1f9656', light: '#a8ecc6', ink: '#fff' },
    { name: 'purple', emoji: '🟣', c: '#b276ff', dark: '#7f45d6', light: '#dcc4ff', ink: '#fff' },
    { name: 'orange', emoji: '🟠', c: '#ff9a3c', dark: '#d46a12', light: '#ffd0a3', ink: '#fff' },
    { name: 'pink', emoji: '💗', c: '#ff6fb5', dark: '#d63d8a', light: '#ffc2e0', ink: '#fff' },
  ];

  // ---------- Save data ----------
  const data = MQ.load();
  MQ.applySettings(data.settings);
  const g = (data.games[GAME_ID] = Object.assign(
    { level: 1, maxLevel: 1, played: 0, seconds: 0, history: [], skills: {}, struggles: 0, goodStreak: 0 },
    data.games[GAME_ID] || {}
  ));
  function persist() { MQ.save(data); }

  // ---------- DOM ----------
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const stage = document.getElementById('stage');
  const overlay = document.getElementById('overlay');
  const el = (id) => document.getElementById(id);
  const UI_FONT = getComputedStyle(document.body).fontFamily;

  // ---------- Level design ----------
  // n = board size, pairs = colored pairs, lo/hi = number range, len = numbers on each intended
  // path (it is always a detour, so a little longer than the straight way), minT/maxT = target
  // range, tens = occasional big numbers (10 / 20), cap = most routes (of about the intended
  // length) allowed to make the target, near = how close a "tempting" wrong route must get.
  const LEVELS = [
    null,
    { n: 4, pairs: 2, lo: 1, hi: 4, len: [3, 4], minT: 5, maxT: 12, cap: 2, near: 2 }, // 1
    { n: 4, pairs: 2, lo: 1, hi: 5, len: [3, 4], minT: 7, maxT: 14, cap: 2, near: 2 }, // 2
    { n: 5, pairs: 2, lo: 1, hi: 6, len: [3, 5], minT: 8, maxT: 18, cap: 2, near: 2 }, // 3
    { n: 5, pairs: 3, lo: 1, hi: 6, len: [3, 4], minT: 8, maxT: 20, cap: 2, near: 2 }, // 4
    { n: 5, pairs: 3, lo: 1, hi: 8, len: [3, 5], minT: 10, maxT: 24, cap: 3, near: 3 }, // 5
    { n: 6, pairs: 3, lo: 1, hi: 9, len: [3, 6], minT: 12, maxT: 28, cap: 3, near: 3 }, // 6
    { n: 6, pairs: 4, lo: 1, hi: 9, len: [3, 5], minT: 12, maxT: 30, cap: 3, near: 3 }, // 7
    { n: 6, pairs: 4, lo: 2, hi: 9, len: [3, 6], minT: 14, maxT: 34, cap: 3, near: 3 }, // 8
    { n: 6, pairs: 4, lo: 2, hi: 9, len: [3, 6], minT: 16, maxT: 40, tens: [10], tenP: 0.2, cap: 3, near: 3 }, // 9
    { n: 7, pairs: 4, lo: 2, hi: 9, len: [4, 6], minT: 18, maxT: 45, tens: [10], tenP: 0.25, cap: 3, near: 3 }, // 10
    { n: 7, pairs: 5, lo: 2, hi: 9, len: [4, 6], minT: 20, maxT: 50, tens: [10], tenP: 0.25, cap: 3, near: 3 }, // 11
    { n: 7, pairs: 5, lo: 2, hi: 9, len: [4, 7], minT: 22, maxT: 56, tens: [10, 20], tenP: 0.25, cap: 3, near: 3 }, // 12
    { n: 7, pairs: 5, lo: 3, hi: 9, len: [4, 7], minT: 26, maxT: 66, tens: [10, 20], tenP: 0.3, cap: 3, near: 3 }, // 13+
  ];
  function configFor(L) {
    const cfg = Object.assign({}, LEVELS[Math.max(1, Math.min(LEVELS.length - 1, L))]);
    // Training wheels: at levels 1-2 the running total shows while he draws. From level 3 he
    // adds in his head: the path shows "8 + 2 + 5 = ?" and the total is only shown (and
    // graded) when the path reaches the other dot.
    cfg.liveSum = L <= 2;
    return cfg;
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
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const zh = (n) => (data.settings.chinese ? MQ.zhNumber(n) : '');
  const clock = () => (window.performance ? performance.now() : Date.now());

  // ---------- Puzzle generator ----------
  // The math has to matter: the straight / shortest way between two dots must NEVER make the
  // target, so a child can't just connect the dots and ignore the numbers.
  //  1. Lay down K snake-like random walks that never touch themselves or each other's cells.
  //     Each walk is a DETOUR: its ends are closer together than the walk is long.
  //  2. Walk ends become the dots, the walk's inside numbers set the target, every other cell
  //     gets a distractor number. So the intended walks are always a solution (and the hint).
  //  3. Check every pair with a small search of the routes a child could draw (up to a couple
  //     of cells longer than the intended one): no shortest route may hit the target, only a
  //     few routes may hit it at all, and some wrong route should come close (a tempting
  //     "almost!"). Nudge single numbers until that holds; keep the best board found.
  function neighbors(i, n) {
    const r = Math.floor(i / n), c = i % n, out = [];
    if (r > 0) out.push(i - n);
    if (r < n - 1) out.push(i + n);
    if (c > 0) out.push(i - 1);
    if (c < n - 1) out.push(i + 1);
    return out;
  }
  const manhattan = (a, b, n) => Math.abs(Math.floor(a / n) - Math.floor(b / n)) + Math.abs((a % n) - (b % n));

  function randomWalk(n, used, cells) {
    const free = [];
    for (let i = 0; i < n * n; i++) if (!used[i]) free.push(i);
    if (!free.length) return null;
    const walk = [pick(free)];
    const inWalk = new Set(walk);
    let dir = null;
    while (walk.length < cells) {
      const head = walk[walk.length - 1];
      const opts = neighbors(head, n).filter((j) => {
        if (used[j] || inWalk.has(j)) return false;
        // Never touch an earlier cell of this walk: keeps paths clean (no hidden shortcuts).
        return neighbors(j, n).every((k) => k === head || !inWalk.has(k));
      });
      if (!opts.length) return null;
      // Turn fairly often, so the walk bends back into a detour.
      let next = opts.find((j) => j - head === dir);
      if (next === undefined || Math.random() < 0.6) next = pick(opts);
      dir = next - head;
      walk.push(next);
      inWalk.add(next);
    }
    // A detour: the dots are at least 2 steps apart (the short way has a number on it) and
    // the walk is longer than the straight / L-shaped way.
    const d = manhattan(walk[0], walk[walk.length - 1], n);
    if (d < 2 || d > walk.length - 3) return null;
    return walk;
  }

  function randNum(cfg) {
    if (cfg.tens && Math.random() < cfg.tenP) return pick(cfg.tens);
    return rand(cfg.lo, cfg.hi);
  }

  // Steps from every cell to dot b, going around the other pairs' dots (-1 = can't get there).
  function distTo(n, cells, pr, p) {
    const dist = new Int16Array(n * n).fill(-1);
    dist[pr.b] = 0;
    const q = [pr.b];
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      if (i === pr.a) continue;
      for (const j of neighbors(i, n)) {
        if (dist[j] >= 0 || (cells[j].pair >= 0 && j !== pr.a)) continue;
        dist[j] = dist[i] + 1;
        q.push(j);
      }
    }
    return dist;
  }

  // Search the routes a child could draw from dot a to dot b (up to 2 steps longer than the
  // intended one — in a grid every route to b has the same odd/even length). Numbers are all
  // positive, so a route whose sum is already too big is dropped straight away.
  function checkPair(n, cells, pr, dist, cfg, nbr) {
    const want = pr.target, tol = cfg.near;
    const intendedE = pr.sol.length - 1;
    const shortest = dist[pr.a];
    const maxE = intendedE + 2;
    const on = new Uint8Array(n * n);
    const res = { shortest, hits: 0, spHit: false, near: false, spNear: false, bad: null };
    const route = [];
    on[pr.a] = 1;
    (function dfs(i, e, sum) {
      if (res.hits > 12) return; // plenty to know it's too easy
      const nb = nbr[i];
      for (let k = 0; k < nb.length; k++) {
        const j = nb[k];
        if (on[j] || dist[j] < 0) continue;
        if (j === pr.b) {
          const diff = Math.abs(sum - want);
          if (diff === 0) {
            res.hits++;
            if (e + 1 === shortest) res.spHit = true;
            if (e + 1 === shortest || (res.hits > cfg.cap && !res.bad)) res.bad = route.slice();
          } else if (diff <= tol && e + 1 <= intendedE) {
            res.near = true;
            if (e + 1 === shortest) res.spNear = true;
          }
          continue;
        }
        if (cells[j].pair >= 0) continue;
        const s2 = sum + cells[j].num;
        if (s2 > want + tol || e + 1 + dist[j] > maxE) continue;
        on[j] = 1; route.push(j);
        dfs(j, e + 1, s2);
        on[j] = 0; route.pop();
      }
    })(pr.a, 0, 0);
    return res;
  }

  // Must-haves cost whole points; "the straight way is only a little off" is a nice-to-have
  // worth a quarter point per pair, so a board is fine (cost < 1) without it.
  function costOf(checks, cfg) {
    let c = 0;
    for (const r of checks) {
      if (r.spHit) c += 1000;
      if (r.hits > cfg.cap) c += 10 * (r.hits - cfg.cap);
      if (!r.near) c += 3;
      if (!r.spNear) c += 0.25 / checks.length;
    }
    return c;
  }

  // One candidate board (walks + numbers), or null if the walks didn't fit.
  function layout(cfg) {
    const n = cfg.n;
    const used = new Uint8Array(n * n);
    const walks = [];
    for (let k = 0; k < cfg.pairs; k++) {
      let walk = null;
      for (let t = 0; t < 60 && !walk; t++) walk = randomWalk(n, used, rand(cfg.len[0], cfg.len[1]) + 2);
      if (!walk) return null;
      walk.forEach((i) => { used[i] = 1; });
      walks.push(walk);
    }
    const cells = Array.from({ length: n * n }, () => ({ num: null, pair: -1 }));
    const pairs = walks.map((walk, p) => {
      cells[walk[0]].pair = p;
      cells[walk[walk.length - 1]].pair = p;
      return { a: walk[0], b: walk[walk.length - 1], sol: walk, target: 0, color: COLORS[p] };
    });
    // With every dot placed, the intended route must still be a real detour.
    const dists = pairs.map((pr, p) => distTo(n, cells, pr, p));
    for (let p = 0; p < pairs.length; p++) {
      const sp = dists[p][pairs[p].a];
      if (sp < 2 || pairs[p].sol.length - 1 < sp + 2) return null;
    }
    const owner = new Int8Array(n * n).fill(-1);
    pairs.forEach((pr, p) => {
      const inner = pr.sol.slice(1, -1);
      inner.forEach((i) => { owner[i] = p; });
      let nums;
      for (let t = 0; t < 60; t++) {
        nums = inner.map(() => randNum(cfg));
        const s = nums.reduce((a, b) => a + b, 0);
        if (s <= cfg.maxT && (s >= cfg.minT || t > 40)) break;
      }
      let s = nums.reduce((a, b) => a + b, 0);
      while (s > cfg.maxT) { // safety: shrink the biggest numbers until it fits
        const j = nums.indexOf(Math.max(...nums));
        const cut = Math.min(nums[j] - 1, s - cfg.maxT);
        nums[j] -= cut; s -= cut;
      }
      inner.forEach((i, k) => { cells[i].num = nums[k]; });
      pr.target = s;
    });
    cells.forEach((cell) => { if (cell.pair < 0 && cell.num === null) cell.num = randNum(cfg); });
    return { cells, pairs, dists, owner };
  }

  function generate(L, forcePairs) {
    const cfg = configFor(L);
    if (forcePairs) cfg.pairs = forcePairs;
    const n = cfg.n;
    const nbr = Array.from({ length: n * n }, (_, i) => neighbors(i, n));
    const t0 = clock();
    let best = null, bestCost = Infinity;
    for (let attempt = 0; attempt < 600; attempt++) {
      if (best && clock() - t0 > 40) break; // good enough — don't keep him waiting
      const cand = layout(cfg);
      if (!cand) continue;
      const { cells, pairs, dists, owner } = cand;
      const check = (p) => checkPair(n, cells, pairs[p], dists[p], cfg, nbr);
      let checks = pairs.map((_, p) => check(p));
      let cost = costOf(checks, cfg);
      // Nudge one number at a time; keep the change unless it makes things worse.
      for (let it = 0; it < 90 && cost > 0 && !(cost < 1 && it >= 40); it++) {
        const worst = checks.find((r) => r.bad) || null;
        let i;
        if (worst && Math.random() < 0.8) {
          // Break a route that makes the target too easily: change a number on it.
          i = pick(worst.bad);
        } else {
          do { i = rand(0, n * n - 1); } while (cells[i].pair >= 0);
        }
        const old = cells[i].num;
        const v = randNum(cfg);
        if (v === old) continue;
        const q = owner[i];
        if (q >= 0) { // on an intended path: its target moves too, and must stay in range
          const t = pairs[q].target + v - old;
          if (t < cfg.minT || t > cfg.maxT) continue;
          pairs[q].target = t;
        }
        cells[i].num = v;
        const next = pairs.map((_, p) => check(p));
        const c = costOf(next, cfg);
        if (c <= cost) { cost = c; checks = next; }
        else { cells[i].num = old; if (q >= 0) pairs[q].target -= v - old; }
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = { n, cfg, cells: cells.map((c) => ({ num: c.num, pair: c.pair })), pairs: pairs.map((pr) => Object.assign({}, pr)), level: L, cost: Math.floor(cost) };
      }
      if (cost < 1 && (cost === 0 || clock() - t0 > 6)) break;
    }
    if (best) return best;
    const fewer = (forcePairs || cfg.pairs) - 1;
    if (fewer >= 1) return generate(L, fewer); // board too crowded: one fewer pair
    return generate(Math.max(1, L - 1)); // never loop forever: fall back to an easier level's board
  }

  // ---------- Game state ----------
  let puzzle, paths, cursor, drawing, stats, firstArrival, active;
  let state = 'intro'; // intro | play | pause | confirm | won | result
  let particles = [];
  let floaters = [];
  let lanterns = [];
  let shimmers = [];
  let grow = null; // { p, t } animates the newest path segment
  let hintFlash = null;
  let wrongFlash = null;
  let time = 0;
  let lastSaveAt = 0;
  let geo = { cell: 100, x0: 0, y0: 0 };
  let compact = false; // phone layout (set in resize)
  // keyMode: show the keyboard cursor. Laptops start in it; phones switch to it only when keys are used.
  let keyMode = !MQ.isTouch;
  const kb = (keys, touch) => (keyMode ? keys : touch);
  let ping = null; // rings on a dot ("start here!") after tapping an empty cell
  let everDragged = false; // the 👆 demo hand shows until he first drags a path with a finger
  // Hints (per puzzle, not saved): hintSeen[p] = the numbers of pair p's route a hint has shown.
  // A hint shows at most half of a route, and there is a short wait between hints.
  const HINT_WAIT = 10; // seconds of play between two hints
  let hintSeen = [];
  let lastHintAt = -Infinity; // stats.seconds when the last hint was given
  let toldHead = false; // "add them up in your head!" has been spoken this puzzle
  // Running total on show while drawing? (levels 1-2 only — see configFor)
  const live = () => puzzle.cfg.liveSum !== false;

  function newPuzzle() {
    puzzle = generate(g.level);
    // (A very crowded board can fall back to an easier level's board: keep his level's rule.)
    puzzle.cfg.liveSum = configFor(g.level).liveSum;
    paths = puzzle.pairs.map(() => []);
    drawing = -1;
    active = 0;
    firstArrival = puzzle.pairs.map(() => true);
    stats = { hints: 0, resets: 0, wrongs: 0, undos: 0, seconds: 0 };
    hintSeen = puzzle.pairs.map(() => new Set());
    lastHintAt = -Infinity;
    toldHead = false;
    doneGrab = null;
    computeGeo();
    cursor = puzzle.pairs[0].a;
    particles = []; floaters = []; lanterns = []; shimmers = [];
    grow = null; hintFlash = null; wrongFlash = null; ping = null;
    updateHud();
  }

  function computeGeo() {
    if (!puzzle) return;
    const n = puzzle.n;
    const pad = compact ? 10 : PAD; // phones: the board uses (almost) the whole canvas
    const cell = Math.min(MAX_CELL, (W - pad * 2) / n);
    geo = { cell, x0: (W - cell * n) / 2, y0: (H - cell * n) / 2 };
  }

  // ---------- Puzzle logic ----------
  const rc = (i) => ({ r: Math.floor(i / puzzle.n), c: i % puzzle.n });
  const partnerOf = (p, i) => (puzzle.pairs[p].a === i ? puzzle.pairs[p].b : puzzle.pairs[p].a);
  function terms(p) {
    return paths[p].filter((i) => puzzle.cells[i].pair < 0).map((i) => puzzle.cells[i].num);
  }
  const sumOf = (p) => terms(p).reduce((a, b) => a + b, 0);
  function isComplete(p) {
    const P = paths[p];
    return P.length >= 2 && P[P.length - 1] === partnerOf(p, P[0]);
  }
  const isCorrect = (p) => isComplete(p) && sumOf(p) === puzzle.pairs[p].target;
  function occupant(i) {
    const cp = puzzle.cells[i].pair;
    if (cp >= 0) return cp;
    for (let p = 0; p < paths.length; p++) if (paths[p].includes(i)) return p;
    return -1;
  }
  const head = (p) => paths[p][paths[p].length - 1];

  function startDraw(p, i) {
    const P = paths[p];
    const pos = P.indexOf(i);
    const fresh = pos < 0 || (pos === 0);
    if (puzzle.cells[i].pair === p && pos === P.length - 1 && P.length > 1) {
      // Picking up the far dot of a finished path: keep it, arrows back up from here.
    } else if (puzzle.cells[i].pair === p && fresh) {
      paths[p] = [i];
    } else {
      paths[p] = P.slice(0, pos + 1);
    }
    drawing = p;
    active = p;
    cursor = i;
    MQ.Sound.note(67, 'bell', { dur: 0.6, vel: 0.12 });
    const pr = puzzle.pairs[p];
    if (paths[p].length === 1) {
      say(kb(`${pr.color.emoji} Make ${pr.target}! Walk with the arrows to the other ${pr.color.emoji} ${pr.target}.`, `${pr.color.emoji} Make ${pr.target}! Drag to the other ${pr.color.emoji} ${pr.target}.`));
      MQ.Voice.say(`Make ${pr.target}`, 'en-US', { interrupt: true });
      if (data.settings.chinese) MQ.Voice.say(MQ.zhNumber(pr.target), 'zh-CN');
    } else {
      say(kb(`${pr.color.emoji} Keep going! Use the arrows. Step back to undo.`, `${pr.color.emoji} Keep going! Slide back to undo.`));
    }
    updateHud();
  }

  function release(msg) {
    if (drawing < 0) return;
    const p = drawing;
    drawing = -1;
    if (msg !== false) {
      const pr = puzzle.pairs[p];
      if (!isCorrect(p)) say(msg || kb(`${pr.color.emoji} Paused. Press space on the path to keep going.`, `${pr.color.emoji} Touch the path to keep going.`));
    }
    updateHud();
  }

  // One step of the path in direction (dr, dc). Returns true if the path changed.
  function step(dr, dc) {
    const p = drawing;
    const P = paths[p];
    const h = P[P.length - 1];
    const { r, c } = rc(h);
    const nr = r + dr, nc = c + dc;
    const n = puzzle.n;
    if (nr < 0 || nc < 0 || nr >= n || nc >= n) { MQ.Sound.note(45, 'wood', { dur: 0.08, vel: 0.3 }); return false; }
    const ni = nr * n + nc;
    const pr = puzzle.pairs[p];

    // Stepping back = undo.
    if (P.length >= 2 && ni === P[P.length - 2]) {
      P.pop();
      stats.undos++;
      cursor = ni;
      MQ.Sound.note(noteFor(p), 'harp', { dur: 0.3, vel: 0.07 });
      grow = null;
      onPathChanged(p, false);
      return true;
    }
    if (isComplete(p)) {
      MQ.Sound.nope();
      say(`${pr.color.emoji} You reached the dot. To change the path, step back ↩ the way you came.`);
      return false;
    }
    const pos = P.indexOf(ni);
    if (pos >= 0) { // walked into its own path: cut back to there (like Flow Free)
      paths[p] = P.slice(0, pos + 1);
      stats.undos++;
      cursor = ni;
      MQ.Sound.putBack();
      onPathChanged(p, false);
      return true;
    }
    const occ = occupant(ni);
    if (occ >= 0 && occ !== p) {
      MQ.Sound.nope();
      const oc = puzzle.pairs[occ].color;
      if (puzzle.cells[ni].pair === occ) say(`That's the ${oc.emoji} ${oc.name} dot. Paths can't go through other dots.`);
      else say(`The ${oc.emoji} ${oc.name} path is in the way. Paths can't cross — try another way!`);
      return false;
    }
    if (puzzle.cells[ni].pair === p && ni !== partnerOf(p, P[0])) return false; // (can't happen)

    P.push(ni);
    cursor = ni;
    grow = { p, t: 0 };
    const cell = puzzle.cells[ni];
    if (cell.pair === p) { arrive(p); return true; }
    const { x, y } = cellCenter(ni);
    floaters.push({ x: x - geo.cell * 0.3, y: y - geo.cell * 0.3, text: `+${cell.num}`, life: 1, color: pr.color.c });
    MQ.Sound.note(noteFor(p), 'harp', { dur: 0.6, vel: 0.13 });
    onPathChanged(p, true);
    return true;
  }

  // Notes climb a C-major pentatonic scale as the running sum gets closer to the target.
  // With the running total hidden (level 3+) they just climb with each number, so the music
  // doesn't give away how close he is.
  const PENTA = [0, 2, 4, 7, 9];
  function noteFor(p) {
    const k = live()
      ? Math.max(0, Math.min(11, Math.round((sumOf(p) / puzzle.pairs[p].target) * 9)))
      : Math.min(9, terms(p).length * 2);
    return 60 + PENTA[k % 5] + 12 * Math.floor(k / 5);
  }

  function onPathChanged(p, forward) {
    active = p;
    const pr = puzzle.pairs[p];
    const s = sumOf(p);
    const t = terms(p);
    if (!t.length) say(`${pr.color.emoji} Make ${pr.target}! Walk to the other ${pr.color.emoji} dot.`);
    else if (!live()) {
      // He adds in his head: only the numbers, no total, no "too much", no 🎯. The dot grades it.
      say(`${pr.color.emoji} ${t.join(' + ')} = ? Add them up! Make ${pr.target}, then go to the other ${pr.color.emoji}.`);
      if (forward && !toldHead) {
        toldHead = true;
        MQ.Voice.say('Add them up in your head!', 'en-US');
      }
    } else if (s > pr.target) {
      if (forward) MQ.Sound.note(50, 'harp', { delay: 0.12, dur: 0.6, vel: 0.1 });
      if (forward && s - t[t.length - 1] <= pr.target) MQ.Voice.say(`${s}. Too much!`, 'en-US', { interrupt: true });
      say(`${t.join(' + ')} = ${s}. That's more than ${pr.target}! Step back ↩ and try another way.`);
    } else if (s === pr.target) {
      if (forward) MQ.Voice.say(`${s}! Now go to the ${pr.color.name} dot.`, 'en-US', { interrupt: true });
      say(`🎯 ${s}! Now walk to the other ${pr.color.emoji} dot.`);
    }
    else say(`${t.join(' + ')} = ${s}. You need ${pr.target - s} more.`);
    updateHud();
  }

  function arrive(p) {
    const pr = puzzle.pairs[p];
    const s = sumOf(p);
    const t = terms(p);
    const right = s === pr.target;
    if (firstArrival[p]) {
      firstArrival[p] = false;
      track('sum', 'Adding along a path', right);
      if (t.length >= 3) track('three', 'Adding 3 or more numbers', right);
      if (pr.target >= 20) track('big', 'Sums of 20 or more', right);
      if (t.some((v) => v >= 10)) track('tens', 'Adding 10s and 20s', right);
    }
    active = p;
    if (right) {
      drawing = -1;
      MQ.Sound.open();
      shimmers.push({ p, t: 0 });
      paths[p].forEach((i, k) => setTimeout(() => { const c = cellCenter(i); burst(c.x, c.y, pr.color.light, 6); }, k * 60));
      const words = `${t.join(' plus ')} equals ${s}`;
      const done = puzzle.pairs.every((_, q) => isCorrect(q));
      if (!done) {
        const praise = MQ.pick(MQ.PRAISE);
        say(`${t.join(' + ')} = ${s} ✅ ${praise.zh} ${pickNextTip()}`);
        MQ.Voice.say(words, 'en-US', { interrupt: true });
      } else {
        MQ.Voice.say(words, 'en-US', { interrupt: true });
      }
      updateHud();
      if (done) win();
      return;
    }
    stats.wrongs++;
    MQ.Sound.nope();
    wrongFlash = { p, t: 0 };
    const diff = Math.abs(s - pr.target);
    const eq = t.length ? `${t.join(' + ')} = ${s}` : 'That path has no numbers';
    if (!t.length) say(`Oops! The path needs to go through some numbers to make ${pr.target}. Try a different way — go around! ↩`);
    else if (s > pr.target) say(`${eq}. Too much! The target is ${pr.target}. Try a different way — go around! ↩ Find a way with ${diff} less.`);
    else say(`${eq}. Not enough to make ${pr.target}. Try a different way — go around! ↩ Find a way with ${diff} more.`);
    MQ.Voice.say(s > pr.target ? `${s}. Too much! We need ${pr.target}. Try a different way!` : `${s}. We need ${pr.target}. ${diff} more. Try a different way!`, 'en-US', { interrupt: true });
    updateHud();
  }

  function pickNextTip() {
    const q = puzzle.pairs.findIndex((_, k) => !isCorrect(k));
    if (q < 0) return '';
    const pr = puzzle.pairs[q];
    return `Now the ${pr.color.emoji} ${pr.target}!`;
  }

  function track(key, label, right) {
    const s = (g.skills[key] = g.skills[key] || { label, right: 0, tries: 0 });
    s.label = label;
    s.tries++;
    if (right) s.right++;
  }

  // ---------- Hint: reveal the next cell of one unfinished path ----------
  // A hint shows at most half the numbers of a route (from either end), so he always finds and
  // adds the rest himself, and hints come at most every HINT_WAIT seconds.
  const hintCap = (p) => Math.max(1, Math.floor((puzzle.pairs[p].sol.length - 2) / 2));
  const hintWait = () => Math.max(0, Math.ceil(HINT_WAIT - (stats.seconds - lastHintAt)));

  function hint() {
    let p = drawing >= 0 && !isCorrect(drawing) ? drawing : -1;
    if (p < 0 && !isCorrect(active)) p = active;
    if (p < 0) p = puzzle.pairs.findIndex((_, k) => !isCorrect(k));
    if (p < 0) return;
    const pr = puzzle.pairs[p];
    const P = paths[p];
    const S = P.length && P[0] === pr.sol[pr.sol.length - 1] ? [...pr.sol].reverse() : pr.sol;
    let k = 0;
    while (k < P.length && P[k] === S[k]) k++;
    const next = S.slice(0, Math.max(1, k) + 1);
    const shown = next[next.length - 1];
    const isNum = puzzle.cells[shown].pair < 0;
    if (hintSeen[p].size >= hintCap(p) && !(isNum && hintSeen[p].has(shown))) {
      // Half the route is shown already: the rest is his to find (and add).
      MQ.Sound.note(64, 'bell', { dur: 0.5, vel: 0.1 });
      say(`💪 You can do the rest — add them up! ${pr.color.emoji} Make ${pr.target}.`);
      MQ.Voice.say(`You can do the rest. Add them up! Make ${pr.target}.`, 'en-US', { interrupt: true });
      return;
    }
    const wait = hintWait();
    if (wait > 0) {
      MQ.Sound.note(55, 'wood', { dur: 0.12, vel: 0.25 });
      say(`🤔 Try it yourself first! Another hint in ${wait} second${wait === 1 ? '' : 's'}.`);
      MQ.Voice.say('Try it yourself first! Another hint soon.', 'en-US', { interrupt: true });
      return;
    }
    if (isNum) hintSeen[p].add(shown);
    lastHintAt = stats.seconds;
    // Anything else sitting on those cells gets trimmed back so the hint path fits.
    let moved = false;
    paths.forEach((Q, q) => {
      if (q === p) return;
      const hit = Q.findIndex((i) => next.includes(i));
      if (hit >= 0) { paths[q] = Q.slice(0, hit); moved = true; }
    });
    paths[p] = next;
    stats.hints++;
    drawing = p;
    active = p;
    const h = next[next.length - 1];
    cursor = h;
    hintFlash = { i: h, t: 0 };
    grow = { p, t: 0 };
    MQ.Sound.star();
    if (h === partnerOf(p, next[0])) { arrive(p); return; }
    const num = puzzle.cells[h].num;
    say(`💡 Try going through the ${num} next! ${moved ? '(I moved another path out of the way.) ' : ''}${kb('Keep going with the arrows.', 'Drag on from the end of the path.')}`);
    MQ.Voice.say(`Try the ${num} next!`, 'en-US', { interrupt: true });
    updateHud();
  }

  // The 💡 button rests (dimmed, with a countdown) between hints.
  let hintBtnShown = null;
  function updateHintBtn() {
    const wait = state === 'play' && puzzle ? hintWait() : 0;
    if (wait === hintBtnShown) return;
    hintBtnShown = wait;
    el('btn-hint').classList.toggle('cool', wait > 0);
    el('hint-tl').textContent = wait > 0 ? `Hint in ${wait}` : 'Hint';
  }

  // ---------- HUD ----------
  function dotHtml(pr, small) {
    return `<span class="dot${small ? ' small' : ''}" style="background:${pr.color.c};color:${pr.color.ink}">${pr.target}</span>`;
  }

  function updateHud() {
    el('level').textContent = g.level;
    el('stars').textContent = data.stars;
    el('pairs').innerHTML = puzzle.pairs.map((pr, p) => {
      const s = sumOf(p);
      let cls = 'chip', status;
      if (isCorrect(p)) { cls += ' done'; status = '✅'; }
      else if (terms(p).length && !live()) status = '…'; // level 3+: no running total
      else if (terms(p).length) { status = `${s}`; if (s > pr.target) cls += ' over'; }
      else status = '·';
      if (p === active) cls += ' active';
      const z = zh(pr.target);
      return `<div class="${cls}">${dotHtml(pr)}${z ? `<span class="zhn zh">${z}</span>` : ''}<span class="status">${status}</span></div>`;
    }).join('');

    const p = active;
    const pr = puzzle.pairs[p];
    const t = terms(p);
    const s = sumOf(p);
    const box = el('sum-box');
    const sent = el('sentence');
    const need = el('need');
    // Level 3+: the total is only shown once the path has reached the other dot.
    const reveal = live() || isComplete(p);
    box.classList.toggle('good', reveal && s === pr.target && t.length > 0);
    box.classList.toggle('over', reveal && s > pr.target);
    need.className = 'need';
    sent.classList.toggle('long', t.length > 3 || s >= 100);
    if (!t.length) {
      sent.innerHTML = `${dotHtml(pr, true)} <span class="eq">make</span> ${pr.target}`;
      need.textContent = paths[p].length ? 'Walk to a number ➜' : kb('Press space on a dot to start', '👆 Drag from a dot to start');
    } else if (!reveal) {
      sent.innerHTML = `${t.join(' + ')} <span class="eq">=</span> <span class="total">?</span>`;
      need.textContent = `Add them up! Make ${pr.target}.`;
    } else {
      sent.innerHTML = `${t.join(' + ')} <span class="eq">=</span> <span class="total">${s}</span>`;
      if (isCorrect(p)) { need.textContent = `✅ Exactly ${pr.target}!`; need.classList.add('done'); }
      else if (s === pr.target) { need.textContent = `🎯 ${pr.target}! Now go to the other dot`; need.classList.add('done'); }
      else if (s > pr.target) { need.textContent = `Too much! ${s - pr.target} over ${pr.target} ↩`; need.classList.add('over'); }
      else need.textContent = `Need ${pr.target - s} more to make ${pr.target}`;
    }
    el('sentence-zh').hidden = !data.settings.chinese;
    el('sentence-zh').textContent = t.length && data.settings.chinese ? `${t.map((v) => MQ.zhNumber(v)).join(' 加 ')} 等于 ${reveal ? MQ.zhNumber(s) : '几？'}` : '';
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
    if (state === 'play' && (DIRS[k] || k === ' ' || k === 'Enter') && !keyMode) { keyMode = true; updateHud(); }

    if ((k === 'm' || k === 'M') && !e.repeat) { toggleMusic(); return; }
    if (state === 'play') {
      if (DIRS[k]) {
        if (drawing >= 0) step(...DIRS[k]);
        else moveCursor(...DIRS[k]);
      } else if ((k === ' ' || k === 'Enter') && !e.repeat) pressCell(cursor);
      else if (k === 'Escape') {
        if (drawing >= 0) cancelDrawing();
        else showPause();
      } else if ((k === 'h' || k === 'H') && !e.repeat) hint();
      else if ((k === 'r' || k === 'R') && !e.repeat) confirmReset();
      else if (k === 'p' || k === 'P') showPause();
      return;
    }
    if (overlayKeys && !e.repeat) overlayKeys(k, e);
  });

  function toggleMusic() {
    data.settings.music = data.settings.music === false;
    MQ.applySettings(data.settings);
    persist();
    say(data.settings.music ? '🎵 Music on' : '🔇 Music off');
    updateMusicBtn();
  }
  function updateMusicBtn() {
    const on = data.settings.music !== false;
    el('music-ic').textContent = on ? '🎵' : '🔇';
    el('music-tl').textContent = on ? 'Music' : 'Music off';
    el('btn-music').classList.toggle('off', !on);
  }

  function moveCursor(dr, dc) {
    const { r, c } = rc(cursor);
    const nr = Math.max(0, Math.min(puzzle.n - 1, r + dr));
    const nc = Math.max(0, Math.min(puzzle.n - 1, c + dc));
    if (nr === r && nc === c) { MQ.Sound.note(45, 'wood', { dur: 0.08, vel: 0.3 }); return; }
    cursor = nr * puzzle.n + nc;
    MQ.Sound.click();
    const cp = puzzle.cells[cursor].pair;
    if (cp >= 0) {
      const pr = puzzle.pairs[cp];
      say(isCorrect(cp) ? `${pr.color.emoji} ${pr.target} is done ✅` : `${pr.color.emoji} ${pr.target}! Press space to start drawing.`);
    } else {
      const q = occupant(cursor);
      if (q >= 0 && !isCorrect(q)) say(`Press space to pick up the ${puzzle.pairs[q].color.emoji} path here.`);
    }
  }

  // Closest dot of a pair that is not finished yet (so SPACE in the wrong place still helps).
  function nearestOpenDot(from) {
    const a = rc(from);
    let best = -1, bestD = 1e9;
    puzzle.pairs.forEach((pr, p) => {
      if (isCorrect(p)) return;
      for (const i of [pr.a, pr.b]) {
        const b = rc(i);
        const d = Math.abs(a.r - b.r) + Math.abs(a.c - b.c);
        if (d < bestD) { bestD = d; best = i; }
      }
    });
    return best;
  }

  function pressCell(i, fromPointer) {
    if (drawing >= 0) { release(); MQ.Sound.note(60, 'harp', { dur: 0.3, vel: 0.08 }); return; }
    const cp = puzzle.cells[i].pair;
    if (cp >= 0 && isCorrect(cp) && !fromPointer) {
      // A finished dot: don't wreck it — hop the cursor to the next dot that still needs a path.
      const j = nearestOpenDot(i);
      if (j >= 0) {
        cursor = j;
        const pr = puzzle.pairs[puzzle.cells[j].pair];
        MQ.Sound.note(72, 'bell', { dur: 0.5, vel: 0.1 });
        say(`✅ That one is done! Here is the ${pr.color.emoji} ${pr.target}. Press space to start it.`);
      }
      return;
    }
    if (cp >= 0) { startDraw(cp, i); return; }
    const q = occupant(i);
    if (q >= 0) { startDraw(q, i); return; }
    const j = nearestOpenDot(i);
    if (j < 0) return;
    cursor = j;
    MQ.Sound.note(72, 'bell', { dur: 0.5, vel: 0.1 });
    const pr = puzzle.pairs[puzzle.cells[j].pair];
    say(`Paths start on a dot. Here is the ${pr.color.emoji} ${pr.target}! Press space again to start.`);
  }

  function cancelDrawing() {
    const p = drawing;
    paths[p] = [];
    drawing = -1;
    MQ.Sound.putBack();
    say(`${puzzle.pairs[p].color.emoji} Path cleared. Press space on a dot to try again.`);
    updateHud();
  }

  // Mouse / finger: press on a dot or path and drag through the cells, like Flow Free.
  let pointerDrawing = false;
  let pointerKind = 'mouse';
  let fingerPt = null; // board coords of the finger while dragging (for the sum bubble)
  let blocked = { head: -1, cells: new Set() }; // blocked moves already complained about
  // Press on a finished ✅ pair: nothing changes until the finger/mouse really drags out of the
  // touched cell (then that pair is re-drawn, as before). A plain tap just says it's done.
  let doneGrab = null; // { p, i, cell, pt }
  function boardPos(ev) {
    const rect = canvas.getBoundingClientRect();
    return { x: ((ev.clientX - rect.left) / rect.width) * W, y: ((ev.clientY - rect.top) / rect.height) * H };
  }
  function cellAtPos(pt) {
    const c = Math.floor((pt.x - geo.x0) / geo.cell);
    const r = Math.floor((pt.y - geo.y0) / geo.cell);
    if (r < 0 || c < 0 || r >= puzzle.n || c >= puzzle.n) return -1;
    return r * puzzle.n + c;
  }
  const grabbable = (i) => i >= 0 && (puzzle.cells[i].pair >= 0 || occupant(i) >= 0);
  // Fingers are fat: if the touch lands just beside a dot or path, grab that instead.
  function nearestGrabbable(pt, maxDist) {
    let best = -1, bestD = maxDist;
    for (let i = 0; i < puzzle.n * puzzle.n; i++) {
      if (!grabbable(i)) continue;
      const c = cellCenter(i);
      const d = Math.hypot(c.x - pt.x, c.y - pt.y);
      const bonus = puzzle.cells[i].pair >= 0 ? geo.cell * 0.1 : 0; // prefer dots
      if (d - bonus < bestD) { bestD = d - bonus; best = i; }
    }
    return best;
  }
  canvas.addEventListener('pointerdown', (ev) => {
    if (state !== 'play') return;
    pointerKind = ev.pointerType || 'mouse';
    const touchy = pointerKind !== 'mouse';
    if (touchy && keyMode && MQ.isTouch) { keyMode = false; }
    const pt = boardPos(ev);
    const touched = cellAtPos(pt);
    let i = touched;
    if (touchy && !grabbable(i)) {
      const j = nearestGrabbable(pt, geo.cell * 0.7);
      if (j >= 0) i = j;
    }
    if (i < 0) return;
    ev.preventDefault();
    if (drawing >= 0) release(false);
    cursor = i;
    blocked = { head: -1, cells: new Set() };
    doneGrab = null;
    const owner = grabbable(i) ? occupant(i) : -1;
    if (owner >= 0 && isCorrect(owner)) {
      // A finished ✅ dot or path: don't wreck it on a tap — wait and see if he drags.
      doneGrab = { p: owner, i, cell: touched, pt };
      pointerDrawing = false;
      fingerPt = null;
      try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    } else if (grabbable(i)) {
      pressCell(i, true);
      pointerDrawing = drawing >= 0;
      fingerPt = pt;
      try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    } else if (touchy) {
      // Tapped an empty number: show where paths start.
      const j = nearestOpenDot(i);
      MQ.Sound.click();
      if (j >= 0) {
        const pr = puzzle.pairs[puzzle.cells[j].pair];
        ping = { i: j, t: 0 };
        say(`Paths start on a dot 👆 Put your finger on the ${pr.color.emoji} ${pr.target} and drag!`);
      }
      updateHud();
    } else {
      MQ.Sound.click();
    }
  });
  // Follow the finger: step along the dominant direction once it is well inside the next cell
  // (a little dead zone stops diagonal wobble); fast swipes fill every cell on the way.
  function followFinger(pt) {
    const n = puzzle.n;
    const fx = Math.max(0, Math.min(n - 0.001, (pt.x - geo.x0) / geo.cell));
    const fy = Math.max(0, Math.min(n - 0.001, (pt.y - geo.y0) / geo.cell));
    const TH = pointerKind === 'mouse' ? 0.5 : 0.6;
    let guard = 0;
    while (drawing >= 0 && guard++ < n * 3) {
      const hi = head(drawing);
      if (blocked.head !== hi) blocked = { head: hi, cells: new Set() };
      const h = rc(hi);
      const dx = fx - (h.c + 0.5), dy = fy - (h.r + 0.5);
      const ax = Math.abs(dx), ay = Math.abs(dy);
      if (ax <= TH && ay <= TH) break;
      const moves = [];
      if (ax >= ay) { moves.push([0, Math.sign(dx)]); if (ay > TH) moves.push([Math.sign(dy), 0]); }
      else { moves.push([Math.sign(dy), 0]); if (ax > TH) moves.push([0, Math.sign(dx)]); }
      let moved = false;
      for (const [dr, dc] of moves) {
        const target = (h.r + dr) * n + (h.c + dc);
        if (blocked.cells.has(target)) continue;
        if (step(dr, dc)) { moved = true; if (pointerKind !== 'mouse') everDragged = true; break; }
        blocked.cells.add(target);
      }
      if (!moved) break;
    }
  }
  canvas.addEventListener('pointermove', (ev) => {
    if (!pointerDrawing || drawing < 0 || state !== 'play') return;
    ev.preventDefault();
    const pt = boardPos(ev);
    fingerPt = pt;
    followFinger(pt);
  });
  const endPointer = () => {
    fingerPt = null;
    if (!pointerDrawing) return;
    pointerDrawing = false;
    if (drawing >= 0) release(false);
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  // On-screen buttons (phones / tablets / narrow windows).
  function tapButton(id, fn) {
    let lastTap = 0;
    el(id).addEventListener('click', (ev) => {
      ev.preventDefault();
      const now = performance.now();
      if (now - lastTap < 350) return; // no accidental double taps
      lastTap = now;
      MQ.Sound.ensure();
      fn();
      el(id).blur();
    });
  }
  tapButton('btn-hint', () => { if (state === 'play') { pointerDrawing = false; hint(); } });
  tapButton('btn-reset', () => { if (state === 'play') { pointerDrawing = false; MQ.Sound.click(); confirmReset(); } });
  tapButton('btn-pause', () => { if (state === 'play') { MQ.Sound.click(); showPause(); } });
  tapButton('btn-music', () => toggleMusic());

  // ---------- Win / results / adapting difficulty ----------
  function win() {
    state = 'won';
    drawing = -1;
    setTimeout(() => MQ.Sound.win(), 500);
    for (let i = 0; i < 6; i++) {
      setTimeout(() => burst(rand(120, W - 120), rand(120, H - 200), pick(COLORS).c, 26), 300 + i * 160);
    }
    for (let i = 0; i < 9; i++) {
      lanterns.push({ x: rand(60, W - 60), y: H + rand(20, 260), vy: 70 + Math.random() * 50, sway: Math.random() * 6, emoji: pick(['🏮', '🏮', '🏮', '⭐', '🎈']) });
    }
    const praise = MQ.pick(MQ.PRAISE);
    say(`${praise.zh} ${praise.en} Every path adds up!`);
    setTimeout(() => {
      if (data.settings.chinese) MQ.Voice.say(praise.zh, 'zh-CN');
      else MQ.Voice.say(praise.en, 'en-US');
    }, 1400);
    setTimeout(() => showResult(praise), 2300);
  }

  function starsFor(s) {
    if (s.hints === 0 && s.resets === 0 && s.wrongs <= 2) return 3;
    if (s.hints <= 1 && s.resets <= 1) return 2;
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
    if (g.level > before) return { text: '⬆ Level up! The next puzzle is a little harder.', kind: 'up' };
    if (g.level < before) return { text: "Let's practice an easier one, then come back up!", kind: 'down' };
    return { text: 'Another puzzle at this level — go for 3 stars!', kind: 'same' };
  }

  function summary() {
    const n = puzzle.n;
    const bits = [`${n}×${n}`, `${puzzle.pairs.length} pairs`];
    if (stats.hints) bits.push(`${stats.hints} hint${stats.hints === 1 ? '' : 's'}`);
    if (stats.resets) bits.push(`${stats.resets} restart${stats.resets === 1 ? '' : 's'}`);
    if (stats.wrongs) bits.push(`${stats.wrongs} wrong sum${stats.wrongs === 1 ? '' : 's'}`);
    return bits.join(', ');
  }

  function showResult(praise) {
    const stars = starsFor(stats);
    const level = g.level;
    g.history.push({ level, stars, seconds: Math.round(stats.seconds), date: new Date().toISOString(), summary: summary() });
    if (g.history.length > 200) g.history.splice(0, g.history.length - 200);
    const heroesBefore = MQ.unlockedHeroes(data.stars).length;
    data.stars += stars;
    const newHero = MQ.unlockedHeroes(data.stars).slice(heroesBefore)[0];
    const move = adapt(stars);
    persist();
    updateHud();

    state = 'result';
    if (stars) setTimeout(() => MQ.Sound.star(), 200);
    const starHtml = [1, 2, 3].map((i) => `<span class="${i <= stars ? '' : 'off'}">⭐</span>`).join('');
    const sums = puzzle.pairs.map((pr, p) => `<div>${dotHtml(pr, true)} ${terms(p).join(' + ')} = ${sumOf(p)}</div>`).join('');
    showOverlay(`
      <div class="card">
        <h2>Puzzle solved! 🎉</h2>
        <div class="stars-row">${starHtml}</div>
        <div class="praise"><span class="zh">${praise.zh}</span><small>${praise.py} · ${praise.en}</small></div>
        <div class="sums">${sums}</div>
        <div class="stats">
          <span>🧩 Level ${level} · ${puzzle.n}×${puzzle.n}</span>
          <span>💡 ${stats.hints} hint${stats.hints === 1 ? '' : 's'}</span>
          <span>🔄 ${stats.resets} restart${stats.resets === 1 ? '' : 's'}</span>
        </div>
        <div class="next">${move.text}</div>
        ${newHero ? `<div class="next">🎉 New hero unlocked: ${newHero.emoji} ${newHero.name}! Pick it in the portal.</div>` : ''}
        <div class="press keys-only">Press <span class="key">return</span> for the next puzzle</div>
        <button class="btn go touch-only" type="button">Next ▶</button>
      </div>`,
      (k) => { if (k === 'Enter' || k === ' ') nextPuzzle(); }
    );
    overlay.querySelector('.card').addEventListener('click', armed(nextPuzzle));
  }

  function nextPuzzle() {
    if (state !== 'result') return;
    newPuzzle();
    showIntro();
  }

  // ---------- Overlays ----------
  let overlayKeys = null;
  let overlayAt = 0;
  // Taps on a card only count after it has been up a moment (no accidental double actions).
  const armed = (fn) => () => { if (performance.now() - overlayAt > 450) fn(); };
  function showOverlay(html, keys) {
    overlayAt = performance.now();
    overlay.innerHTML = html;
    overlay.hidden = false;
    overlayKeys = keys;
  }
  function hideOverlay() {
    overlay.hidden = true;
    overlay.innerHTML = '';
    overlayKeys = null;
  }

  // Tiny picture for the intro card: a 3×2 board, 7 ⋯ 7 on top with a 5 between them and
  // 3 1 3 underneath. The straight way makes 5 (wrong); going around makes 3 + 1 + 3 = 7.
  function demoBoard(route) {
    const nums = [7, 5, 7, 3, 1, 3];
    const at = (i) => ({ x: 22 + (i % 3) * 44, y: 22 + Math.floor(i / 3) * 44 });
    const tiles = nums.map((_, i) => { const { x, y } = at(i); return `<rect x="${x - 20}" y="${y - 20}" width="40" height="40" rx="8" fill="#ece6ff"/>`; }).join('');
    const line = route.map((i) => { const { x, y } = at(i); return `${x},${y}`; }).join(' ');
    const marks = nums.map((v, i) => {
      const { x, y } = at(i);
      const dot = i === 0 || i === 2;
      const on = route.includes(i);
      return dot
        ? `<circle cx="${x}" cy="${y}" r="17" fill="#4c8dff" stroke="#fff" stroke-width="3"/><text x="${x}" y="${y + 6}" fill="#fff">${v}</text>`
        : `<circle cx="${x}" cy="${y}" r="12" fill="#fff" stroke="${on ? '#2a5fcf' : '#d5cdea'}" stroke-width="${on ? 3 : 2}"/><text x="${x}" y="${y + 6}" fill="#2d2a32">${v}</text>`;
    }).join('');
    return `<svg viewBox="0 0 132 88" aria-hidden="true">${tiles}<polyline points="${line}" fill="none" stroke="#4c8dff" stroke-width="11" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>${marks}</svg>`;
  }

  function showIntro() {
    state = 'intro';
    const first = g.played === 0;
    const targets = puzzle.pairs.map((pr) => `<div>${dotHtml(pr)}${zh(pr.target) ? `<span class="zhn zh">${zh(pr.target)}</span>` : ''}</div>`).join('');
    const demo = `
      <div class="demo">
        <figure class="no">${demoBoard([0, 1, 2])}<figcaption>5 ✗ <small>not 7</small></figcaption></figure>
        <figure class="yes">${demoBoard([0, 3, 4, 5, 2])}<figcaption>3 + 1 + 3 = 7 ✅</figcaption></figure>
      </div>
      <div class="demo-tip">The short way is usually wrong.<br><b>Add up</b> the numbers and go around!</div>`;
    showOverlay(`
      <div class="card">
        <h1>🧩 Level ${g.level}</h1>
        <p>Connect each pair of dots.<br>The numbers on your path must <b>add up</b> to the dot!</p>
        ${first || g.level <= 2 ? demo : '<p class="hint">🤔 The short way is usually wrong — add up and go around!</p>'}
        <div class="targets">${targets}</div>
        ${first ? `<p class="hint keys-only">Move with the arrows. Press <span class="key">space</span> on a dot, then walk to its twin.<br>Step back to undo. Stuck? Press <span class="key">H</span> for a hint.</p>` : ''}
        ${first ? `<p class="hint touch-only">👆 Put your finger on a dot and drag to its twin.<br>Slide back to undo. Stuck? Tap 💡 Hint.</p>` : ''}
        <div class="press keys-only">Press <span class="key">return</span> to start</div>
        <button class="btn go touch-only" type="button">Start ▶</button>
      </div>`,
      (k) => { if (k === 'Enter' || k === ' ') startPlay(); }
    );
    overlay.querySelector('.card').addEventListener('click', armed(startPlay));
    const list = puzzle.pairs.map((pr) => pr.target);
    const spoken = list.length === 2 ? `${list[0]} and ${list[1]}` : `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
    const rules = g.played < 3 ? ' Draw a path from a dot to the dot with the same color. The numbers on your path must add up to the number on the dot. The short way usually won\'t work, so add up the numbers and go around!' : '';
    MQ.Voice.say(`Level ${g.level}.${rules} Make ${spoken}.`, 'en-US', { interrupt: true });
    if (data.settings.chinese) MQ.Voice.say(list.map((v) => MQ.zhNumber(v)).join(','), 'zh-CN');
    say('Connect each pair of dots. Add up the numbers on the way!');
  }

  function startPlay() {
    if (state !== 'intro') return;
    hideOverlay();
    state = 'play';
    MQ.Sound.click();
    const pr = puzzle.pairs[0];
    cursor = pr.a;
    active = 0;
    say(kb(`The box is on the ${pr.color.emoji} ${pr.target}. Press space to start drawing!`, `👆 Put your finger on the ${pr.color.emoji} ${pr.target} and drag to the other ${pr.color.emoji} ${pr.target}!`));
    updateHud();
  }

  function showPause() {
    state = 'pause';
    drawing = -1;
    pointerDrawing = false;
    fingerPt = null;
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
          if (k === 'ArrowUp' || k === 'ArrowDown') { sel = 1 - sel; MQ.Sound.click(); render(); }
          else if (k === 'Enter' || k === ' ') items[sel][1]();
          else if (k === 'Escape') items[0][1]();
        });
      overlay.querySelectorAll('.menu .btn').forEach((b) => b.addEventListener('click', armed(() => items[Number(b.dataset.i)][1]())));
    };
    render();
  }

  function confirmReset() {
    if (paths.every((P) => P.length === 0)) { say(kb('The board is already empty. Press space on a dot to start!', 'The board is already empty. Drag from a dot to start!')); return; }
    state = 'confirm';
    drawing = -1;
    pointerDrawing = false;
    fingerPt = null;
    const back = () => { hideOverlay(); state = 'play'; };
    const yes = () => {
      hideOverlay();
      state = 'play';
      paths = puzzle.pairs.map(() => []);
      stats.resets++;
      active = 0;
      MQ.Sound.putBack();
      say(kb('Fresh start! Press space on a dot.', 'Fresh start! Drag from a dot.'));
      updateHud();
    };
    showOverlay(`
      <div class="card">
        <h2>🔄 Start this puzzle over?</h2>
        <p>All the paths will be erased.</p>
        <div class="menu">
          <button class="btn" data-a="yes">Yes, start over <span class="key keys-only">return</span></button>
          <button class="btn secondary" data-a="no">No, keep my paths <span class="key keys-only">esc</span></button>
        </div>
      </div>`,
      (k) => { if (k === 'Enter' || k === ' ') yes(); else if (k === 'Escape' || k === 'r' || k === 'R') back(); }
    );
    overlay.querySelector('[data-a=yes]').addEventListener('click', armed(yes));
    overlay.querySelector('[data-a=no]').addEventListener('click', armed(back));
  }

  // ---------- Update loop ----------
  function cellCenter(i) {
    const { r, c } = rc(i);
    return { x: geo.x0 + (c + 0.5) * geo.cell, y: geo.y0 + (r + 0.5) * geo.cell };
  }

  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 60 + Math.random() * 180;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 80, life: 0.8 + Math.random() * 0.6, color, size: 3 + Math.random() * 5, spin: Math.random() * 6 });
    }
  }

  function update(dt) {
    time += dt;
    if (state === 'play') {
      stats.seconds += dt;
      g.seconds += dt;
      data.playSeconds += dt;
      if (time - lastSaveAt > 15) { lastSaveAt = time; persist(); }
    }
    if (grow) { grow.t += dt / STEP_TIME; if (grow.t >= 1) grow = null; }
    if (hintFlash) { hintFlash.t += dt; if (hintFlash.t > 2) hintFlash = null; }
    if (ping) { ping.t += dt; if (ping.t > 1.8) ping = null; }
    if (wrongFlash) { wrongFlash.t += dt; if (wrongFlash.t > 1.2) wrongFlash = null; }
    for (const s of shimmers) s.t += dt;
    shimmers = shimmers.filter((s) => s.t < 1.4);
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 380 * dt; p.life -= dt; }
    particles = particles.filter((p) => p.life > 0);
    for (const f of floaters) { f.y -= 40 * dt; f.life -= dt * 1.2; }
    floaters = floaters.filter((f) => f.life > 0);
    for (const l of lanterns) l.y -= l.vy * dt;
    lanterns = lanterns.filter((l) => l.y > -80);
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

  function drawBackground() {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#2e2a5c');
    bg.addColorStop(1, '#3d2f5e');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // A few soft "stars" in the dusk sky around the board.
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let k = 0; k < 26; k++) {
      const x = (k * 137.5) % W;
      const y = (k * 71.3 + 13) % H;
      const tw = 0.5 + 0.5 * Math.sin(time * 1.3 + k);
      ctx.globalAlpha = 0.15 + 0.25 * tw;
      ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Board tray
    const { x0, y0, cell } = geo;
    const size = cell * puzzle.n;
    const tp = Math.min(12, x0 - 3);
    roundRect(x0 - tp, y0 - tp, size + tp * 2, size + tp * 2, 26);
    ctx.fillStyle = 'rgba(15,12,40,0.45)';
    ctx.fill();
  }

  function drawTiles() {
    const { x0, y0, cell } = geo;
    const n = puzzle.n;
    const gap = Math.max(4, cell * 0.06);
    const owner = new Int8Array(n * n).fill(-1);
    paths.forEach((P, p) => P.forEach((i) => { owner[i] = p; }));
    for (let i = 0; i < n * n; i++) {
      const r = Math.floor(i / n), c = i % n;
      const x = x0 + c * cell + gap / 2, y = y0 + r * cell + gap / 2, s = cell - gap;
      roundRect(x, y, s, s, cell * 0.16);
      const tile = ctx.createLinearGradient(0, y, 0, y + s);
      tile.addColorStop(0, '#474173');
      tile.addColorStop(1, '#3a3462');
      ctx.fillStyle = tile;
      ctx.fill();
      const p = owner[i];
      if (p >= 0) {
        ctx.fillStyle = puzzle.pairs[p].color.c;
        ctx.globalAlpha = isCorrect(p) ? 0.3 + 0.06 * Math.sin(time * 3) : 0.2;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      // top highlight
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // Points of path p (with the newest segment partly grown).
  function pathPoints(p) {
    const pts = paths[p].map(cellCenter);
    if (grow && grow.p === p && pts.length >= 2) {
      const a = pts[pts.length - 2], b = pts[pts.length - 1], t = ease(Math.min(1, grow.t));
      pts[pts.length - 1] = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    return pts;
  }

  function strokePts(pts) {
    ctx.beginPath();
    pts.forEach((pt, k) => (k ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
    ctx.stroke();
  }

  function drawPaths() {
    const w = geo.cell * 0.3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    paths.forEach((P, p) => {
      if (P.length < 2) return;
      const col = puzzle.pairs[p].color;
      const pts = pathPoints(p);
      const done = isCorrect(p);
      const wrong = wrongFlash && wrongFlash.p === p ? Math.sin(wrongFlash.t * 18) * 3 * (1 - wrongFlash.t / 1.2) : 0;
      if (wrong) { ctx.save(); ctx.translate(wrong, 0); }
      // soft glow
      ctx.save();
      ctx.shadowColor = col.c;
      ctx.shadowBlur = done ? 22 + 8 * Math.sin(time * 3) : 10;
      ctx.strokeStyle = col.dark;
      ctx.lineWidth = w + 6;
      strokePts(pts);
      ctx.restore();
      // body
      ctx.strokeStyle = col.c;
      ctx.lineWidth = w;
      strokePts(pts);
      // inner highlight (a lighter stripe shifted up a little = rounded tube look)
      ctx.save();
      ctx.translate(0, -w * 0.14);
      ctx.strokeStyle = 'rgba(255,255,255,0.32)';
      ctx.lineWidth = w * 0.3;
      strokePts(pts);
      ctx.restore();
      if (wrong) ctx.restore();
    });
    // Shimmer: a bright spark that runs along a just-finished path.
    for (const s of shimmers) {
      const pts = paths[s.p].map(cellCenter);
      if (pts.length < 2) continue;
      const along = Math.min(1, s.t / 0.9) * (pts.length - 1);
      const k = Math.min(pts.length - 2, Math.floor(along));
      const f = along - k;
      const x = pts[k].x + (pts[k + 1].x - pts[k].x) * f;
      const y = pts[k].y + (pts[k + 1].y - pts[k].y) * f;
      const fade = s.t < 0.9 ? 1 : Math.max(0, 1 - (s.t - 0.9) / 0.5);
      const rg = ctx.createRadialGradient(x, y, 0, x, y, geo.cell * 0.5);
      rg.addColorStop(0, `rgba(255,255,255,${0.95 * fade})`);
      rg.addColorStop(0.4, `rgba(255,255,230,${0.45 * fade})`);
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(x, y, geo.cell * 0.5, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawNumbers() {
    const n = puzzle.n;
    const cell = geo.cell;
    const owner = new Int8Array(n * n).fill(-1);
    paths.forEach((P, p) => P.forEach((i) => { owner[i] = p; }));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < n * n; i++) {
      const cl = puzzle.cells[i];
      if (cl.pair >= 0) continue;
      const { x, y } = cellCenter(i);
      const p = owner[i];
      const big = cl.num >= 10;
      const R = cell * 0.27;
      // bead
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 2;
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2);
      const bead = ctx.createRadialGradient(x - R * 0.35, y - R * 0.4, R * 0.1, x, y, R);
      if (big) { bead.addColorStop(0, '#fffaf0'); bead.addColorStop(1, '#ffe7b0'); }
      else { bead.addColorStop(0, '#ffffff'); bead.addColorStop(1, '#efe8dc'); }
      ctx.fillStyle = bead;
      ctx.globalAlpha = p >= 0 ? 1 : 0.92;
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
      if (p >= 0) {
        ctx.lineWidth = Math.max(3, cell * 0.04);
        ctx.strokeStyle = puzzle.pairs[p].color.dark;
        ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = big ? '#7a4a00' : '#2d2a32';
      ctx.font = `900 ${Math.round(cell * (big ? 0.25 : 0.3))}px ${UI_FONT}`;
      ctx.fillText(String(cl.num), x, y + cell * 0.015);
    }
  }

  function drawDots() {
    const cell = geo.cell;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    puzzle.pairs.forEach((pr, p) => {
      for (const i of [pr.a, pr.b]) {
        const { x, y } = cellCenter(i);
        const done = isCorrect(p);
        const pulse = done ? 0 : Math.sin(time * 3 + p) * 0.025;
        const R = cell * (0.37 + pulse);
        ctx.save();
        ctx.shadowColor = done ? pr.color.c : 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = done ? 24 : 10;
        ctx.shadowOffsetY = done ? 0 : 3;
        ctx.beginPath(); ctx.arc(x, y, R + cell * 0.045, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff'; // white ring
        ctx.fill();
        ctx.restore();
        const grad = ctx.createRadialGradient(x - R * 0.35, y - R * 0.45, R * 0.1, x, y, R);
        grad.addColorStop(0, pr.color.light);
        grad.addColorStop(0.55, pr.color.c);
        grad.addColorStop(1, pr.color.dark);
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
        const z = zh(pr.target);
        const big = pr.target >= 10;
        ctx.fillStyle = pr.color.ink;
        ctx.font = `900 ${Math.round(cell * (big ? 0.3 : 0.34))}px ${UI_FONT}`;
        ctx.fillText(String(pr.target), x, y - (z ? cell * 0.06 : 0) + cell * 0.01);
        if (z) {
          ctx.globalAlpha = 0.9;
          ctx.font = `700 ${Math.round(cell * 0.12)}px "PingFang SC","Hiragino Sans GB","Noto Sans SC",sans-serif`;
          ctx.fillText(z, x, y + cell * 0.19);
          ctx.globalAlpha = 1;
        }
        if (done) {
          ctx.font = `${Math.round(cell * 0.2)}px ${EMOJI_FONT}`;
          ctx.fillStyle = '#000';
          ctx.fillText('✅', x + R * 0.8, y - R * 0.8);
        }
      }
    });
  }

  function drawCursor() {
    if (state !== 'play' && state !== 'intro') return;
    if (!keyMode) return; // touch: no keyboard box unless keys are used
    const { r, c } = rc(cursor);
    const cell = geo.cell;
    const x = geo.x0 + c * cell, y = geo.y0 + r * cell;
    const pulse = 0.5 + 0.5 * Math.sin(time * 5);
    const col = drawing >= 0 ? puzzle.pairs[drawing].color.c : '#ffe066';
    ctx.save();
    ctx.shadowColor = col;
    ctx.shadowBlur = 16 + 10 * pulse;
    roundRect(x + 1, y + 1, cell - 2, cell - 2, cell * 0.2);
    ctx.lineWidth = 6;
    ctx.strokeStyle = col;
    ctx.stroke();
    ctx.restore();
    roundRect(x + 5, y + 5, cell - 10, cell - 10, cell * 0.17);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = `rgba(255,255,255,${0.6 + 0.4 * pulse})`;
    ctx.stroke();
    // Little bouncing hand when nothing is being drawn and the cursor sits on an unfinished dot.
    const cp = puzzle.cells[cursor].pair;
    if (drawing < 0 && state === 'play' && cp >= 0 && !isCorrect(cp)) {
      ctx.font = `${Math.round(cell * 0.28)}px ${EMOJI_FONT}`;
      ctx.fillStyle = '#000';
      ctx.fillText('👆', x + cell * 0.8, y + cell * 0.86 + Math.sin(time * 6) * 4);
    }
  }

  function drawHeadBubble() {
    const p = drawing >= 0 ? drawing : -1;
    if (p < 0) return;
    const finger = pointerDrawing && pointerKind !== 'mouse' && fingerPt;
    if (paths[p].length < (finger ? 1 : 2)) return;
    const pr = puzzle.pairs[p];
    const s = sumOf(p);
    const pts = pathPoints(p);
    const hpt = pts[pts.length - 1];
    const cell = geo.cell;
    const k = finger ? 1.35 : 1; // bigger on a phone
    const text = `${s}`;
    const sub = ` / ${pr.target}`;
    const fBig = Math.round(cell * 0.26 * k), fSmall = Math.round(cell * 0.16 * k);
    ctx.font = `900 ${fBig}px ${UI_FONT}`;
    const tw = ctx.measureText(text).width;
    ctx.font = `800 ${fSmall}px ${UI_FONT}`;
    const sw = ctx.measureText(sub).width;
    const w = tw + sw + cell * 0.24 * k, h = cell * 0.36 * k;
    let bx, by;
    if (finger) {
      // The finger hides the path head, so float the running sum well ABOVE the fingertip
      // (or beside it when the finger is on the top row).
      bx = fingerPt.x;
      by = fingerPt.y - cell * 1.1;
      if (by - h / 2 < 4) {
        by = Math.max(h / 2 + 4, fingerPt.y - cell * 0.2);
        bx = fingerPt.x + (fingerPt.x < W / 2 ? 1 : -1) * (cell * 0.95 + w / 2);
      }
      bx = Math.max(w / 2 + 4, Math.min(W - w / 2 - 4, bx));
      by = Math.max(h / 2 + 4, Math.min(H - h / 2 - 4, by));
    } else {
      const { r } = rc(head(p));
      bx = hpt.x + cell * 0.3;
      by = hpt.y + (r > 0 ? -cell * 0.5 : cell * 0.5);
      bx = Math.max(geo.x0 + w / 2 + 2, Math.min(geo.x0 + cell * puzzle.n - w / 2 - 2, bx));
    }
    const fill = s === pr.target ? '#2e9e5b' : s > pr.target ? '#e8742a' : '#ffffff';
    const ink = s === pr.target || s > pr.target ? '#ffffff' : pr.color.dark;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    roundRect(bx - w / 2, by - h / 2, w, h, h / 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = 3 * k;
    ctx.strokeStyle = pr.color.c;
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ink;
    ctx.font = `900 ${fBig}px ${UI_FONT}`;
    ctx.fillText(text, bx - w / 2 + cell * 0.12 * k, by + 1);
    ctx.font = `800 ${fSmall}px ${UI_FONT}`;
    ctx.globalAlpha = 0.8;
    ctx.fillText(sub, bx - w / 2 + cell * 0.12 * k + tw, by + 2);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
  }

  // Rings on a dot after an empty cell was tapped ("paths start here").
  function drawPing() {
    if (!ping) return;
    const { x, y } = cellCenter(ping.i);
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - ping.t / 1.8);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 5;
    for (let k = 0; k < 2; k++) {
      const rr = geo.cell * (0.42 + ((ping.t * 1.1 + k * 0.5) % 1) * 0.4);
      ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  // First plays on a phone: a little hand shows "put your finger on the dot and drag".
  function drawTouchHand() {
    if (keyMode || state !== 'play' || drawing >= 0 || everDragged || g.played >= 3) return;
    const p = puzzle.pairs.findIndex((_, q) => !isCorrect(q) && paths[q].length < 2);
    if (p < 0) return;
    const pr = puzzle.pairs[p];
    const a = cellCenter(pr.sol[0]);
    const b = cellCenter(pr.sol[1]);
    const cyc = (time % 2.4) / 2.4;
    const t = cyc < 0.3 ? 0 : cyc > 0.8 ? 1 : ease((cyc - 0.3) / 0.5);
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    const cell = geo.cell;
    ctx.save();
    ctx.globalAlpha = cyc > 0.9 ? (1 - cyc) * 10 : 1;
    if (t > 0) { // a faint trail from the dot
      ctx.strokeStyle = pr.color.c;
      ctx.lineCap = 'round';
      ctx.lineWidth = cell * 0.18;
      ctx.globalAlpha *= 0.55;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(x, y); ctx.stroke();
      ctx.globalAlpha /= 0.55;
    }
    ctx.font = `${Math.round(cell * 0.6)}px ${EMOJI_FONT}`;
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('👆', x + cell * 0.05, y - cell * 0.02 + (cyc < 0.3 ? Math.sin(cyc * 20) * 3 : 0));
    ctx.restore();
  }

  function drawHintFlash() {
    if (!hintFlash) return;
    const { x, y } = cellCenter(hintFlash.i);
    const t = hintFlash.t;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - t / 2);
    ctx.strokeStyle = '#fff3a0';
    ctx.lineWidth = 5;
    for (let k = 0; k < 2; k++) {
      const rr = geo.cell * (0.3 + ((t * 0.8 + k * 0.5) % 1) * 0.45);
      ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.font = `${Math.round(geo.cell * 0.26)}px ${EMOJI_FONT}`;
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💡', x - geo.cell * 0.34, y - geo.cell * 0.34);
    ctx.restore();
  }

  function drawEffects() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
      ctx.fillStyle = p.color;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.spin * p.life);
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.round(geo.cell * 0.22)}px ${UI_FONT}`;
    for (const f of floaters) {
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life * 1.5));
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#fff';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color || '#e07b00';
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    ctx.font = `44px ${EMOJI_FONT}`;
    ctx.fillStyle = '#000';
    for (const l of lanterns) ctx.fillText(l.emoji, l.x + Math.sin(time * 2 + l.sway) * 14, l.y);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    drawBackground();
    drawTiles();
    drawPaths();
    drawNumbers();
    drawDots();
    drawCursor();
    drawHintFlash();
    drawPing();
    drawEffects();
    drawTouchHand();
    drawHeadBubble();
  }

  // ---------- Sizing (crisp on Retina screens) ----------
  let pixelScale = 1;
  const root = document.documentElement;
  const layoutEl = el('layout');
  function resize() {
    const vw = window.innerWidth, vh = window.innerHeight;
    compact = vw <= 860 || vh <= 560;
    const land = compact && vw > vh;
    root.classList.toggle('nf-compact', compact);
    root.classList.toggle('nf-portrait', compact && !land);
    root.classList.toggle('nf-land', land);
    let scale;
    if (!compact) {
      const availW = window.innerWidth - 300 - 20 - 36;
      const availH = window.innerHeight - 24;
      scale = Math.max(0.4, Math.min(availW / W, availH / H, 1.5));
    } else {
      const cs = getComputedStyle(layoutEl);
      const innerW = layoutEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const innerH = layoutEl.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      let size;
      if (!land) {
        const gap = parseFloat(cs.rowGap) || 6;
        const others = ['.panel-top', '.pairs-box', '.sum-box', '.touchbar']
          .reduce((a, sel) => a + document.querySelector(sel).offsetHeight, 0);
        size = Math.min(innerW, innerH - others - gap * 5 - 54);
      } else {
        const gap = parseFloat(cs.columnGap) || 12;
        size = Math.min(innerH, innerW - 250 - gap);
      }
      scale = Math.max(150, Math.floor(size)) / W;
    }
    const dpr = window.devicePixelRatio || 1;
    stage.style.width = `${Math.round(W * scale)}px`;
    stage.style.height = `${Math.round(H * scale)}px`;
    canvas.style.width = `${Math.round(W * scale)}px`;
    canvas.style.height = `${Math.round(H * scale)}px`;
    canvas.width = Math.round(W * scale * dpr);
    canvas.height = Math.round(H * scale * dpr);
    pixelScale = scale * dpr;
    ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
    computeGeo();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => { resize(); setTimeout(resize, 300); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

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

  // Hook for automated tests.
  window.__game = {
    get state() { return state; },
    get level() { return g.level; },
    get puzzle() { return puzzle; },
    get solution() { return puzzle.pairs.map((pr) => pr.sol.slice()); },
    get paths() { return paths.map((P) => P.slice()); },
    get cursor() { return cursor; },
    get drawing() { return drawing; },
    get stats() { return Object.assign({}, stats); },
    get geo() { return Object.assign({}, geo); },
    get keyMode() { return keyMode; },
    get layout() { return compact ? (root.classList.contains('nf-land') ? 'landscape' : 'portrait') : 'laptop'; },
    isCorrect: (p) => isCorrect(p),
    generate, configFor,
  };

  MQ.Music.play('canon');
  newPuzzle();
  resize();
  updateMusicBtn();
  showIntro();
  requestAnimationFrame(frame);
})();
