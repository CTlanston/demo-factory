'use strict';

// E2E persona runner: spawns the REAL server, drives the REAL wizard over HTTP
// (no UI mocks) through all 4 steps, and scores the 5 pass criteria per run.
// Engine is real `claude -p` unless DEMO_FACTORY_CLAUDE points elsewhere (CI stub).

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const { findBannedTerms } = require('../compiler/banned-terms');
const { materiallyDifferent, SIMILARITY_THRESHOLD } = require('../compiler/option-diff');
const { validateDemoHtml } = require('../compiler/prompts');
const { crc32 } = require('../server');

const ROOT = path.join(__dirname, '..');
const FIXTURES = require('./fixtures.json').personas;
const RESULTS_PATH = process.env.DEMO_FACTORY_RESULTS || path.join(ROOT, 'metrics', 'e2e_results.json');
const LEDGER_PATH = process.env.DEMO_FACTORY_LEDGER || path.join(ROOT, 'metrics', 'cost_ledger.jsonl');
const RUN_BUDGET_S = 600;

// ---------- tiny arg parser ----------
function parseArgs(argv) {
  const args = { personas: null, seeds: 1, port: 3611, model: process.env.DEMO_FACTORY_MODEL || null, concurrency: 1 };
  for (let i = 2; i < argv.length; i++) {
    const [k, inlineV] = argv[i].split('=');
    const v = inlineV ?? argv[++i];
    if (k === '--personas') args.personas = v.split(',');
    else if (k === '--seeds') args.seeds = Number(v);
    else if (k === '--port') args.port = Number(v);
    else if (k === '--model') args.model = v;
    else if (k === '--concurrency') args.concurrency = Math.max(1, Number(v));
    else throw new Error(`unknown arg ${k}`);
  }
  return args;
}

