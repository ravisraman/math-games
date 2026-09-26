const { chromium } = require('playwright');
require('fs').mkdirSync(require('path').join(__dirname, 'out'), { recursive: true });
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const BASE = process.env.BASE || 'http://localhost:8765/';
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const [w, h] of (process.env.SIZES ? JSON.parse(process.env.SIZES) : [[402, 740], [402, 874], [874, 402], [874, 360], [1470, 830]])) {
    const phone = w < 1000;
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: phone ? 3 : 1, isMobile: phone, hasTouch: phone, userAgent: phone ? UA : undefined, ignoreHTTPSErrors: true });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(p.url().split('/').slice(-2).join('/') + ': ' + e.message));
    await p.goto(BASE + 'index.html'); await p.evaluate(() => localStorage.setItem('mathQuest.save.v1', JSON.stringify({ player: { name: 'Leo', hero: '🐼' }, stars: 12, games: {} })));
    const rows = [];
    for (let i = 0; i < 4; i++) {
      await p.goto(BASE + 'index.html'); await p.waitForTimeout(500);
      const tile = p.locator('.tile').nth(i);
      if (phone) await tile.tap(); else await tile.click();
      await p.waitForURL('**/games/**'); await p.waitForTimeout(900);
      const game = p.url().split('/games/')[1].split('/')[0];
      // Start: tap a visible Start-ish button, else press Enter
      const start = p.locator('button:visible', { hasText: /Start|Play|Let/i }).first();
      if (phone && await start.count()) await start.tap(); else await p.keyboard.press('Enter');
      await p.waitForTimeout(900);
      // a few touches in the middle of the play area
      if (phone) for (let k = 0; k < 3; k++) { await p.touchscreen.tap(w / 2, h * 0.55); await p.waitForTimeout(350); }
      else for (const k of ['ArrowUp', 'ArrowRight']) { await p.keyboard.press(k); await p.waitForTimeout(300); }
      await p.waitForTimeout(600);
      const d = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, song: MQ.Music.wanted }));
      await p.screenshot({ path: `${require('path').join(__dirname, 'out')}/pj-${w}x${h}-${game}.png` });
      rows.push(`${game}:${d.sw > w || d.sh > h ? 'SCROLL' : 'ok'}:${d.song}`);
    }
    console.log(w + 'x' + h, rows.join('  '), errs.length ? errs : 'no errors');
    await ctx.close();
  }
  await b.close();
})();
