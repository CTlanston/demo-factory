'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');

test('gcSessions keeps only the newest N session files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-gc-'));
  process.env.DEMO_FACTORY_SESSIONS_DIR = dir;
  delete require.cache[require.resolve('../server.js')];
  const { gcSessions } = require('../server.js');
  for (let i = 0; i < 7; i++) {
    const f = path.join(dir, `s${i}.json`);
    fs.writeFileSync(f, '{}');
    fs.utimesSync(f, new Date(2026, 0, 1 + i), new Date(2026, 0, 1 + i));
  }
  fs.writeFileSync(path.join(dir, 'not-a-session.txt'), 'keep me');
  const removed = gcSessions(3);
  assert.equal(removed, 4);
  const left = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  assert.deepEqual(left, ['s4.json', 's5.json', 's6.json']); // newest 3 survive
  assert.ok(fs.existsSync(path.join(dir, 'not-a-session.txt'))); // non-session untouched
});

test('startServer binds 127.0.0.1 by default and prints a humane EADDRINUSE message', async () => {
  // occupy a port on localhost, then start server.js as a real child on the same port
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
  const port = blocker.address().port;

  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(port), DEMO_FACTORY_SESSIONS_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'df-h-')) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const code = await new Promise((r) => child.on('close', r));
  blocker.close();
  assert.equal(code, 1);
  assert.match(out, /已经被占用/); // humane, actionable message — not a stack trace
  assert.match(out, /PORT=/);
  assert.doesNotMatch(out, /EADDRINUSE.*at Server/s); // no raw stack
});

test('server listens on loopback only by default (LAN interface refuses)', async () => {
  // grab a free port
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-h2-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(port), DEMO_FACTORY_SESSIONS_DIR: dir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no startup line: ' + out)), 8000);
    child.stdout.on('data', () => {
      if (out.includes('已启动')) { clearTimeout(t); resolve(); }
    });
  });
  try {
    const tryConnect = (host) => new Promise((resolve) => {
      const s = net.connect({ host, port, timeout: 1500 });
      s.on('connect', () => { s.destroy(); resolve(true); });
      s.on('error', () => resolve(false));
      s.on('timeout', () => { s.destroy(); resolve(false); });
    });
    assert.equal(await tryConnect('127.0.0.1'), true, 'loopback must accept');
    const lan = Object.values(os.networkInterfaces()).flat()
      .find((i) => i && i.family === 'IPv4' && !i.internal);
    if (lan) {
      assert.equal(await tryConnect(lan.address), false, `LAN ${lan.address} must refuse`);
    } else {
      console.log('  (no non-internal IPv4 interface — LAN-refuse assertion skipped on this machine)');
    }
  } finally {
    child.kill('SIGKILL');
  }
});

test('bin entry exists, is executable, and requires cleanly', () => {
  const bin = path.join(ROOT, 'bin', 'demo-factory.js');
  assert.ok(fs.existsSync(bin));
  const src = fs.readFileSync(bin, 'utf8');
  assert.match(src, /^#!\/usr\/bin\/env node/);
  assert.match(src, /startServer\(\)/);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.bin['demo-factory'], './bin/demo-factory.js');
  assert.ok(pkg.files.includes('bin/'));
});