// ---------- plain node:http JSON client (no hidden fetch timeouts; builds run minutes) ----------
function req(method, base, p, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const r = http.request(base + p, {
      method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {},
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const json = (r) => JSON.parse(r.body.toString('utf8'));

// Two tiers, deliberately different:
// RETRYABLE = anything that MIGHT be transient — give it a fresh attempt.
const RETRYABLE_RE = /Connection closed|Target closed|Protocol error|Session closed|disconnected|socket hang up|ECONNRESET|ECONNREFUSED|Connection refused|spawn failed|engine timed out|Navigation timeout|net::ERR/i;
// INFRA (excluded from the gate) = ONLY the unambiguously-environmental ones. Engine
// timeout / net::ERR / Navigation-timeout are ambiguous: if they PERSIST across all
// retries they're a product defect (a demo that never loads, a prompt the engine can't
// fulfill in budget) and must stay counted as a gate `fail`, not excused as environment.
const INFRA_RE = /Connection closed|Target closed|Protocol error|Session closed|disconnected|socket hang up|ECONNRESET|ECONNREFUSED|Connection refused|spawn failed/i;
const allMatch = (failures, re) => failures.length > 0 && failures.every((f) => re.test(f));
const isRetryable = (failures) => allMatch(failures, RETRYABLE_RE);
const isInfraFailure = (failures) => allMatch(failures, INFRA_RE);

// One shared Chromium, but self-healing: if it dies mid-run (a heavy demo can crash the
// renderer), the next acquire() relaunches it instead of every later run throwing
// "Connection closed" at a dead browser (the G3 re-run cascade). Each run gets its OWN
// incognito context = isolated localStorage, so concurrent (and repeat-persona) demos
// can't clobber each other's storage — this is also the faithful "fresh double-click".
function makeBrowserPool(puppeteer) {
  let browser = null;
  let launching = null; // mutex: concurrent acquires share one relaunch, never double-launch
  const ensure = async () => {
    if (browser && browser.connected) return;
    if (!launching) {
      launching = (async () => {
        if (browser) await browser.close().catch(() => {});
        browser = await puppeteer.launch({
          channel: 'chrome', headless: true, executablePath: process.env.CHROME_PATH || undefined,
        });
      })().finally(() => { launching = null; });
    }
    await launching;
  };
  return {
    // returns { page, release } — release() closes the isolated context (and its page)
    async acquire() {
      for (let attempt = 0; attempt < 2; attempt++) {
        await ensure();
        try {
          const ctx = await browser.createBrowserContext();
          const page = await ctx.newPage();
          return { page, release: () => ctx.close().catch(() => {}) };
        } catch {
          if (browser) await browser.close().catch(() => {});
          browser = null; // force relaunch on the next ensure()
        }
      }
      throw new Error('Connection closed'); // both attempts failed → classified as infra, retried
    },
    async close() { if (browser) await browser.close().catch(() => {}); },
  };
}

// ---------- criteria checks ----------

function checkInterview(questions, persona, failures) {
  let ok = true;
  if (!Array.isArray(questions) || questions.length < 5 || questions.length > 8) {
    failures.push(`interview: count ${questions?.length}`); ok = false;
  }
  for (const [i, q] of (questions || []).entries()) {
    const probe = `${q.question} ${(q.choices || []).join(' ')}`;
    const hits = findBannedTerms(probe, persona.expectations.banned || []);
    if (hits.length) { failures.push(`interview q${i + 1}: banned ${hits.map((h) => h.term).join(',')}`); ok = false; }
    if (!/[?\uFF1F]\s*$/.test(q.question.trim())) { failures.push(`interview q${i + 1}: not a question`); ok = false; }
  }
  return ok;
}

function checkOptions(options, failures) {
  if (!Array.isArray(options) || options.length !== 3) {
    failures.push(`options: count ${options?.length}`);
    return false;
  }
  const diff = materiallyDifferent(options);
  if (!diff.ok) {
    failures.push(`options: similar pairs ${JSON.stringify(diff.pairs.filter((p) => p.similarity >= SIMILARITY_THRESHOLD))}`);
    return false;
  }
  return true;
}

async function checkDemo(pool, html, persona, failures) {
  let ok = true;
  const v = validateDemoHtml(html);
  if (!v.ok) { failures.push(`demo: ${v.errors.join('; ')}`); ok = false; }

  // real double-click conditions: render from file:// in headless Chromium, in an
  // isolated context. acquire() self-heals a dead browser; if it still throws it
  // propagates to runOne's catch as a bare message that isInfraFailure classifies → retried.
  const tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'df-demo-')), 'demo.html');
  fs.writeFileSync(tmpFile, html);
  const { page, release } = await pool.acquire();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  try {
    await page.goto('file://' + tmpFile, { waitUntil: 'load', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 500)); // let init scripts settle
    if (consoleErrors.length) { failures.push(`demo console: ${consoleErrors.join(' | ').slice(0, 300)}`); ok = false; }

    // probe-text contract: document.title + body innerText + placeholder/aria-label/value/title attributes
    const probeText = await page.evaluate(() => {
      const parts = [document.title, document.body.innerText];
      for (const el of document.querySelectorAll('[placeholder],[aria-label],[value],[title]')) {
        for (const a of ['placeholder', 'aria-label', 'value', 'title']) {
          const val = el.getAttribute(a);
          if (val) parts.push(val);
        }
      }
      return parts.join('\n');
    });
    const probeLower = probeText.toLowerCase();
    for (const feature of persona.expectations.must_have_features) {
      // case-insensitive: fixtures say "walk", real demos say "Walk"/"Today's Log"
      const textHit = feature.text_any.some((tok) => probeLower.includes(tok.toLowerCase()));
      let selHit = true;
      if (feature.selector_any) {
        selHit = false;
        for (const sel of feature.selector_any) {
          if (await page.$(sel)) { selHit = true; break; }
        }
      }
      if (!(textHit && selHit)) { failures.push(`demo probe "${feature.name}": text=${textHit} sel=${selHit}`); ok = false; }
    }
  } catch (e) {
    failures.push(`demo render: ${e.message}`); ok = false;
  } finally {
    await release();
  }
  return ok;
}

function checkZip(zipBuf, servedHtml, failures) {
  try {
    if (zipBuf.readUInt32LE(0) !== 0x04034b50) throw new Error('bad signature');
    const nameLen = zipBuf.readUInt16LE(26);
    const name = zipBuf.subarray(30, 30 + nameLen).toString('utf8');
    if (name !== 'demo.html') throw new Error(`first entry ${name}`);
    const size = zipBuf.readUInt32LE(18);
    const payload = zipBuf.subarray(30 + nameLen, 30 + nameLen + size);
    if (payload.toString('utf8') !== servedHtml) throw new Error('demo.html payload differs from served demo');
    if (zipBuf.readUInt32LE(14) !== crc32(payload)) throw new Error('crc mismatch');
    if (!zipBuf.includes(Buffer.from('README_你的代码.md', 'utf8'))) throw new Error('missing README');
    if (zipBuf.subarray(zipBuf.length - 22).readUInt16LE(10) !== 2) throw new Error('entry count != 2');
    return true;
  } catch (e) {
    failures.push(`zip: ${e.message}`);
    return false;
  }
}

