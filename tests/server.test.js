'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

// Isolate BEFORE requiring server: fake engine, temp sessions dir, temp cost ledger.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-factory-server-'));
process.env.DEMO_FACTORY_SESSIONS_DIR = path.join(tmp, 'sessions');
process.env.DEMO_FACTORY_LEDGER = path.join(tmp, 'ledger.jsonl');
process.env.DEMO_FACTORY_CLAUDE = path.join(__dirname, 'fixtures', 'fake-claude.js');
process.env.FAKE_CLAUDE_MODE = 'wizard';

const { createServer, zipStore, crc32 } = require('../server');

let server;
let base;

test.before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const post = async (p, body) => {
  const res = await fetch(base + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
};
const get = async (p) => {
  const res = await fetch(base + p);
  return { status: res.status, res };
};

test('zipStore: parseable archive with correct CRCs and central directory', () => {
  const a = Buffer.from('hello zip', 'utf8');
  const zip = zipStore([{ name: 'a.txt', data: a }]);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.readUInt32LE(14), crc32(a));
  assert.equal(zip.readUInt32LE(18), a.length);
  assert.equal(zip.subarray(30, 35).toString(), 'a.txt');
  assert.equal(zip.subarray(35, 35 + a.length).toString(), 'hello zip');
  const eocd = zip.subarray(zip.length - 22);
  assert.equal(eocd.readUInt32LE(0), 0x06054b50);
  assert.equal(eocd.readUInt16LE(10), 1); // total entries
});

test('full wizard flow over HTTP: session → interview → options → build → demo → zip → resume', async () => {
  const created = await post('/api/session', { idea: '我想记一下每天花了多少钱', lang: 'zh' });
  assert.equal(created.status, 200);
  const id = created.data.id;
  assert.match(id, /^[0-9a-f-]{36}$/);

  const iv = await post('/api/interview', { id });
  assert.equal(iv.status, 200);
  assert.equal(iv.data.questions.length, 6);

  const answers = iv.data.questions.map((q) => q.choices[0]);
  const op = await post('/api/options', { id, answers });
  assert.equal(op.status, 200);
  assert.equal(op.data.options.length, 3);

  const build = await post('/api/build', { id, choice: 0 });
  assert.equal(build.status, 200);

  const demo = await get(`/demo/${id}`);
  assert.equal(demo.status, 200);
  assert.match(demo.res.headers.get('content-type'), /text\/html/);
  const html = await demo.res.text();
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /我的小账本/);

  const zipRes = await get(`/api/zip/${id}`);
  assert.equal(zipRes.status, 200);
  const zip = Buffer.from(await zipRes.res.arrayBuffer());
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const nameLen = zip.readUInt16LE(26);
  const name = zip.subarray(30, 30 + nameLen).toString();
  assert.equal(name, 'demo.html');
  const size = zip.readUInt32LE(18);
  const data = zip.subarray(30 + nameLen, 30 + nameLen + size);
  assert.equal(data.toString('utf8'), html); // zip payload byte-identical to served demo
  assert.equal(zip.readUInt32LE(14), crc32(data));
  assert.ok(zip.includes(Buffer.from('README_你的代码.md', 'utf8')));
  assert.equal(zip.subarray(zip.length - 22).readUInt16LE(10), 2); // 2 entries

  const view = await get(`/api/session/${id}`);
  assert.equal(view.status, 200);
  const s = await view.res.json();
  assert.equal(s.has_demo, true);
  assert.equal('demo_html' in s, false);
  assert.equal(s.options.length, 3);

  // session persisted as one JSON file
  const file = path.join(process.env.DEMO_FACTORY_SESSIONS_DIR, `${id}.json`);
  assert.ok(fs.existsSync(file));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).demo_html, html);
});

