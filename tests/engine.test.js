'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runEngine } = require('../engine/run');

const FAKE = path.join(__dirname, 'fixtures', 'fake-claude.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-factory-engine-'));
const ledgerFor = (name) => path.join(tmp, `${name}.jsonl`);
const readLedger = (p) => fs.readFileSync(p, 'utf8').trim().split('\n').map(JSON.parse);

const base = { claudePath: FAKE, model: 'fake-model', timeoutMs: 5000 };

test('success: returns text + cost, logs one ok ledger row', async () => {
  process.env.FAKE_CLAUDE_MODE = 'ok';
  const ledgerPath = ledgerFor('ok');
  const r = await runEngine('hello prompt', { ...base, ledgerPath, purpose: 'unit-ok' });
  assert.equal(r.ok, true);
  assert.equal(r.text, 'ECHO:12'); // fake echoes stdin length — proves prompt went over stdin
  assert.equal(r.costUsd, 0.001);
  const rows = readLedger(ledgerPath);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ok, true);
  assert.equal(rows[0].purpose, 'unit-ok');
  assert.equal(rows[0].model, 'fake-model');
  assert.equal(rows[0].cost_usd, 0.001);
});

test('timeout: kills the child, retries once, both attempts logged as failures', async () => {
  process.env.FAKE_CLAUDE_MODE = 'hang';
  const ledgerPath = ledgerFor('hang');
  const r = await runEngine('x', { ...base, timeoutMs: 300, ledgerPath, purpose: 'unit-timeout' });
  assert.equal(r.ok, false);
  assert.match(r.error, /timed out after 300ms/);
  const rows = readLedger(ledgerPath);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((x) => x.ok), [false, false]);
  assert.deepEqual(rows.map((x) => x.attempt), [1, 2]);
});

test('transient failure: one retry recovers', async () => {
  process.env.FAKE_CLAUDE_MODE = 'fail-once';
  process.env.FAKE_CLAUDE_MARKER = path.join(tmp, 'fail-once-marker');
  const ledgerPath = ledgerFor('retry');
  const r = await runEngine('x', { ...base, ledgerPath, purpose: 'unit-retry' });
  assert.equal(r.ok, true);
  assert.equal(r.text, 'second-try');
  const rows = readLedger(ledgerPath);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].ok, false);
  assert.match(rows[0].error, /exited 1/);
  assert.equal(rows[1].ok, true);
});

test('large multibyte output survives pipe-chunk boundaries intact', async () => {
  process.env.FAKE_CLAUDE_MODE = 'big-zh';
  const r = await runEngine('x', { ...base, ledgerPath: ledgerFor('bigzh') });
  assert.equal(r.ok, true);
  assert.equal(r.text.length, '汉字测试'.length * 30000);
  assert.equal(r.text.includes('�'), false); // no replacement chars = no split-char corruption
  assert.equal(r.text.slice(0, 4), '汉字测试');
});

test('literal null JSON output is a failure, not a crash', async () => {
  process.env.FAKE_CLAUDE_MODE = 'null-json';
  const r = await runEngine('x', { ...base, ledgerPath: ledgerFor('nulljson') });
  assert.equal(r.ok, false);
  assert.match(r.error, /engine error result/);
});

test('non-JSON engine output is a failure, not a crash', async () => {
  process.env.FAKE_CLAUDE_MODE = 'bad-json';
  const r = await runEngine('x', { ...base, ledgerPath: ledgerFor('badjson') });
  assert.equal(r.ok, false);
  assert.match(r.error, /not JSON/);
});

test('is_error envelope is a failure', async () => {
  process.env.FAKE_CLAUDE_MODE = 'error-result';
  const r = await runEngine('x', { ...base, ledgerPath: ledgerFor('iserr') });
  assert.equal(r.ok, false);
  assert.match(r.error, /boom/);
});

test('missing binary is a failure, not a crash', async () => {
  const r = await runEngine('x', { ...base, claudePath: '/nonexistent/claude', ledgerPath: ledgerFor('nobin') });
  assert.equal(r.ok, false);
  // POSIX: ENOENT fires the 'error' event → "spawn failed". win32 shell branch: the
  // shell itself spawns fine and exits non-zero (cmd.exe 9009) → "engine exited".
  assert.match(r.error, /spawn failed|engine exited/);
});

test('win32 command line preserves the empty --tools argument through a real shell', async () => {
  // The win32 branch builds `... --tools ""` as a single quoted line because array-args
  // + shell:true silently DROP empty strings. Verify the quoted form survives an actual
  // shell pass (sh here; cmd.exe treats "" the same way for argv splitting).
  const { spawn } = require('child_process');
  const path = require('path');
  const probe = path.join(__dirname, 'fixtures', 'argv-probe.js');
  const line = `"${process.execPath}" "${probe}" -p --output-format json --model "fake-model" --tools ""`;
  const out = await new Promise((resolve) => {
    const c = spawn(line, [], { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let s = '';
    c.stdout.on('data', (d) => (s += d));
    c.on('close', () => resolve(s));
  });
  const argv = JSON.parse(out);
  assert.equal(argv[argv.length - 1], ''); // the empty --tools value survived
  assert.equal(argv[argv.length - 2], '--tools');
  assert.equal(argv[argv.length - 3], 'fake-model');
});