// ---------- cost from ledger (rows tagged wizard:<step>:<id8>) ----------
function runCost(id8) {
  try {
    const rows = fs.readFileSync(LEDGER_PATH, 'utf8').trim().split('\n').map(JSON.parse);
    return rows.filter((r) => r.purpose.endsWith(`:${id8}`)).reduce((s, r) => s + (r.cost_usd || 0), 0);
  } catch {
    return null;
  }
}

function appendResult(row) {
  let rows = [];
  try { rows = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8')); } catch { /* first run */ }
  rows.push(row);
  fs.mkdirSync(path.dirname(RESULTS_PATH), { recursive: true });
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(rows, null, 1));
}

// ---------- one run (does NOT persist — caller appends the final attempt) ----------
// gateDuration: the ≤10min criterion is a SINGLE-USER wall-clock property. Under
// concurrency, shared-engine contention inflates wall-clock, so it's not a faithful
// measure — record it, but don't gate on it (certified separately from concurrency-1 runs).
async function runOne(base, pool, persona, seed, model, gateDuration = true) {
  const failures = [];
  const t0 = Date.now();
  const criteria = { interview: false, options: false, demo: false, zip: false, duration: false };
  let id = null;

  try {
    const created = json(await req('POST', base, '/api/session', { idea: persona.one_line_idea, lang: persona.lang }));
    id = created.id;

    const ivRes = await req('POST', base, '/api/interview', { id });
    if (ivRes.status !== 200) throw new Error(`interview HTTP ${ivRes.status}: ${json(ivRes).detail || json(ivRes).error}`);
    const { questions } = json(ivRes);
    criteria.interview = checkInterview(questions, persona, failures);

    const answers = questions.map((q, i) =>
      persona.canned_answers[i] || (q.choices && q.choices[0]) || '都行');
    const opRes = await req('POST', base, '/api/options', { id, answers });
    if (opRes.status !== 200) throw new Error(`options HTTP ${opRes.status}: ${json(opRes).detail || json(opRes).error}`);
    const { options } = json(opRes);
    criteria.options = checkOptions(options, failures);

    const buildRes = await req('POST', base, '/api/build', { id, choice: seed % 3 });
    if (buildRes.status !== 200) throw new Error(`build HTTP ${buildRes.status}: ${json(buildRes).detail || json(buildRes).error}`);
    const html = (await req('GET', base, `/demo/${id}`)).body.toString('utf8');
    criteria.demo = await checkDemo(pool, html, persona, failures);

    const zipRes = await req('GET', base, `/api/zip/${id}`);
    if (zipRes.status !== 200) failures.push(`zip: HTTP ${zipRes.status}`);
    criteria.zip = zipRes.status === 200 && checkZip(zipRes.body, html, failures);
  } catch (e) {
    failures.push(e.message);
  }

  const durationS = Math.round((Date.now() - t0) / 1000);
  const wallClockOk = durationS <= RUN_BUDGET_S;
  criteria.duration = gateDuration ? wallClockOk : true; // recorded via wall_clock_ok either way
  if (gateDuration && !wallClockOk) failures.push(`duration ${durationS}s > ${RUN_BUDGET_S}s`);

  const pass = Object.values(criteria).every(Boolean);
  return {
    ts: new Date().toISOString(),
    persona: persona.id,
    domain: persona.domain,
    seed,
    model,
    engine: process.env.DEMO_FACTORY_CLAUDE ? 'stub' : 'real',
    model_interview_options: model,
    model_build: process.env.DEMO_FACTORY_BUILD_MODEL || 'claude-sonnet-5', // server default
    session: id,
    pass,
    infra_error: !pass && isInfraFailure(failures),
    criteria,
    failures,
    duration_s: durationS,
    wall_clock_ok: wallClockOk, // true single-user budget check, recorded even when not gated
    cost_usd: id ? runCost(id.slice(0, 8)) : null,
  };
}

// Retry a run whose ONLY problem is infrastructure (dead browser, reset socket, wedged
// CLI) so each persona×seed gets a genuine product verdict; bounded so a persistently
// broken environment surfaces as infra_error rather than looping forever.
async function runWithInfraRetry(base, pool, persona, seed, model, gateDuration, maxAttempts = 3) {
  let row;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    row = await runOne(base, pool, persona, seed, model, gateDuration);
    row.attempts = attempt;
    // retry on the broad set (maybe-transient); final bucketing uses the narrow INFRA_RE
    if (row.pass || !isRetryable(row.failures)) break;
  }
  return row;
}

