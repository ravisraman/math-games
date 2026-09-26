// Renders the block-animal sprites used by the 2D games and the portal.
// Usage (from the repo root, after `npm install`):  node tools/render-art/render.js
// Needs Playwright's Chromium. Models: shared/models/pets/*.glb (Kenney "Cube Pets", CC0).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'shared/art/heroes');
const HEROES = require('./heroes.json');
// Animation strips: [name, clip in the model, frame count]
const STRIPS = [['idle', 'idle', 8], ['happy', 'dance', 8], ['oops', 'gesture-negative', 6], ['walk', 'walk', 6]];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.png': 'image/png' };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage();
  await page.route('http://art.local/**', (route) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(route.request().url()).pathname));
    const file = p.endsWith('/render.html') ? path.join(__dirname, 'render.html') : p;
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200, body: fs.readFileSync(file), headers: { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' } });
  });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto('http://art.local/render.html');
  await page.waitForFunction(() => window.ready);
  const save = (name, dataUrl) => fs.writeFileSync(path.join(OUT, name), Buffer.from(dataUrl.split(',')[1], 'base64'));
  for (const h of HEROES) {
    const url = `/shared/models/pets/animal-${h.id}.glb`;
    save(`${h.id}.webp`, await page.evaluate((o) => render(o), { url, size: 256 }));
    for (const [name, clip, frames] of STRIPS) {
      save(`${h.id}-${name}.webp`, await page.evaluate((o) => render(o), { url, size: 160, clip, frames }));
    }
    process.stdout.write(h.id + ' ');
  }
  console.log('\ndone');
  await browser.close();
})();
