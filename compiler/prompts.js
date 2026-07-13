'use strict';

const { BANNED_TERMS, findBannedTerms } = require('./banned-terms');
const { materiallyDifferent, SIMILARITY_THRESHOLD } = require('./option-diff');

const zh = (lang) => lang !== 'en';

// ---------- prompt builders (deterministic templates around one LLM boundary) ----------

function interviewPrompt(idea, lang) {
  const L = zh(lang);
  return `${L
    ? '你在帮一位完全不懂技术的普通人把一个模糊的想法问清楚。这个人可能是老人、店主、家长,一辈子没写过一行程序。'
    : 'You are helping a completely non-technical person clarify a vague idea. They have never written a line of software in their life.'}

${L ? '他们的想法是:' : 'Their idea is:'} "${idea}"

${L
    ? '请生成 6 个循循善诱的追问,帮他们想清楚自己到底要什么。规则:'
    : 'Generate 6 gentle follow-up questions that help them figure out what they really want. Rules:'}
${L
    ? `1. 绝对禁止任何技术词汇,包括但不限于:${BANNED_TERMS.join('、')}。像跟邻居聊天一样说话。
2. 每个问题给 3-4 个通俗的选项,同时允许自由回答。
3. 问"给谁用、记些什么、最想一眼看到什么、什么样的感觉"这类生活化问题,不问"怎么实现"。
4. 每个问题必须以问号(?)结尾,问号后面不能再有任何文字或举例。
5. 全部用中文。
6. 在 JSON 字符串里如果要引用词句,一律用中文引号「」,绝对不要用半角双引号 " ——它会提前结束字符串、破坏 JSON。`
    : `1. Absolutely no technical vocabulary, including but not limited to: ${BANNED_TERMS.join(', ')}. Talk like a friendly neighbor.
2. Each question offers 3-4 plain-language choices, and free-text answers are also allowed.
3. Ask everyday questions (who is it for, what to keep track of, what matters most at a glance, what feel/style) — never "how to build it".
4. Every question must end with a question mark; nothing may follow the mark.
5. Everything in English.
6. If you quote a word or phrase inside a JSON string value, use single quotes 'like this' — never a raw double quote " (it ends the string and breaks the JSON).`}

${L ? '只输出下面格式的 JSON,不要任何其他文字:' : 'Output ONLY JSON in this exact shape, nothing else:'}
{"questions":[{"question":"...?","choices":["...","...","..."]}]}`;
}

function optionsPrompt(idea, qa, lang) {
  const L = zh(lang);
  const qaText = qa.map((x, i) => `${i + 1}. ${L ? '问' : 'Q'}: ${x.question}\n   ${L ? '答' : 'A'}: ${x.answer}`).join('\n');
  return `${L
    ? '一位不懂技术的普通人想要做一个小工具。根据他的想法和回答,给出 3 条实现路线让他选。'
    : 'A non-technical person wants a small tool. Based on their idea and answers, present 3 roadmap options to choose from.'}

${L ? '想法' : 'Idea'}: "${idea}"
${L ? '访谈记录' : 'Interview'}:
${qaText}

${L ? '规则:' : 'Rules:'}
${L
    ? `1. 3 条路线必须在"根本做法"上就不一样,而不只是换个说法。根本做法指:东西怎么进来(自己一个字一个字打 / 拍照片自动认 / 语音说 / 从网上粘)、谁在用(只有我自己 / 一家人一起填 / 一群人接龙)、东西存在哪。三条要各占一种。特别注意:两条都是"自己打字填进去"的,就算标题和文案不同,也算同一种做法,不允许!
2. 每条路线包含:标题、你会得到什么(3-5条)、你不会得到什么(2-3条,诚实!)、费劲程度和花费的直白提示、最适合什么情况。
3. 三条路线的标题和开头措辞都要明显不同;"你不会得到"也不要三条都用一模一样的句子,按各自的形态重新说,别套用同一个模板。另外,三条不要把同一句"人人都有"的功能(比如"按名字搜索""标记做过的")一字不差地重复三遍——共有能力只说一次,或按各自形态换句话说;每条"你会得到"的第一条,必须先讲这条路线独有的做法(拍照识别 / 网上粘贴 / 自己打字),不要先写共有功能。
4. 禁止任何技术词汇(${BANNED_TERMS.slice(0, 8).join('、')}等),用大白话。
5. 全部用中文。
6. 在 JSON 字符串里如果要引用词句,一律用中文引号「」,绝对不要用半角双引号 " ——它会提前结束字符串、破坏 JSON。`
    : `1. The 3 options must differ in their FUNDAMENTAL approach, not just wording. The approach is: how information gets in (you type it / snap a photo that auto-reads it / say it aloud / paste from the web), who uses it (just me / a family fills it together / a group takes turns), or where it lives. Each option must take a different one. CRITICAL: two options that are both "you type it in yourself" count as the SAME approach even with different titles/copy — that is NOT allowed.
2. Each option has: title, what you get (3-5 items), what you don't get (2-3 items, be honest!), a plain effort & cost hint, and best-if.
3. Give the three options distinct titles AND distinct opening wording; do NOT reuse the same "what you don't get" sentences verbatim across options — reword them per shape rather than templating. Also do NOT repeat the same table-stakes bullet (e.g. "Search by name", "Mark the ones you've done") word-for-word in all three cards — state a shared capability once, or reword it per shape; the FIRST "what you get" bullet of every option must foreground THAT option's distinguishing mechanism (snap-a-photo / paste-from-web / type-it-yourself), not a shared feature.
4. No technical vocabulary (${BANNED_TERMS.slice(0, 8).join(', ')}, etc). Plain words only.
5. Everything in English.
6. If you quote a word or phrase inside a JSON string value, use single quotes 'like this' — never a raw double quote " (it ends the string and breaks the JSON).`}