test('validation errors are 400s', async () => {
  const { data: { id } } = await post('/api/session', { idea: '记点东西', lang: 'zh' });
  assert.equal((await post('/api/session', { idea: '' })).status, 400);
  assert.equal((await post('/api/session', null)).status, 400); // non-object JSON body
  assert.equal((await post('/api/session', [1, 2])).status, 400);
  assert.equal((await post('/api/options', { id, answers: ['x'] })).status, 400); // interview not done
  await post('/api/interview', { id });
  assert.equal((await post('/api/options', { id, answers: ['只有一个'] })).status, 400); // wrong count
  assert.equal((await post('/api/build', { id, choice: 0 })).status, 400); // no options yet
});

test('unknown / invalid session ids are 404s', async () => {
  assert.equal((await get('/api/session/deadbeef-0000-4000-8000-000000000000')).status, 404);
  assert.equal((await get('/api/session/../../etc/passwd')).status, 404);
  assert.equal((await post('/api/interview', { id: 'zzz' })).status, 404);
  assert.equal((await get('/demo/nope')).status, 404);
  assert.equal((await get('/api/zip/nope')).status, 404);
});

test('engine failure surfaces plain-language 502 with retry-friendly copy', async () => {
  const { data: { id } } = await post('/api/session', { idea: '记点东西', lang: 'zh' });
  process.env.FAKE_CLAUDE_MODE = 'error-result';
  try {
    const r = await post('/api/interview', { id });
    assert.equal(r.status, 502);
    assert.match(r.data.error, /再试一次/);
    assert.ok(r.data.detail); // technical detail preserved for the harness/logs
  } finally {
    process.env.FAKE_CLAUDE_MODE = 'wizard';
  }
});

test('a first-draw invalid engine output recovers on the resample (no 502)', async () => {
  const { data: { id } } = await post('/api/session', { idea: '记点东西', lang: 'zh' });
  process.env.FAKE_CLAUDE_MODE = 'iv-recover';
  process.env.FAKE_CLAUDE_MARKER = path.join(tmp, `recover-${id}`);
  try {
    const r = await post('/api/interview', { id });
    assert.equal(r.status, 200); // first draw invalid, resample valid → step succeeds
    assert.equal(r.data.questions.length, 6);
    const s = JSON.parse(fs.readFileSync(
      path.join(process.env.DEMO_FACTORY_SESSIONS_DIR, `${id}.json`), 'utf8'));
    assert.equal('invalid' in s, false); // no stale invalid blob after a recovered step
  } finally {
    process.env.FAKE_CLAUDE_MODE = 'wizard';
    delete process.env.FAKE_CLAUDE_MARKER;
  }
});

test('invalid engine output → 502 and raw output persisted on the session for failure analysis', async () => {
  const { data: { id } } = await post('/api/session', { idea: '记点东西', lang: 'zh' });
  process.env.FAKE_CLAUDE_MODE = 'wizard-badiv';
  try {
    const r = await post('/api/interview', { id });
    assert.equal(r.status, 502);
    assert.match(r.data.detail, /does not end with a question mark/);
    const s = JSON.parse(fs.readFileSync(
      path.join(process.env.DEMO_FACTORY_SESSIONS_DIR, `${id}.json`), 'utf8'));
    assert.equal(s.invalid.step, 'interview');
    assert.match(s.invalid.raw, /陈述句/); // raw engine output captured
  } finally {
    process.env.FAKE_CLAUDE_MODE = 'wizard';
  }
});

test('static serving + path traversal blocked', async () => {
  const home = await get('/');
  assert.equal(home.status, 200);
  assert.match(await home.res.text(), /class="brand"/);
  const css = await get('/style.css');
  assert.match(css.res.headers.get('content-type'), /text\/css/);

  // raw request: fetch would normalize the dot segments away
  const traversal = await new Promise((resolve) => {
    http.get(`${base}/..%2Fpackage.json`, (res) => resolve(res.statusCode));
  });
  assert.equal(traversal, 404);
  assert.equal((await get('/%2e%2e/package.json')).status, 404);
});
