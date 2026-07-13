'use strict';
// Analysis helper (not part of the product or gate): given a session id, render its
// demo.html exactly the way the E2E runner does and print the probe text + the
// persona's expected must_have_features, so a demo-probe failure can be adjudicated
// faithfully (fixture-too-narrow vs feature-genuinely-missing).
//   node tests/tools/probe-dump.js <sessionId>
const fs = require('fs');
const os = require('os');
const path = require('path');

const id = process.argv[2];
if (!id) { console.error('usage: node tests/tools/probe-dump.js <sessionId>'); process.exit(2); }

const ROOT = path.join(__dirname, '..', '..');
const session = JSON.parse(fs.readFileSync(path.join(ROOT, 'sessions', `${id}.json`), 'utf8'));
const persona = require(path.join(ROOT, 'personas', 'fixtures.json')).personas
  .find((p) => p.one_line_idea === session.idea);

(async () => {
  if (!session.demo_html) { console.log('NO demo_html on this session (failed before build)'); return; }
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'probe-')), 'demo.html');
  fs.writeFileSync(tmp, session.demo_html);
  const puppeteer = require('puppeteer-core');
  const browser = await puppeteer.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto('file://' + tmp, { waitUntil: 'load', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 500));
  const probeText = await page.evaluate(() => {
    const parts = [document.title, document.body.innerText];
    for (const el of document.querySelectorAll('[placeholder],[aria-label],[value],[title]')) {
      for (const a of ['placeholder', 'aria-label', 'value', 'title']) {
        const v = el.getAttribute(a);
        if (v) parts.push(v);
      }
    }
    return parts.join('\n');
  });
  console.log('IDEA:', session.idea, '| lang:', session.lang);
  console.log('TITLE:', await page.title());
  console.log('CONSOLE ERRORS:', errs.length ? errs.join(' | ') : 'none');
  if (persona) {
    console.log('\nEXPECTED must_have_features:');
    for (const f of persona.expectations.must_have_features) {
      const lower = probeText.toLowerCase();
      const hit = f.text_any.some((t) => lower.includes(t.toLowerCase()));
      console.log(`  "${f.name}" text_any=${JSON.stringify(f.text_any)} → textHit=${hit}` +
        (f.selector_any ? ` selector_any=${JSON.stringify(f.selector_any)}` : ''));
    }
  } else {
    console.log('\n(could not match persona by idea)');
  }
  console.log('\n----- PROBE TEXT (title + body innerText + attrs) -----');
  console.log(probeText.slice(0, 2500));
  await browser.close();
})();
