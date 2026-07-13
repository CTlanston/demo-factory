'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { findBannedTerms, BANNED_TERMS } = require('../compiler/banned-terms');
const { similarity, materiallyDifferent } = require('../compiler/option-diff');
const {
  interviewPrompt, optionsPrompt, buildPrompt,
  extractJson, validateInterview, validateOptions,
  extractDemoHtml, validateDemoHtml,
} = require('../compiler/prompts');
const fixtures = require('../personas/fixtures.json');

// ---------- banned-term checker ----------

test('banned: catches zh tech jargon as substring', () => {
  assert.equal(findBannedTerms('我们会把数据存到数据库里').length, 1);
  assert.equal(findBannedTerms('需要部署到服务器吗').length, 2);
});

test('banned: catches en terms case-insensitively on word boundaries', () => {
  assert.equal(findBannedTerms('We will call an API for that').length, 1);
  assert.equal(findBannedTerms('Choose a Framework you like').length, 1);
});

test('banned: no false positive inside larger words', () => {
  assert.equal(findBannedTerms('rapid therapy grape').length, 0); // api inside words
  assert.equal(findBannedTerms('观察服装趋势').length, 0);
});

test('banned: catches english plurals', () => {
  assert.equal(findBannedTerms('We use databases and APIs on our servers').length, 3);
});

test('banned: extra persona terms are honored', () => {
  assert.equal(findBannedTerms('要不要用小程序开发', ['小程序开发']).length, 1);
});

test('banned: everyday novice sentences are clean', () => {
  const clean = [
    '你想让谁看到这份价目表呢?',
    '每天大概记几笔开销?',
    'Who will use this with you?',
    '想要温馨一点还是简洁一点的感觉?',
  ];
  for (const s of clean) assert.deepEqual(findBannedTerms(s), []);
});

// ---------- option-diff ----------

const optA = { title: '纯本地记账本', what_you_get: ['自己手机上记支出', '按吃饭交通分类', '看每月总数'], what_you_dont_get: ['家人不能一起记', '没有拍照功能'], effort_cost: '马上就能用,不花钱', best_if: '只想自己安安静静记账' };
const optB = { title: '全家共享账本', what_you_get: ['发链接全家一起记', '看谁花了什么', '每月汇总'], what_you_dont_get: ['离线时看不到别人记的'], effort_cost: '要多等几天,可能有少量花费', best_if: '想和家里人一起管钱' };
const optC = { title: '拍照记账版', what_you_get: ['拍下小票自动留底', '翻看照片回忆花销'], what_you_dont_get: ['不能自动算总数'], effort_cost: '中等,拍照要自己整理', best_if: '懒得打字只想随手拍' };

test('option-diff: materially different options pass', () => {
  const r = materiallyDifferent([optA, optB, optC]);
  assert.equal(r.ok, true, JSON.stringify(r.pairs));
});

test('option-diff: rephrasings fail', () => {
  const clone = { ...optA, title: '本地记账小本子' };
  const r = materiallyDifferent([optA, clone, optB]);
  assert.equal(r.ok, false);
});

test('option-diff: similarity is 1 for identical, low for unrelated', () => {
  assert.equal(similarity('记录每天的花销', '记录每天的花销'), 1);
  assert.ok(similarity('记录每天的花销', 'track my dog walks') < 0.1);
});

// ---------- prompt builders ----------

test('prompts: interview prompt embeds idea, bans jargon, demands JSON', () => {
  for (const lang of ['zh', 'en']) {
    const p = interviewPrompt('我想记账', lang);
    assert.ok(p.includes('我想记账'));
    assert.ok(p.includes('数据库'));
    assert.ok(p.includes('"questions"'));
  }
});

test('prompts: options prompt embeds QA and demands 3 materially different options', () => {
  const p = optionsPrompt('记账', [{ question: '给谁用?', answer: '自己' }], 'zh');
  assert.ok(p.includes('给谁用?') && p.includes('自己'));
  assert.ok(p.includes('3 条'));
  assert.ok(p.includes('"options"'));
});

test('prompts: build prompt states single-file offline constraints', () => {
  const p = buildPrompt('记账', [{ question: 'q?', answer: 'a' }], optA, 'zh');
  for (const marker of ['<!DOCTYPE html>', 'localStorage', 'ZERO external resources', 'double-click', 'Pre-seed']) {
    assert.ok(p.includes(marker), `missing: ${marker}`);
  }
});

// ---------- parsers / validators ----------

test('extractJson: tolerates fences and prose', () => {
  const obj = { questions: [{ question: 'ok?', choices: ['a', 'b'] }] };
  for (const raw of [JSON.stringify(obj), '```json\n' + JSON.stringify(obj) + '\n```', 'Here you go:\n' + JSON.stringify(obj) + '\nDone.']) {
    assert.deepEqual(extractJson(raw), obj);
  }
});

const goodQs = Array.from({ length: 6 }, (_, i) => ({ question: `你想要什么样的感觉呢 ${i}?`, choices: ['温馨', '简洁', '活泼'] }));

