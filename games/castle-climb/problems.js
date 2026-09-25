/* Castle Climb — the math side: problem generator for each level, plausible wrong answers,
   and kid-friendly strategy hints (make ten, doubles, think addition, tens and ones...).
   Classic script (works from file://). Exposes window.CCProblems. */
(function () {
  'use strict';

  const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const chance = (p) => Math.random() < p;
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Skill families, tracked per fact for the grown-ups page.
  const SKILLS = {
    add10: 'Adding within 10',
    sub10: 'Subtracting within 10',
    add20: 'Adding within 20',
    sub20: 'Subtracting within 20',
    tens: 'Adding/subtracting tens',
    twoOne: '2-digit ± 1-digit',
    twoTwo: '2-digit ± 2-digit',
    three: 'Three numbers',
    missing: 'Missing numbers',
  };
  // The first level where each skill shows up (used to decide which missed facts may come back).
  const SKILL_LEVEL = { add10: 1, sub10: 2, add20: 3, sub20: 4, tens: 5, twoOne: 6, twoTwo: 7, three: 9, missing: 10 };

  // ledges: answer choices per floor. pace: seconds for the ✨ speedy bonus (bonus only, never a penalty).
  const LEVELS = {
    1: { name: 'Adding within 10', zh: '十以内的加法', ledges: 3, pace: 6, example: '4 + 3' },
    2: { name: 'Taking away within 10', zh: '十以内的减法', ledges: 3, pace: 6, example: '9 − 4' },
    3: { name: 'Adding within 20 · make a ten', zh: '二十以内的加法', ledges: 3, pace: 7, example: '8 + 7' },
    4: { name: 'Adding & taking away within 20', zh: '二十以内的加减法', ledges: 3, pace: 7, example: '13 − 5' },
    5: { name: 'Adding & taking away tens', zh: '整十数加减', ledges: 4, pace: 7, example: '40 + 30' },
    6: { name: 'Big number ± small number', zh: '两位数加减一位数', ledges: 4, pace: 9, example: '38 + 5' },
    7: { name: '2-digit + 2-digit', zh: '两位数加两位数', ledges: 4, pace: 10, example: '23 + 45' },
    8: { name: '2-digit ± 2-digit with regrouping', zh: '进位和退位', ledges: 4, pace: 12, example: '38 + 45' },
    9: { name: 'Three numbers', zh: '三个数相加', ledges: 4, pace: 9, example: '7 + 3 + 6' },
    10: { name: 'Missing numbers', zh: '填空', ledges: 4, pace: 9, example: '7 + ? = 15' },
    11: { name: 'Mixed review', zh: '综合复习', ledges: 4, pace: 10, example: '8 + 7, 62 − 27' },
    12: { name: 'Bigger missing numbers', zh: '更大的数', ledges: 4, pace: 12, example: '35 + ? = 50' },
    13: { name: 'Numbers to 100 challenge', zh: '一百以内挑战', ledges: 4, pace: 12, example: '24 + 18 + 30' },
    14: { name: 'Regrouping mix', zh: '进位退位综合', ledges: 4, pace: 13, example: '47 + 38, 36 + 7 + 25' },
    15: { name: 'Missing numbers to 100', zh: '一百以内填空', ledges: 4, pace: 14, example: '35 + ? = 72' },
  };
  const TOP_LEVEL = 15;
  function levelInfo(L) { return LEVELS[Math.max(1, Math.min(TOP_LEVEL, Math.floor(L) || 1))]; }

  // ---------- Building a problem ----------
  // terms and ops describe "a op b (op c)"; blank = index of the hidden term (missing-number
  // problems) or -1 when the result is what he has to find.
  const zh = (n) => (window.MQ && MQ.zhNumber ? MQ.zhNumber(n) : String(n));
  const SYM = { '+': '+', '-': '−' };
  const WORD = { '+': 'plus', '-': 'minus' };
  const ZH_OP = { '+': '加', '-': '减' };

  function evaluate(terms, ops) {
    return terms.reduce((acc, t, i) => (i === 0 ? t : ops[i - 1] === '+' ? acc + t : acc - t), 0);
  }

  function classify(terms, ops, blank) {
    if (blank >= 0) return 'missing';
    if (terms.length === 3) return 'three';
    const [a, b] = terms;
    const tens = a % 10 === 0 && b % 10 === 0 && a >= 10 && b >= 10;
    if (ops[0] === '+') {
      const s = a + b;
      if (s <= 10) return 'add10';
      if (tens) return 'tens';
      if (s <= 20) return 'add20';
      return Math.min(a, b) < 10 ? 'twoOne' : 'twoTwo';
    }
    if (a <= 10) return 'sub10';
    if (tens) return 'tens';
    if (a <= 20 && b <= 10) return 'sub20';
    return b < 10 ? 'twoOne' : 'twoTwo';
  }

  function build(terms, ops, blank = -1) {
    const value = evaluate(terms, ops);
    const answer = blank >= 0 ? terms[blank] : value;
    const shown = terms.map((t, i) => (i === blank ? '?' : String(t)));
    let text = shown[0];
    let key = shown[0];
    let zhText = blank === 0 ? '几' : zh(terms[0]);
    let speak = blank === 0 ? 'what number' : String(terms[0]);
    for (let i = 1; i < terms.length; i++) {
      text += ` ${SYM[ops[i - 1]]} ${shown[i]}`;
      key += `${ops[i - 1]}${shown[i]}`;
      zhText += ZH_OP[ops[i - 1]] + (i === blank ? '几' : zh(terms[i]));
      speak += ` ${WORD[ops[i - 1]]} ${i === blank ? 'what number' : terms[i]}`;
    }
    if (blank >= 0) {
      text += ` = ${value}`;
      key += `=${value}`;
      zhText += `等于${zh(value)}？`;
      speak = `${speak} equals ${value}?`;
      speak = speak.charAt(0).toUpperCase() + speak.slice(1);
    } else {
      text += ' = ?';
      zhText += '等于几？';
      speak = `What is ${speak}?`;
    }
    const p = { terms, ops, blank, value, answer, text, key, zh: zhText, speak };
    p.skill = classify(terms, ops, blank);
    p.skillLabel = SKILLS[p.skill];
    if (terms.length === 2 && blank < 0) {
      const [a, b] = terms;
      p.regroup = ops[0] === '+' ? (a % 10) + (b % 10) >= 10 : a % 10 < b % 10;
    } else p.regroup = false;
    p.solved = terms.map((t, i) => (i === blank ? String(answer) : String(t)))
      .reduce((s, t, i) => (i === 0 ? t : `${s} ${SYM[ops[i - 1]]} ${t}`), '') + ` = ${value}`;
    const h = tipFor(p);
    p.tip = h.tip;
    p.full = `${p.solved}. ${h.tip}${h.more ? ' ' + h.more : ''}`;
    return p;
  }

  // Rebuild a problem from its key, e.g. "8+7", "13-5", "7+3+6", "7+?=15", "?-4=9".
  function fromKey(key) {
    if (typeof key !== 'string' || !/^[0-9?+\-=]+$/.test(key)) return null;
    const [left, right] = key.split('=');
    const tokens = left.match(/\?|\d+|[+-]/g);
    if (!tokens || tokens.length < 3 || tokens.length % 2 === 0) return null;
    const terms = [];
    const ops = [];
    tokens.forEach((t, i) => { if (i % 2) ops.push(t); else terms.push(t === '?' ? null : Number(t)); });
    if (ops.some((o) => o !== '+' && o !== '-')) return null;
    const blank = terms.indexOf(null);
    if (blank >= 0) {
      if (right === undefined || terms.length !== 2 || terms.filter((t) => t === null).length !== 1) return null;
      const R = Number(right);
      const [a, b] = terms;
      if (ops[0] === '+') terms[blank] = R - (blank === 0 ? b : a);
      else terms[blank] = blank === 0 ? R + b : a - R;
    } else if (right !== undefined) return null;
    if (terms.some((t) => !Number.isInteger(t) || t < 0)) return null;
    if (evaluate(terms, ops) < 0) return null;
    return build(terms, ops, blank);
  }

  // ---------- Strategy hints (short, concrete, a 7-year-old can follow) ----------
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const tensOf = (n) => Math.floor(n / 10) * 10;
  const tensWord = (n) => `${n} ${n === 1 ? 'ten' : 'tens'}`;

  function tipFor(p) {
    const t = p.terms;
    const op = p.ops[0];
    const ans = p.answer;
    if (p.blank >= 0) {
      const R = p.value;
      if (op === '+') {
        const known = t[1 - p.blank];
        if (R > 10 && R <= 20 && known < 10) {
          return { tip: `Count up from ${known} to ${R}: ${known} + ${10 - known} = 10, then ${R - 10} more.`, more: `${10 - known} + ${R - 10} = ${ans}.` };
        }
        if (R <= 20 || ans <= 10) return { tip: `Count up from ${known} to ${R}.`, more: `That is ${ans} steps.` };
        if (R % 10 === 0) return { tip: `Count up from ${known} to the next ten, then by tens to ${R}.`, more: `${R} − ${known} = ${ans}.` };
        return { tip: `Think: ${R} − ${known} = ?`, more: `${R} − ${known} = ${ans}.` };
      }
      if (p.blank === 0) return { tip: `Think addition: ${R} + ${t[1]} = ?`, more: `${R} + ${t[1]} = ${ans}.` };
      return { tip: `How many were taken away? Count up from ${R} to ${t[0]}.`, more: `${R} + ${ans} = ${t[0]}.` };
    }
    if (t.length === 3) {
      const pairs = [[0, 1, 2], [0, 2, 1], [1, 2, 0]];
      for (const [i, j, k] of pairs) {
        if (t[i] + t[j] === 10) return { tip: `Find ten-friends: ${t[i]} + ${t[j]} = 10. Then add ${t[k]}.` };
      }
      for (const [i, j, k] of pairs) {
        if (t[i] === t[j]) return { tip: `Find the double: ${t[i]} + ${t[j]} = ${t[i] * 2}. Then add ${t[k]}.` };
      }
      return { tip: `Add two first: ${t[0]} + ${t[1]} = ${t[0] + t[1]}. Then add ${t[2]}.` };
    }
    const [a, b] = t;
    if (op === '+') {
      const big = Math.max(a, b);
      const small = Math.min(a, b);
      const s = a + b;
      if (a % 10 === 0 && b % 10 === 0 && small >= 10) {
        return { tip: `${cap(tensWord(a / 10))} + ${tensWord(b / 10)} = how many tens?`, more: `${cap(tensWord(s / 10))} is ${s}.` };
      }
      if (s <= 10) {
        if (s === 10) return { tip: `${a} and ${b} are ten-friends. What do ten-friends make?` };
        if (a === b) return { tip: `It's a double: ${a} + ${a}. Think of ${a} and ${a} fingers.` };
        const seq = [];
        for (let n = big + 1; n <= s; n++) seq.push(n);
        return { tip: `Start at ${big} and count on ${small}.`, more: `${big}… ${seq.join(', ')}.` };
      }
      if (big <= 9) {
        if (a === b) return { tip: `It's a double: ${a} + ${a}.` };
        if (big - small === 1) return { tip: `Near doubles: ${small} + ${small} + 1.`, more: `${small} + ${small} = ${small * 2}, and 1 more is ${s}.` };
        const need = 10 - big;
        return { tip: `Make a ten: ${big} + ${need} = 10, then ${small - need} more.` };
      }
      if (big === 10) return { tip: `10 + ${small} is 1 ten and ${small} ones. What number is that?` };
      if (s <= 20) return { tip: `${big} is 1 ten and ${big - 10} ones. Add the ones: ${big - 10} + ${small} = ?`, more: `1 ten and ${big - 10 + small} ones is ${s}.` };
      if (small < 10) {
        const ones = big % 10;
        if (ones + small < 10) return { tip: `Add the ones: ${ones} + ${small} = ? The tens stay the same.` };
        const need = 10 - ones;
        if (need === small) return { tip: `The ones make ten: ${ones} + ${small} = 10. So what is the next ten after ${big}?` };
        return { tip: `Make the next ten: ${big} + ${need} = ${big + need}, then ${small - need} more.` };
      }
      const tens = tensOf(a) + tensOf(b);
      const ones = (a % 10) + (b % 10);
      return { tip: `Add the tens: ${tensOf(a)} + ${tensOf(b)} = ${tens}. Then add the ones: ${a % 10} + ${b % 10} = ? Put them together.`, more: `${tens} + ${ones} = ${ans}.` };
    }
    // Subtraction
    if (a % 10 === 0 && b % 10 === 0 && b >= 10) {
      return { tip: `${cap(tensWord(a / 10))} − ${tensWord(b / 10)} = how many tens?`, more: `${cap(tensWord((a - b) / 10))} is ${a - b}.` };
    }
    if (a <= 20) {
      if (a === b) return { tip: `Take away all of them and nothing is left.` };
      return { tip: `Think addition: ${b} + ? = ${a}.`, more: `${b} + ${ans} = ${a}.` };
    }
    if (b < 10) {
      const ones = a % 10;
      if (b <= ones) return { tip: `Take away from the ones: ${ones} − ${b} = ? The tens stay the same.` };
      if (ones === 0) return { tip: `Break a ten: 10 − ${b} = ${10 - b}. Then what is ${a - 10} + ${10 - b}?` };
      return { tip: `Back to a ten: ${a} − ${ones} = ${a - ones}, then take away ${b - ones} more.` };
    }
    const mid = a - tensOf(b);
    if (b % 10 === 0) return { tip: `Take away ${tensWord(b / 10)} from ${a}. The ones stay the same. Count back by tens from ${a}.` };
    let tip = `Take away the tens: ${a} − ${tensOf(b)} = ${mid}.`;
    if (b % 10) {
      tip += ` Then take away ${b % 10}`;
      if (mid % 10 < b % 10 && mid % 10 > 0) tip += `: ${mid} − ${mid % 10} = ${mid - (mid % 10)}, then ${b % 10 - (mid % 10)} more`;
      tip += '.';
    }
    return { tip };
  }

  // ---------- Generators ----------
  const G = {
    add10() {
      if (chance(0.25)) { const a = rand(1, 9); return [[a, 10 - a], ['+']]; } // ten-friends
      for (;;) { // pick the two numbers (not the sum), so 1 + 1 isn't over-picked
        const a = rand(1, 8);
        const b = rand(1, 9 - a);
        if ((a > 1 && b > 1) || chance(0.35)) return [[a, b], ['+']];
      }
    },
    sub10() {
      const a = rand(3, 10);
      if (chance(0.03)) return [[a, a], ['-']];
      for (;;) { // answers of 1 are the easiest to guess, so they come up a bit less
        const b = rand(1, a - 1);
        if (a - b > 1 || chance(0.4)) return [[a, b], ['-']];
      }
    },
    add20() {
      const r = Math.random();
      if (r < 0.72) { // single digits that cross ten: make-ten, doubles, near doubles
        const a = rand(2, 9);
        const b = rand(Math.max(2, 11 - a), 9);
        return [[a, b], ['+']];
      }
      if (r < 0.87) { const n = rand(1, 9); return chance(0.5) ? [[10, n], ['+']] : [[n, 10], ['+']]; }
      const t = rand(11, 17);
      const o = rand(1, 9 - (t % 10));
      return chance(0.5) ? [[t, o], ['+']] : [[o, t], ['+']];
    },
    sub20() {
      if (chance(0.7)) { // crosses ten: 13 − 5
        const a = rand(11, 18);
        return [[a, rand((a % 10) + 1, 9)], ['-']];
      }
      const a = rand(11, 19);
      return [[a, chance(0.2) ? 10 : rand(1, a % 10)], ['-']];
    },
    tens() {
      if (chance(0.6)) { const a = rand(1, 8); return [[a * 10, rand(1, 10 - a) * 10], ['+']]; }
      const a = rand(3, 10);
      for (;;) {
        const b = rand(1, a - 1);
        if (a - b > 1 || chance(0.4)) return [[a * 10, b * 10], ['-']];
      }
    },
    twoOne(regroup) {
      if (chance(0.55)) {
        const t = rand(2, 8);
        const o = regroup ? rand(2, 9) : rand(0, 7);
        const b = regroup ? rand(10 - o, 9) : rand(1, 9 - o);
        const a = t * 10 + o;
        return chance(0.8) ? [[a, b], ['+']] : [[b, a], ['+']];
      }
      const t = rand(3, 9);
      const o = regroup ? rand(0, 8) : rand(1, 9);
      const b = regroup ? rand(o + 1, 9) : rand(1, o);
      return [[t * 10 + o, b], ['-']];
    },
    twoTwo(regroup, allowSub) {
      if (!allowSub || chance(0.55)) {
        let t1, t2, o1, o2;
        if (regroup) { o1 = rand(1, 9); o2 = rand(Math.max(1, 10 - o1), 9); t1 = rand(1, 7); t2 = rand(1, 8 - t1); }
        else { o1 = rand(0, 8); o2 = rand(1, 9 - o1); t1 = rand(1, 8); t2 = rand(1, 9 - t1); }
        return [shuffle([t1 * 10 + o1, t2 * 10 + o2]), ['+']];
      }
      let t1, t2, o1, o2;
      if (regroup) { t1 = rand(2, 9); t2 = rand(1, t1 - 1); o1 = rand(0, 8); o2 = rand(o1 + 1, 9); }
      else { t1 = rand(2, 9); t2 = rand(1, t1 - 1); o1 = rand(1, 9); o2 = rand(0, o1); }
      return [[t1 * 10 + o1, t2 * 10 + o2], ['-']];
    },
    three() {
      const r = Math.random();
      let t;
      if (r < 0.45) { const x = rand(1, 9); t = shuffle([x, 10 - x, rand(1, 9)]); }
      else if (r < 0.65) { const x = rand(2, 8); t = shuffle([x, x, rand(1, 9)]); }
      else t = [rand(1, 9), rand(1, 9), rand(1, 9)];
      return [t, ['+', '+']];
    },
    threeBig() {
      return [shuffle([rand(1, 4) * 10, rand(2, 9), rand(11, 29)]), ['+', '+']];
    },
    threeHuge() {
      return [[rand(11, 39), rand(11, 29), rand(10, 30)], ['+', '+']];
    },
    missing() {
      const f = rand(0, 3);
      if (f <= 1) {
        const a = rand(2, 9);
        const x = rand(2, 9);
        return f === 0 ? [[a, x], ['+'], 1] : [[x, a], ['+'], 0];
      }
      if (f === 2) { const b = rand(2, 9); const c = rand(2, 11); return [[b + c, b], ['-'], 0]; }
      const a = rand(11, 18);
      return [[a, rand(2, 9)], ['-'], 1];
    },
    missingBig() {
      const f = rand(0, 3);
      if (f === 0) { const a = rand(2, 8); return [[a * 10, rand(1, 9 - a) * 10], ['+'], 1]; }
      if (f === 1) {
        const c = rand(3, 9) * 10;
        let a = rand(11, c - 5);
        if (a % 10 === 0) a++;
        return [[a, c - a], ['+'], 1];
      }
      if (f === 2) { const b = rand(1, 5) * 10; const c = rand(11, 99 - b); return [[b + c, b], ['-'], 0]; }
      const a = rand(30, 99);
      return [[a, rand(11, a - 10)], ['-'], 1];
    },
    // Level 14: two 2-digit numbers and a 1-digit number (36 + 7 + 25), total within 100.
    threeMix() {
      for (;;) {
        const a = rand(11, 49);
        const b = rand(11, 45);
        const c = rand(2, 9);
        if (a + b + c <= 99 && (chance(0.35) || (a % 10) + (b % 10) + c >= 10)) return [shuffle([a, b, c]), ['+', '+']];
      }
    },
    // Level 15: bigger missing numbers that need regrouping (35 + ? = 72, ? − 28 = 45, 81 − ? = 36).
    missingRegroup() {
      const f = rand(0, 3);
      if (f <= 1) { // a + ? = c
        let a, x;
        do { a = rand(12, 69); x = rand(11, 87 - a); } while ((a % 10) + (x % 10) < 10 && chance(0.8));
        return f === 0 ? [[a, x], ['+'], 1] : [[x, a], ['+'], 0];
      }
      if (f === 2) { // ? − b = c
        let b, c;
        do { b = rand(11, 49); c = rand(11, 98 - b); } while ((b % 10) + (c % 10) < 10 && chance(0.8));
        return [[b + c, b], ['-'], 0];
      }
      let a, b; // a − ? = c
      do { a = rand(40, 98); b = rand(11, a - 11); } while (a % 10 >= b % 10 && chance(0.8));
      return [[a, b], ['-'], 1];
    },
    missing100() {
      const f = rand(0, 3);
      if (f <= 1) {
        const a = rand(12, 60);
        const x = rand(11, 95 - a);
        return f === 0 ? [[a, x], ['+'], 1] : [[x, a], ['+'], 0];
      }
      if (f === 2) { const b = rand(11, 40); const c = rand(11, 95 - b); return [[b + c, b], ['-'], 0]; }
      const a = rand(40, 99);
      return [[a, rand(11, a - 11)], ['-'], 1];
    },
  };

  // Weaker skills come up more often in the review levels.
  function weakness(skills, key) {
    const s = (skills && skills[key]) || { right: 0, tries: 0 };
    return 0.5 + 2 * (1 - (s.right + 1) / (s.tries + 2));
  }
  function weightedPick(items, weights) {
    let x = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < items.length; i++) { x -= weights[i]; if (x <= 0) return items[i]; }
    return items[items.length - 1];
  }

  function genFor(L, opts) {
    switch (L) {
      case 1: return G.add10();
      case 2: return chance(0.7) ? G.sub10() : G.add10();
      case 3: return G.add20();
      case 4: return chance(0.5) ? G.add20() : G.sub20();
      case 5: return G.tens();
      case 6: return G.twoOne(opts.floor != null ? opts.floor >= 4 : chance(0.6));
      case 7: return G.twoTwo(false, false);
      case 8: return G.twoTwo(true, true);
      case 9: return G.three();
      case 10: return G.missing();
      case 11: {
        const opts11 = [
          ['add20', () => G.add20()], ['sub20', () => G.sub20()], ['tens', () => G.tens()],
          ['twoOne', () => G.twoOne(true)], ['twoTwo', () => G.twoTwo(true, true)],
          ['three', () => G.three()], ['missing', () => G.missing()],
        ];
        return weightedPick(opts11, opts11.map(([k]) => weakness(opts.skills, k)))[1]();
      }
      case 12: {
        const r = Math.random();
        if (r < 0.35) return G.missingBig();
        if (r < 0.65) return G.threeBig();
        return G.twoTwo(true, true);
      }
      case 13: {
        const r = Math.random();
        if (r < 0.35) return G.missing100();
        if (r < 0.6) return G.threeHuge();
        if (r < 0.85) return G.twoTwo(true, true);
        return G.twoOne(true);
      }
      case 14: {
        const r = Math.random();
        if (r < 0.55) return G.twoTwo(true, true);
        if (r < 0.85) return G.threeMix();
        return G.twoTwo(chance(0.5), true);
      }
      default: {
        const r = Math.random();
        if (r < 0.6) return G.missingRegroup();
        if (r < 0.75) return G.twoTwo(true, true);
        if (r < 0.9) return G.threeMix();
        return G.missing100();
      }
    }
  }

  // Make one problem for level L. opts: { floor (0-9), skills (for review weighting), avoid (keys) }.
  function make(L, opts = {}) {
    const lv = Math.max(1, Math.floor(L) || 1);
    const avoid = opts.avoid || [];
    let p = null;
    for (let tries = 0; tries < 12; tries++) {
      const [terms, ops, blank] = genFor(lv, opts);
      p = build(terms, ops, blank == null ? -1 : blank);
      if (!avoid.includes(p.key)) break;
    }
    return p;
  }

  // Can a (previously missed) fact be practiced at level L?
  function fitsLevel(p, L) {
    return !!p && (L >= 11 || SKILL_LEVEL[p.skill] <= L);
  }

  // ---------- Wrong answers that a real kid might pick ----------
  // The choices are a small "shape" of numbers — near misses (±1, ±2, ±3) and, for bigger numbers,
  // place-value slips (±10, ±11, ±9...) — and the answer is a RANDOM member of that shape. So
  // every choice relates to the others in the same way: the answer is not the middle one, not the
  // one with a neighbour, not the odd one out. The only way to find it is to do the math.
  function shapeFor(p, n) {
    const ans = p.answer;
    if (p.skill === 'tens' && ans % 10 === 0) return { pool: [0, 10, 20, 30, 40], tens: true };
    const big = ans >= 20 || p.value >= 30;
    if (!big) return { pool: [0, 1, 2, 3, 4] };
    // Near misses and tens slips mixed: {0,1,2,3} ∪ {10,11,12,13}.
    return { pool: [0, 1, 2, 3, 10, 11, 12, 13] };
  }
  function distractors(p, n) {
    const ans = p.answer;
    const { pool, tens } = shapeFor(p, n);
    const lo = p.ops.includes('-') || p.blank >= 0 ? 0 : tens ? 10 : 1; // adding never makes 0
    const hi = tens ? 140 : ans <= 10 ? 20 : ans <= 20 ? 30 : 120;
    for (let tries = 0; tries < 200; tries++) {
      const S = shuffle(pool.slice()).slice(0, n + 1).sort((x, y) => x - y);
      const role = S[Math.floor(Math.random() * S.length)];
      const vals = S.map((v) => ans + v - role);
      if (vals.every((v) => Number.isInteger(v) && v >= lo && v <= hi)) {
        const out = vals.filter((v) => v !== ans);
        out.why = {};
        return shuffle(out);
      }
    }
    // Fallback (tiny answers): nearest valid numbers.
    const out = [];
    for (const k of [1, -1, 2, -2, 3, -3, 4, 5, 6, 7, 8]) {
      const v = ans + k;
      if (out.length < n && v >= lo && v !== ans) out.push(v);
    }
    out.why = {};
    return out;
  }

  window.CCProblems = { SKILLS, SKILL_LEVEL, LEVELS, levelInfo, make, build, fromKey, fitsLevel, distractors, classify, shuffle };
})();
