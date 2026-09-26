// Copies whole sentences the family's Worker has already made (its cache) into the voice pack.
// Cache hits cost nothing, even when the day's free AI allowance is used up. Sentences that
// aren't cached are skipped (never generated here).
//   node tools/voice-pack/harvest.js   (uses tools/voice-pack/full-sentences.json from plan.js)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'shared/voice/en');
const MANIFEST = path.join(OUT, 'manifest.json');
const list = JSON.parse(fs.readFileSync(path.join(__dirname, 'full-sentences.json'), 'utf8'));
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : { voice: 'luna', clips: {} };
manifest.full = manifest.full || {};
fs.mkdirSync(OUT, { recursive: true });
let hits = 0, tried = 0;
for (const { text, key } of list) {
  if (manifest.full[key] || !key) continue;
  tried++;
  const url = `https://math-quest.rraman.workers.dev/tts?lang=en&voice=luna&text=${encodeURIComponent(text)}`;
  let out;
  try { out = execFileSync('curl', ['-s', '-D', '-', '-H', 'Origin: https://ravisraman.github.io', url], { maxBuffer: 1 << 24 }); } catch (e) { continue; }
  // Skip any proxy "Connection Established" block: the real response headers are the last block.
  let start = 0, sep = out.indexOf('\r\n\r\n');
  while (sep >= 0 && /^HTTP\/\S+ 200 Connection established/i.test(out.slice(start, sep).toString())) { start = sep + 4; sep = out.indexOf('\r\n\r\n', start); }
  const head = out.slice(start, sep).toString();
  const body = out.slice(sep + 4);
  if (!/^HTTP\/\S+ 200/.test(head) || !/x-cache:\s*hit/i.test(head) || body.length < 500) continue;
  const f = 'full-' + crypto.createHash('sha1').update('luna|' + key).digest('hex').slice(0, 12) + (/content-type:\s*audio\/wav/i.test(head) ? '.wav' : '.mp3');
  fs.writeFileSync(path.join(OUT, f), body);
  manifest.full[key] = f;
  hits++;
}
fs.writeFileSync(MANIFEST, JSON.stringify(manifest));
console.log(`tried ${tried} sentences, ${hits} were already made and are now in the pack`);