// ---------- main ----------
async function main() {
  const args = parseArgs(process.argv);
  const personas = args.personas
    ? args.personas.map((pid) => {
        const p = FIXTURES.find((x) => x.id === pid);
        if (!p) throw new Error(`unknown persona ${pid}`);
        return p;
      })
    : FIXTURES;

  const model = args.model || require('../engine/run').DEFAULT_MODEL;
  const base = `http://127.0.0.1:${args.port}`;

  const serverLog = [];
  const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(args.port), DEMO_FACTORY_MODEL: model },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => serverLog.push(String(d)));
  server.stderr.on('data', (d) => serverLog.push(String(d)));
  const killServer = () => { try { server.kill('SIGKILL'); } catch { /* already dead */ } };
  process.on('SIGINT', () => { killServer(); process.exit(130); });
  process.on('SIGTERM', () => { killServer(); process.exit(143); });

  const summary = { pass: 0, fail: 0, infra: 0, byCriterion: {} };
  const nWorkers = Math.min(args.concurrency, args.seeds * personas.length || 1);
  const gateDuration = nWorkers === 1; // wall-clock is only a faithful single-user measure
  let wallClockOver = 0;
  let pool;
  try {
    // Readiness = OUR child printed its post-listen startup line. An impostor already
    // holding the port can answer HTTP but can never produce this line, and our child
    // dies on EADDRINUSE (caught by the exitCode check) — no false "ready".
    for (let i = 0; ; i++) {
      if (server.exitCode !== null) {
        throw new Error(`server exited ${server.exitCode} before ready (port busy?):\n${serverLog.join('')}`);
      }
      if (serverLog.some((l) => l.includes('已启动'))) break;
      if (i > 100) throw new Error(`server did not start within 10s:\n${serverLog.join('')}`);
      await new Promise((r) => setTimeout(r, 100));
    }

    pool = makeBrowserPool(require('puppeteer-core'));

    // flat task list; N workers pull from it. appendResult and the summary updates are
    // fully synchronous (no await between read and write), so they are safe under Node's
    // single-threaded concurrency — no lock needed. Each run has its own isolated context.
    const tasks = [];
    for (const persona of personas) {
      for (let seed = 0; seed < args.seeds; seed++) tasks.push({ persona, seed });
    }
    let next = 0;
    let done = 0;
    console.log(`running ${tasks.length} runs, concurrency ${nWorkers}, model ${model}${gateDuration ? '' : ' (duration recorded, not gated — certified at concurrency 1)'}\n`);
    const worker = async () => {
      while (next < tasks.length) {
        const { persona, seed } = tasks[next++]; // sync read+increment: no two workers get the same task
        const row = await runWithInfraRetry(base, pool, persona, seed, model, gateDuration);
        if (!row.wall_clock_ok) wallClockOver++;
        appendResult(row); // persist only the final attempt
        const bucket = row.pass ? 'pass' : row.infra_error ? 'infra' : 'fail';
        summary[bucket]++;
        if (bucket === 'fail') {
          for (const [k, v] of Object.entries(row.criteria)) {
            if (!v) summary.byCriterion[k] = (summary.byCriterion[k] || 0) + 1;
          }
        }
        done++;
        console.log(`[${done}/${tasks.length}] ${bucket.toUpperCase()} ${persona.id} seed=${seed} ${row.duration_s}s $${row.cost_usd ?? '?'}${row.attempts > 1 ? ` (${row.attempts} attempts)` : ''}${row.failures.length ? ' — ' + row.failures.join(' | ') : ''}`);
      }
    };
    await Promise.all(Array.from({ length: nWorkers }, worker));
  } finally {
    if (pool) await pool.close();
    killServer();
  }

  const graded = summary.pass + summary.fail; // infra runs never got a product verdict
  const pct = graded ? ((summary.pass / graded) * 100).toFixed(1) : 'n/a';
  console.log(`\nTOTAL: ${summary.pass} pass / ${summary.fail} fail / ${summary.infra} infra  (${summary.pass}/${graded} graded = ${pct}%)${Object.keys(summary.byCriterion).length ? '  gate failures by criterion: ' + JSON.stringify(summary.byCriterion) : ''}`);
  if (summary.infra) console.log(`NOTE: ${summary.infra} run(s) hit unrecoverable infrastructure errors after retries — excluded from the gate; investigate the environment, do not count as product failures.`);
  if (!gateDuration && wallClockOver) console.log(`NOTE: ${wallClockOver} run(s) exceeded the ${RUN_BUDGET_S}s wall-clock under concurrency (contention, not single-user latency — not gated; certify duration from a concurrency-1 run).`);
  process.exit(summary.fail === 0 && summary.infra === 0 ? 0 : summary.fail === 0 ? 2 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
