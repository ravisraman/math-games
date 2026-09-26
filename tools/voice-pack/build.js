// Records the voice pack: natural-voice clips (Deepgram Aura-2 "luna" via the family's Cloudflare
// Worker) for the phrases the games say most, saved in shared/voice/en/ with manifest.json.
// The free Workers AI allowance covers roughly 3,500 new characters a day, so this records phrases
// in priority order until the Worker says the day's allowance is used up, and picks up where it
// left off the next day. Already-recorded phrases are never requested again.
//   node tools/voice-pack/build.js [phrases.json] [--max-chars N] [--dry]
// phrases.json: ["phrase one", "phrase two", ...] in priority order (spoken form, lower case,
// as produced by MQ.spokenClauses). Default: tools/voice-pack/phrases.json.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'shared/voice/en');
const MANIFEST = path.join(OUT, 'manifest.json');
const WORKER = 'https://math-quest.rraman.workers.dev/tts';
const VOICE = 'luna';
const args = process.argv.slice(2);
const listFile = args.find((a) => !a.startsWith('--')) || path.join(__dirname, 'phrases.json');
const maxChars = Number((args[args.indexOf('--max-chars') + 1] || '').match(/^\d+$/) ? args[args.indexOf('--max-chars') + 1] : 100000);
const dry = args.includes('--dry');

const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : { voice: VOICE, clips: {} };
const phrases = JSON.parse(fs.readFileSync(listFile, 'utf8'));
const todo = phrases.filter((p) => !manifest.clips[p]);
console.log(`${phrases.length} phrases, ${phrases.length - todo.length} recorded, ${todo.length} to go (${todo.reduce((s, p) => s + p.length, 0)} characters)`);
if (dry) process.exit(0);

// What to send so the clip sounds right: numbers read as words already; a capital letter helps
// the model start naturally. No full stop, so pieces joined mid-sentence don't sound final.
const sayText = (p) => p.charAt(0).toUpperCase() + p.slice(1);
const fileFor = (p) => crypto.createHash('sha1').update(VOICE + '|' + p).digest('hex').slice(0, 12) + '.mp3';

let chars = 0, done = 0, stopped = '';
for (const p of todo) {
  if (chars + p.length > maxChars) { stopped = 'max-chars'; break; }
  const url = `${WORKER}?lang=en&voice=${VOICE}&text=${encodeURIComponent(sayText(p))}`;
  let status = 0, body;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      body = execFileSync('curl', ['-s', '-w', '\n%{http_code}', '-H', 'Origin: https://ravisraman.github.io', url], { maxBuffer: 1 << 24 });
      const nl = body.lastIndexOf(10);
      status = Number(body.slice(nl + 1).toString());
      body = body.slice(0, nl);
      if (status === 200 || status === 503) break;
    } catch (e) { status = 0; }
    execFileSync('sleep', [String(2 * (attempt + 1))]);
  }
  if (status === 503) { stopped = 'daily allowance used up'; break; }
  if (status === 429) { execFileSync('sleep', ['20']); continue; }
  if (status !== 200 || body.length < 500) { console.log(`skip (${status}): ${p}`); continue; }
  const f = fileFor(p);
  fs.writeFileSync(path.join(OUT, f), body);
  manifest.clips[p] = f;
  chars += p.length; done++;
  if (done % 25 === 0) { fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 0)); process.stdout.write(`${done} `); }
  execFileSync('sleep', ['0.4']); // stay under the Worker's per-minute limit for new phrases
}
manifest.voice = VOICE;
const sorted = {}; for (const k of Object.keys(manifest.clips).sort()) sorted[k] = manifest.clips[k];
manifest.clips = sorted;
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 0));
const left = phrases.filter((p) => !manifest.clips[p]);
console.log(`\nrecorded ${done} (${chars} chars)${stopped ? ' — stopped: ' + stopped : ''}; ${left.length} phrases (${left.reduce((s, p) => s + p.length, 0)} chars) still to record`);
