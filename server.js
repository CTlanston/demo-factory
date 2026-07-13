'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  interviewPrompt, optionsPrompt, buildPrompt,
  extractJson, validateInterview, validateOptions,
  extractDemoHtml, validateDemoHtml,
} = require('./compiler/prompts');
const { runEngine } = require('./engine/run');

const ROOT = __dirname;
const UI_DIR = path.join(ROOT, 'wizard-ui');
const SESSIONS_DIR = process.env.DEMO_FACTORY_SESSIONS_DIR || path.join(ROOT, 'sessions');
const BODY_LIMIT = 512 * 1024;

// Plain-language failure copy — the UI shows this verbatim with one retry button.
const OOPS = {
  zh: '刚才没成功。可能是网络慢,也可能是生成的时候出了点小状况——点"再试一次"通常就好了。',
  en: 'That didn\'t work. Maybe a slow connection, maybe a hiccup while generating — "Try again" usually fixes it.',
};

class HttpError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

// ---------- sessions (one JSON file each, crash-safe) ----------

const validId = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
const sessionFile = (id) => path.join(SESSIONS_DIR, `${id}.json`);

function loadSession(id) {
  if (!validId(id)) throw new HttpError(404, 'no such session');
  try {
    return JSON.parse(fs.readFileSync(sessionFile(id), 'utf8'));
  } catch {
    throw new HttpError(404, 'no such session');
  }
}

function saveSession(s) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  const file = sessionFile(s.id);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s));
  fs.renameSync(tmp, file);
}

// Public view: everything the UI needs to resume, minus the big demo payload.
function sessionView(s) {
  const { demo_html, ...rest } = s;
  return { ...rest, has_demo: Boolean(demo_html) };
}

// ---------- store-only zip writer (no deps) ----------

