// Builds tools/voice-pack/phrases.json (what to record, most useful first) from a log of what the
// games say (scratchpad voice/raw.json: [{text, lang, count}]), using the games' own
// MQ.spokenClauses so the keys match exactly what the player looks up.
//   node tools/voice-pack/plan.js path/to/raw.json
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).filter((r) => (r.lang || 'en-US').startsWith('en'));
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.route('https://math-quest.rraman.workers.dev/**', (r) => r.fulfill({ status: 404, body: '' }));
  await p.goto(process.env.BASE || 'http://localhost:8765/index.html');
  const clauses = await p.evaluate((rows) => rows.map((r) => ({ c: MQ.spokenClauses(r.text).map((w) => w), n: r.count || 1, text: r.text })), raw);
  await b.close();
  const NUM = /^(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(-(one|two|three|four|five|six|seven|eight|nine))?$|^(hundred|thousand)$/;
  const weight = new Map();
  const add = (k, n) => weight.set(k, (weight.get(k) || 0) + n);
  const wordsSeen = new Map();
  // Clauses heard often are recorded whole (most natural), e.g. "this one came back".
  const clauseW = new Map();
  for (const row of clauses) for (const words of row.c) { const k = words.join(' '); clauseW.set(k, (clauseW.get(k) || 0) + row.n); }
  for (const [k, n] of clauseW) if (n >= 6 && k.length <= 70) add(k, n * 1.5);
  for (const row of clauses) for (const words of row.c) {
    // Text runs between numbers are recorded as whole phrases; numbers separately.
    let run = [];
    const flush = () => { if (run.length) add(run.join(' '), row.n); run = []; };
    for (const w of words) {
      wordsSeen.set(w, (wordsSeen.get(w) || 0) + row.n);
      if (NUM.test(w)) { flush(); add(w, row.n); } else run.push(w);
    }
    flush();
  }
  // Every number word 0-100 (and hundred/thousand) is needed sooner or later: record them first.
  const numbers = [];
  const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  for (let n = 0; n < 100; n++) numbers.push(n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : ''));
  numbers.push('hundred', 'thousand');
  // Order: numbers first, then, going through what he hears most often, every piece that
  // sentence needs, so each night's recordings complete as many whole sentences as possible.
  const phrases = [...numbers];
  const have = new Set(phrases);
  const piecesFor = (words) => {
    const whole = words.join(' ');
    if ((clauseW.get(whole) || 0) >= 6 && whole.length <= 70) return [whole];
    const out = []; let run = [];
    for (const w of words) { if (NUM.test(w)) { if (run.length) out.push(run.join(' ')); run = []; out.push(w); } else run.push(w); }
    if (run.length) out.push(run.join(' '));
    return out;
  };
  for (const row of [...clauses].sort((a, b) => b.n - a.n)) for (const words of row.c) for (const k of piecesFor(words)) if (!have.has(k)) { have.add(k); phrases.push(k); }
  const rest = [...weight.entries()].filter(([k]) => !have.has(k));
  fs.writeFileSync(path.join(__dirname, 'phrases.json'), JSON.stringify(phrases, null, 1));
  // Whole sentences to try to copy from the Worker's cache (free): the exact texts the games send.
  const full = clauses.sort((a, b) => b.n - a.n).map((r) => ({ text: r.text, key: r.c.map((w) => w.join(' ')).join(' | ') }));
  fs.writeFileSync(path.join(__dirname, 'full-sentences.json'), JSON.stringify(full));
  const chars = (arr) => arr.reduce((s, x) => s + x.length, 0);
  const total = clauses.reduce((s, r) => s + r.n, 0);
  for (const budget of [3500, 7000, 10500, 14000]) {
    let c = 0, i = 0; for (; i < phrases.length && c + phrases[i].length <= budget; i++) c += phrases[i].length;
    const got = new Set(phrases.slice(0, i));
    const ok = clauses.filter((r) => r.c.every((w) => piecesFor(w).every((k) => got.has(k)))).reduce((s, r) => s + r.n, 0);
    console.log(`after ${budget} chars (${i} clips): ${Math.round(ok / total * 100)}% of what he hears is fully recorded`);
  }
  console.log(`phrases: ${phrases.length} (${chars(phrases)} chars); numbers ${numbers.length} (${chars(numbers)}); text runs ${rest.length} (${chars(rest.map((r) => r[0]))}); whole sentences to try from cache: ${full.length}`);
})();