test('validateInterview: 6 clean questions pass', () => {
  assert.equal(validateInterview(goodQs).ok, true);
});

test('validateInterview: accepts boundary counts 5 and 8', () => {
  const q = (i) => ({ question: `问题${i},你觉得呢?`, choices: ['a', 'b', 'c'] });
  assert.equal(validateInterview(Array.from({ length: 5 }, (_, i) => q(i))).ok, true);
  assert.equal(validateInterview(Array.from({ length: 8 }, (_, i) => q(i))).ok, true);
  assert.equal(validateInterview(Array.from({ length: 9 }, (_, i) => q(i))).ok, false);
});

test('validateInterview: accepts full-width \\uFF1F question mark (G2 regression — was mangled to ASCII)', () => {
  const qs = Array.from({ length: 6 }, (_, i) => (
    { question: `这个小东西第${i}个问题是给谁用的？`, choices: ['自己', '家人'] }));
  const v = validateInterview(qs);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});

test('validateInterview: rejects wrong count, jargon, non-questions', () => {
  assert.equal(validateInterview(goodQs.slice(0, 4)).ok, false);
  assert.equal(validateInterview([...goodQs.slice(0, 5), { question: '要不要数据库?', choices: ['要', '不要'] }]).ok, false);
  assert.equal(validateInterview([...goodQs.slice(0, 5), { question: '这是陈述句。', choices: ['a', 'b'] }]).ok, false);
});

test('validateInterview: persona extra banned terms enforced', () => {
  const qs = [...goodQs.slice(0, 5), { question: '需要小程序开发吗?', choices: ['要', '不要'] }];
  assert.equal(validateInterview(qs, ['小程序开发']).ok, false);
});

test('validateOptions: 3 different complete options pass', () => {
  assert.equal(validateOptions([optA, optB, optC]).ok, true);
});

test('validateOptions: rejects wrong count, missing fields, near-duplicates', () => {
  assert.equal(validateOptions([optA, optB]).ok, false);
  assert.equal(validateOptions([optA, optB, { title: 'x' }]).ok, false);
  assert.equal(validateOptions([optA, { ...optA, title: '换个名字' }, optB]).ok, false);
});

const goodHtml = '<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>我的记账本</title><style>body{font-size:18px}</style></head><body><h1>记账</h1><input placeholder="金额"><script>localStorage.setItem("x","1")</script></body></html>';

test('demo html: extract + validate a clean single-file document', () => {
  const html = extractDemoHtml('some preamble\n' + goodHtml + '\ntrailing');
  assert.equal(validateDemoHtml(html).ok, true, JSON.stringify(validateDemoHtml(html).errors));
});

test('demo html: rejects external resources', () => {
  assert.equal(validateDemoHtml(goodHtml.replace('<style>', '<link href="https://cdn.example.com/a.css" rel="stylesheet"><style>')).ok, false);
  assert.equal(validateDemoHtml(goodHtml.replace('<script>', '<script src="https://cdn.example.com/a.js"></script><script>')).ok, false);
  assert.equal(validateDemoHtml(goodHtml.replace('<h1>记账</h1>', '<img src="https://example.com/x.png">')).ok, false);
});

test('demo html: rejects protocol-relative URLs, allows data: link href', () => {
  assert.equal(validateDemoHtml(goodHtml.replace('<h1>记账</h1>', '<img src="//cdn.example.com/x.png">')).ok, false);
  assert.equal(validateDemoHtml(goodHtml.replace('<style>', '<link rel="icon" href="data:image/png;base64,AA"><style>')).ok, true);
});

test('demo html: inline SVG xmlns is not treated as external', () => {
  const withSvg = goodHtml.replace('<h1>记账</h1>', '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>');
  assert.equal(validateDemoHtml(withSvg).ok, true);
});

test('demo html: rejects syntactically-broken inline JS (build-time parse gate)', () => {
  const broken = goodHtml.replace('<script>localStorage.setItem("x","1")</script>',
    "<script>const cats=[{id:'a'},{id:milk-tea'}]; render();</script>"); // stray quote
  const v = validateDemoHtml(broken);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /inline <script> parse error/.test(e)), JSON.stringify(v.errors));
});

test('demo html: valid JS with src= in the body is NOT a false parse error', () => {
  const ok = goodHtml.replace('<script>localStorage.setItem("x","1")</script>',
    '<script>const el=document.createElement("img"); el.src="data:image/svg+xml;utf8,<svg/>"; document.body.append(el);</script>');
  assert.equal(validateDemoHtml(ok).ok, true, JSON.stringify(validateDemoHtml(ok).errors));
});

// ---------- fixtures sanity (harness contract) ----------

test('fixtures: 20 personas, 10 domains x2, ideas are jargon-free', () => {
  assert.equal(fixtures.personas.length, 20);
  const domains = new Set(fixtures.personas.map((p) => p.domain));
  assert.equal(domains.size, 10);
  for (const p of fixtures.personas) {
    assert.deepEqual(findBannedTerms(p.one_line_idea), [], p.id);
    assert.ok(p.canned_answers.length >= 8, p.id);
  }
});