let CRC_TABLE;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// entries: [{name: string, data: Buffer}] → zip Buffer (method 0 = stored)
function zipStore(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const fixed = { crc, size: data.length };
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header
    local.writeUInt16LE(20, 4);         // version needed
    local.writeUInt16LE(0x0800, 6);     // UTF-8 filenames
    local.writeUInt16LE(0, 8);          // method: stored
    local.writeUInt32LE(0, 10);         // dos time/date: epoch
    local.writeUInt32LE(fixed.crc, 14);
    local.writeUInt32LE(fixed.size, 18);
    local.writeUInt32LE(fixed.size, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);         // extra len
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central dir header
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(fixed.crc, 16);
    central.writeUInt32LE(fixed.size, 20);
    central.writeUInt32LE(fixed.size, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralStart = offset;
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central dir
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

function readmeFor(session) {
  return `# 你的小工具 / Your little tool

${session.idea}

这是你自己的东西——随便用、随便改、送给谁都行。
This is yours — use it, change it, share it with anyone.

## 怎么打开 / How to open

双击 demo.html 就能打开,不用安装任何东西,也不用联网。
Double-click demo.html. Nothing to install, no internet needed.

## 想改点什么? / Want to change something?

把 demo.html 发给任何愿意帮你的人(或者一个 AI 助手),用大白话说出你想改的地方就行。
Hand demo.html to anyone helpful (or an AI assistant) and describe the change in plain words.

——— 由 demo-factory 生成 / Made with demo-factory
`;
}

// ---------- engine steps (the three LLM boundaries) ----------

// The build step produces the user's deliverable (the "wow" demo), so it uses a stronger
// model by default; the cheaper interview/options cognitive steps stay on the base model.
// Both overridable (a CI stub sets DEMO_FACTORY_CLAUDE and ignores model).
const BUILD_MODEL = process.env.DEMO_FACTORY_BUILD_MODEL || 'claude-sonnet-5';
const engineBase = (purpose, model) => ({
  purpose,
  claudePath: process.env.DEMO_FACTORY_CLAUDE || 'claude',
  ...(model ? { model } : {}),
});

// Run one engine step. `interpret(text)` turns raw output into {ok:true, value} or
// {ok:false, detail}. On a parse/validation miss we resample the engine ONCE before
// giving up — a single bad draw (unescaped quote, borderline-similar options, a stray
// word after "?") usually clears on a fresh sample, exactly like a user's "Try again".
// Transport failures (runEngine !ok) are already retried once inside runEngine.
async function engineStep(session, step, prompt, purpose, interpret, maxDraws = 2, model) {
  let raw = '';
  let detail = 'engine unavailable';
  for (let attempt = 1; attempt <= maxDraws; attempt++) {
    const r = await runEngine(prompt, engineBase(purpose, model));
    if (!r.ok) { detail = r.error; break; } // transport failure: runEngine already retried internally — don't amplify
    raw = r.text;
    let out;
    try {
      out = interpret(r.text);
    } catch (e) {
      out = { ok: false, detail: `parse: ${e.message}` };
    }
    if (out.ok) {
      delete session.invalid;
      return out.value;
    }
    detail = out.detail; // parse/validation miss — loop resamples once
  }
  // persist the raw output for failure analysis (only a validation miss has raw worth keeping), then 502
  if (raw) {
    session.invalid = { step, detail, raw: String(raw).slice(0, 30000), ts: new Date().toISOString() };
    saveSession(session);
  }
  throw new HttpError(502, OOPS[session.lang], `${step}: ${detail}`);
}

async function stepInterview(session) {
  const questions = await engineStep(
    session, 'interview',
    interviewPrompt(session.idea, session.lang),
    `wizard:interview:${session.id.slice(0, 8)}`,
    (text) => {
      const qs = extractJson(text).questions;
      const v = validateInterview(qs);
      return v.ok ? { ok: true, value: qs } : { ok: false, detail: `invalid: ${v.errors.join('; ')}` };
    });
  session.questions = questions;
  saveSession(session);
}

async function stepOptions(session, answers) {
  if (!Array.isArray(answers) || answers.length !== session.questions.length ||
      answers.some((a) => typeof a !== 'string' || !a.trim())) {
    throw new HttpError(400, 'answers must be one non-empty string per question');
  }
  session.answers = answers;
  const qa = session.questions.map((q, i) => ({ question: q.question, answer: answers[i] }));
  const options = await engineStep(
    session, 'options',
    optionsPrompt(session.idea, qa, session.lang),
    `wizard:options:${session.id.slice(0, 8)}`,
    (text) => {
      const opts = extractJson(text).options;
      const v = validateOptions(opts);
      return v.ok ? { ok: true, value: opts } : { ok: false, detail: `invalid: ${v.errors.join('; ')}` };
    },
    // narrow single-domain option sets have a real char-bigram "domain floor" that
    // occasionally rejects genuinely-distinct shapes; one extra draw for options only
    3);
  session.options = options;
  saveSession(session);
}

async function stepBuild(session, choice) {
  if (!Number.isInteger(choice) || choice < 0 || choice > 2 || !session.options) {
    throw new HttpError(400, 'choice must be 0, 1 or 2 on a session with options');
  }
  session.choice = choice;
  const qa = session.questions.map((q, i) => ({ question: q.question, answer: session.answers[i] }));
  const html = await engineStep(
    session, 'build',
    buildPrompt(session.idea, qa, session.options[choice], session.lang),
    `wizard:build:${session.id.slice(0, 8)}`,
    (text) => {
      const doc = extractDemoHtml(text);
      const v = validateDemoHtml(doc);
      return v.ok ? { ok: true, value: doc } : { ok: false, detail: `invalid: ${v.errors.join('; ')}` };
    },
    2,           // maxDraws
    BUILD_MODEL, // stronger model for the deliverable demo
  );
  session.demo_html = html;
  saveSession(session);
}

// ---------- http plumbing ----------

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > BODY_LIMIT) {
        reject(new HttpError(413, 'request too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const parsed = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return reject(new HttpError(400, 'body must be a JSON object'));
        }
        resolve(parsed);
      } catch {
        reject(new HttpError(400, 'body is not valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  const file = path.normalize(path.join(UI_DIR, rel));
  if (!file.startsWith(UI_DIR + path.sep)) throw new HttpError(404, 'not found');
  let data;
  try {
    data = fs.readFileSync(file);
  } catch {
    throw new HttpError(404, 'not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(data);
}

async function route(req, res) {
  let url;
  try {
    url = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    throw new HttpError(400, 'bad url');
  }
  const post = (p) => req.method === 'POST' && url === p;
  const get = (p) => req.method === 'GET' && url.startsWith(p);

  if (post('/api/session')) {
    const { idea, lang } = await readBody(req);
    if (typeof idea !== 'string' || !idea.trim()) throw new HttpError(400, 'idea required');
    const session = {
      id: crypto.randomUUID(),
      created: new Date().toISOString(),
      lang: lang === 'en' ? 'en' : 'zh',
      idea: idea.trim().slice(0, 500),
    };
    saveSession(session);
    return sendJson(res, 200, { id: session.id });
  }
  if (post('/api/interview')) {
    const { id } = await readBody(req);
    const session = loadSession(id);
    await stepInterview(session);
    return sendJson(res, 200, { questions: session.questions });
  }
  if (post('/api/options')) {
    const { id, answers } = await readBody(req);
    const session = loadSession(id);
    if (!session.questions) throw new HttpError(400, 'interview not done yet');
    await stepOptions(session, answers);
    return sendJson(res, 200, { options: session.options });
  }
  if (post('/api/build')) {
    const { id, choice } = await readBody(req);
    const session = loadSession(id);
    await stepBuild(session, choice);
    return sendJson(res, 200, { ok: true });
  }
  if (get('/api/session/')) {
    const session = loadSession(url.slice('/api/session/'.length));
    return sendJson(res, 200, sessionView(session));
  }
  if (get('/api/zip/')) {
    const session = loadSession(url.slice('/api/zip/'.length));
    if (!session.demo_html) throw new HttpError(404, 'demo not built yet');
    const zip = zipStore([
      { name: 'demo.html', data: Buffer.from(session.demo_html, 'utf8') },
      { name: 'README_你的代码.md', data: Buffer.from(readmeFor(session), 'utf8') },
    ]);
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="demo.zip"; filename*=UTF-8''${encodeURIComponent('你的小工具.zip')}`,
    });
    return res.end(zip);
  }
  if (get('/demo/')) {
    const session = loadSession(url.slice('/demo/'.length));
    if (!session.demo_html) throw new HttpError(404, 'demo not built yet');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(session.demo_html);
  }
  if (req.method === 'GET') return serveStatic(res, url);
  throw new HttpError(404, 'not found');
}

function createServer() {
  const server = http.createServer((req, res) => {
    route(req, res).catch((err) => {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) {
        sendJson(res, status, { error: err.message, detail: err.detail || null });
      } else {
        res.end();
      }
    });
  });
  server.requestTimeout = 0; // engine build calls can take minutes
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3210);
  createServer().listen(port, () => {
    console.log(`demo-factory 已启动 → http://localhost:${port}`);
  });
}

module.exports = { createServer, zipStore, crc32 };