${L ? '只输出下面格式的 JSON,不要任何其他文字:' : 'Output ONLY JSON in this exact shape, nothing else:'}
{"options":[{"title":"...","what_you_get":["..."],"what_you_dont_get":["..."],"effort_cost":"...","best_if":"..."}]}`;
}

function buildPrompt(idea, qa, option, lang) {
  const L = zh(lang);
  const qaText = qa.map((x, i) => `${i + 1}. Q: ${x.question} A: ${x.answer}`).join('\n');
  return `Build a small working demo web page for a non-technical user.

Their idea: "${idea}"
Their interview answers:
${qaText}
The roadmap option they chose: ${JSON.stringify(option)}

HARD REQUIREMENTS — every one is checked programmatically:
1. Print ONE complete HTML document directly as your reply, starting with <!DOCTYPE html> and ending with </html>. Do NOT describe the page, do NOT summarize what you built, do NOT save anything to a file — the document itself IS the entire reply. No markdown fences, no text before or after.
2. Single self-contained file: all CSS and JavaScript inline. ZERO external resources — no CDN links, no web fonts, no external images (use emoji/unicode/inline SVG instead), no network requests of any kind.
3. Must work fully offline when opened by double-click (file:// protocol). Persist user data with localStorage.
4. Pre-seed 2-3 realistic example entries so the page is never empty on first open. Every seeded record MUST include every field your code later reads (no missing name/date/count) so nothing is undefined.
5. Zero JavaScript console errors on load and on basic interaction. To guarantee this:
   a. Use an app-UNIQUE localStorage key that includes this app's name (e.g. "demofactory:<short-slug>:v1"), never a generic word like "data"/"items"/"notes" — so a different saved app can't collide with yours.
   b. After JSON.parse-ing saved data, VALIDATE and normalize it: if it isn't the shape you expect, fall back to your seed data; coerce every array with (Array.isArray(x) ? x : []); never call .length/.find/.map/.split/.replace/.toFixed on a value that could be undefined — guard it (e.g. (v ?? '') , item.name || '').
   c. NEVER call btoa() (or any base64 encoder) on a string containing non-ASCII characters (emoji, 中文, accented letters) — btoa accepts only Latin1 and throws InvalidCharacterError, which halts your whole script. To embed an inline SVG as an image use 'data:image/svg+xml;utf8,' + encodeURIComponent(svg), or just put the <svg> element directly in the DOM.
   d. Double-check the JavaScript is syntactically valid — balanced quotes and brackets, no stray characters. A single syntax error stops the entire script and leaves a dead page.
   e. Before using the result of document.getElementById / querySelector, make sure the element exists — a mistyped or not-yet-rendered id returns null, and calling .style or .addEventListener on null throws. Guard it with an if-check, or make sure that element is actually in your HTML.
6. Mobile-friendly (viewport meta, readable font sizes).
7. UI language: ${L ? 'Chinese (中文)' : 'English'}. Warm, clean design matching what the user asked for.
8. Implement the features promised in "what_you_get" of the chosen option — nothing more.
9. <title> must reflect the user's idea.
10. Any core feature the user asked to SEE (a running total, the list of entries, page navigation, today's item) must be rendered in the DEFAULT initially-visible view on first paint — not hidden behind an inactive tab, an accordion, or an unopened modal.
   If an entry has detail (a recipe's ingredients & steps, an item's description), at least the FIRST seeded example must show its full detail INLINE and expanded on load — a first-time visitor should read one complete example without clicking anything. A click-to-open popup as the ONLY way to see detail is not acceptable.
11. If the idea is about seeing what applies to TODAY (whose turn today, today's total, today's tasks), detect the current day with new Date() and explicitly label/highlight the row for today (e.g. a 今天/Today marker) — do not render only a static list where the user must find today themselves.
12. Every tappable/clickable control MUST be a real semantic element — a <button>, an <a>, or a native form control (<input>/<select>) — never a bare <div>/<span> with a click handler (keyboard and screen-reader users can't operate those). Use <button type="button"> for in-page actions.
13. If the user's core idea is to record / log / keep track of / capture something (a spending amount, a photo, a note, a check-in), the demo MUST include a WORKING affordance to add a NEW entry — a real <input>/<button>/<form> that creates and saves a record the user can then see — not just a read-only view of pre-seeded data. EXCEPTION: if the chosen option is explicitly hands-free/automatic (e.g. an "auto tracker"), a read-only view is correct — honor the chosen option. Build the tool the idea asks for, not a look-alike mockup of it.`;
}

// ---------- parsers / validators ----------

// Tolerates markdown fences and prose around a JSON object.
function extractJson(raw) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object found in engine output');
  return JSON.parse(candidate.slice(start, end + 1));
}

function validateInterview(questions, extraBanned = []) {
  const errors = [];
  if (!Array.isArray(questions)) return { ok: false, errors: ['questions is not an array'] };
  if (questions.length < 5 || questions.length > 8) errors.push(`question count ${questions.length} outside 5-8`);
  for (const [i, q] of questions.entries()) {
    if (!q || typeof q.question !== 'string' || !q.question.trim()) { errors.push(`q${i + 1}: missing text`); continue; }
    // ？ = full-width ? — kept as an escape so editors/tools can't silently mangle it to ASCII
    if (!/[?\uFF1F]\s*$/.test(q.question.trim())) errors.push(`q${i + 1}: does not end with a question mark`);
    if (!Array.isArray(q.choices) || q.choices.length < 2) errors.push(`q${i + 1}: needs >=2 choices`);
    const probe = q.question + ' ' + (q.choices || []).join(' ');
    for (const hit of findBannedTerms(probe, extraBanned)) errors.push(`q${i + 1}: banned term "${hit.term}"`);
  }
  return { ok: errors.length === 0, errors };
}

function validateOptions(options) {
  const errors = [];
  if (!Array.isArray(options)) return { ok: false, errors: ['options is not an array'] };
  if (options.length !== 3) errors.push(`option count ${options.length} !== 3`);
  for (const [i, o] of options.entries()) {
    for (const field of ['title', 'effort_cost', 'best_if']) {
      if (typeof o?.[field] !== 'string' || !o[field].trim()) errors.push(`option${i + 1}: missing ${field}`);
    }
    for (const field of ['what_you_get', 'what_you_dont_get']) {
      if (!Array.isArray(o?.[field]) || o[field].length === 0) errors.push(`option${i + 1}: missing ${field}`);
    }
  }
  if (errors.length === 0) {
    const diff = materiallyDifferent(options);
    if (!diff.ok) {
      for (const p of diff.pairs.filter((x) => !(x.similarity < SIMILARITY_THRESHOLD))) {
        errors.push(`options ${p.i + 1}&${p.j + 1} too similar (${p.similarity.toFixed(2)})`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

// Extracts the HTML document from engine output; validates single-file constraints.
function extractDemoHtml(raw) {
  const m = raw.match(/<!DOCTYPE html>[\s\S]*<\/html>/i);
  if (!m) throw new Error('no complete HTML document in engine output');
  return m[0];
}

function validateDemoHtml(html) {
  const errors = [];
  if (!/^<!DOCTYPE html>/i.test(html.trim())) errors.push('missing doctype');
  if (!/<html[\s>]/i.test(html) || !/<\/html>/i.test(html)) errors.push('missing <html> envelope');
  if (!/<title>[^<]+<\/title>/i.test(html)) errors.push('missing <title>');
  if (/<script[^>]+src\s*=/i.test(html)) errors.push('external <script src>');
  if (/<link[^>]+href\s*=\s*["'](?!data:)/i.test(html)) errors.push('external <link href>');
  if (/(?:src|href)\s*=\s*["']\/\//i.test(html)) errors.push('protocol-relative URL present');
  // w3.org namespace URIs (inline SVG xmlns) are identifiers, not network fetches
  const noComments = html.replace(/<!--[\s\S]*?-->/g, '').replace(/https?:\/\/www\.w3\.org\S*/gi, '');
  if (/\bhttps?:\/\//i.test(noComments)) errors.push('external http(s) URL present');
  // Parse-check inline scripts so a syntactically-broken demo is rejected at build time
  // (→ engine resamples) instead of shipping and only failing at the browser console gate.
  // new Function parses without executing. Demo scripts are plain top-level code; top-level
  // return/import/export/await would false-positive but demos don't use them.
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(m[1])) continue; // external src (checked on the opening TAG, not the body) already rejected above
    const body = m[2].trim();
    if (!body) continue;
    try {
      new Function(body); // eslint-disable-line no-new-func
    } catch (e) {
      errors.push(`inline <script> parse error: ${e.message}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  interviewPrompt, optionsPrompt, buildPrompt,
  extractJson, validateInterview, validateOptions,
  extractDemoHtml, validateDemoHtml,
};
