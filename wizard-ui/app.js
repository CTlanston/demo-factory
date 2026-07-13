'use strict';

// ---------- copy (zh default, en toggle) — zero jargon anywhere ----------
// "代码归你" wording on step 4 is contract-mandated ownership language.
const T = {
  zh: {
    idea_h1: '你想做个什么小东西?',
    idea_sub: '用一句话说说就行,不用想得太清楚。',
    idea_ph: '比如:我想记一下每天花了多少钱',
    idea_btn: '开始',
    load_interview: '正在为你准备几个小问题…',
    load_interview_sub: '大概要半分钟,别走开。',
    iv_h1: '几个小问题,帮你想清楚',
    iv_sub: '点一个选项,或者用自己的话写。',
    iv_free: '或者用自己的话说…',
    iv_btn: '看看有哪些做法',
    iv_missing: '还有没回答的问题,往上看看标红的那题?',
    load_options: '正在帮你琢磨几种做法…',
    load_options_sub: '很快,大概半分钟。',
    op_h1: '有 3 种做法,你挑一个',
    op_sub: '各有各的好,优缺点都写明白了,慢慢看。',
    op_get: '你会得到',
    op_miss: '你不会得到',
    op_cost: '费劲程度和花费',
    op_best: '最适合',
    op_pick: '点这里选它',
    op_picked: '✓ 就它了',
    op_btn: '就做这个',
    load_build: '正在为你搭建…',
    load_build_sub: '通常要一两分钟。做好的东西完全归你。',
    done_h1: '做好了!这是你的小工具',
    done_sub: '下面就是它,可以直接点着玩。',
    done_zip: '下载代码(归你)',
    done_note: '下载后双击 demo.html 就能打开。这份代码完全属于你——想改、想送人都行。',
    done_again: '再做一个',
    oops_h1: '刚才没成功',
    oops_btn: '再试一次',
    net_oops: '好像连不上了。检查一下网络,然后再试一次?',
    elapsed: (s) => `已经过去 ${s} 秒`,
  },
  en: {
    idea_h1: 'What little thing do you want to make?',
    idea_sub: 'One sentence is enough — it doesn\'t need to be figured out.',
    idea_ph: 'e.g. I want to keep track of what I spend every day',
    idea_btn: 'Start',
    load_interview: 'Preparing a few small questions for you…',
    load_interview_sub: 'About half a minute — hang on.',
    iv_h1: 'A few small questions to make it clear',
    iv_sub: 'Tap a choice, or say it in your own words.',
    iv_free: 'Or say it your own way…',
    iv_btn: 'Show me the ways to do it',
    iv_missing: 'One question above still needs an answer — it\'s marked in red.',
    load_options: 'Working out a few ways to do it…',
    load_options_sub: 'Quick — about half a minute.',
    op_h1: 'Three ways to do it — pick one',
    op_sub: 'Each has trade-offs, spelled out honestly. Take your time.',
    op_get: 'What you get',
    op_miss: 'What you don\'t get',
    op_cost: 'Effort & cost',
    op_best: 'Best if',
    op_pick: 'Tap to choose',
    op_picked: '✓ This one',
    op_btn: 'Build this one',
    load_build: 'Building it for you…',
    load_build_sub: 'Usually a minute or two. What comes out is fully yours.',
    done_h1: 'Done! Here\'s your little tool',
    done_sub: 'That\'s it below — go ahead and click around.',
    done_zip: 'Download the code (it\'s yours)',
    done_note: 'After downloading, double-click demo.html to open it. The code belongs to you — change it, gift it, anything.',
    done_again: 'Make another one',
    oops_h1: 'That didn\'t work',
    oops_btn: 'Try again',
    net_oops: 'Can\'t reach it right now. Check your connection and try again?',
    elapsed: (s) => `${s} seconds so far`,
  },
};

const S = {
  lang: localStorage.getItem('df_lang') || 'zh',
  id: localStorage.getItem('df_id') || null,
  step: 1,
  idea: '',
  serverIdea: null, // idea as the server session knows it — edits force a fresh session
  questions: [],
  answers: [],
  options: [],
  choice: null,
};
const t = (k) => T[S.lang][k];
const app = document.getElementById('app');
let timer = null;

function setDots() {
  document.querySelectorAll('.dot').forEach((d) => {
    const n = Number(d.dataset.step);
    d.className = 'dot' + (n === S.step ? ' on' : n < S.step ? ' done' : '');
  });
}

function el(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.firstElementChild;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function show(node, { wide = false } = {}) {
  clearInterval(timer);
  app.className = wide ? 'wide' : '';
  app.replaceChildren(node);
  setDots();
  window.scrollTo(0, 0);
}

function loading(msgKey, subKey) {
  const node = el(`<div class="center">
    <div class="pulse"></div>
    <h1>${esc(t(msgKey))}</h1>
    <p class="sub">${esc(t(subKey))}</p>
    <p class="elapsed"></p>
  </div>`);
  show(node);
  const started = Date.now();
  const label = node.querySelector('.elapsed');
  timer = setInterval(() => {
    label.textContent = T[S.lang].elapsed(Math.round((Date.now() - started) / 1000));
  }, 1000);
}

function oops(err, retryFn) {
  // API errors carry humane server copy; anything else (network down) gets plain-language fallback
  const msg = err && err.status ? err.message : t('net_oops');
  const node = el(`<div class="oops">
    <h2>${esc(t('oops_h1'))}</h2>
    <p>${esc(msg)}</p>
    <button class="btn"></button>
  </div>`);
  const btn = node.querySelector('.btn');
  btn.textContent = t('oops_btn');
  btn.onclick = retryFn;
  show(node);
}

async function api(path, body) {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'request failed');
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- steps ----------

function stepIdea() {
  S.step = 1;
  const node = el(`<div class="stack">
    <div><h1>${esc(t('idea_h1'))}</h1><p class="sub">${esc(t('idea_sub'))}</p></div>
    <textarea id="idea" placeholder="${esc(t('idea_ph'))}"></textarea>
    <div class="actions"><button class="btn">${esc(t('idea_btn'))}</button></div>
  </div>`);
  node.querySelector('textarea').value = S.idea;
  node.querySelector('.btn').onclick = async () => {
    const idea = node.querySelector('textarea').value.trim();
    if (!idea) return node.querySelector('textarea').focus();
    S.idea = idea;
    const go = async () => {
      loading('load_interview', 'load_interview_sub');
      try {
        if (!S.id || idea !== S.serverIdea) {
          const { id } = await api('/api/session', { idea, lang: S.lang });
          S.id = id;
          S.serverIdea = idea;
          localStorage.setItem('df_id', id);
        }
        const { questions } = await api('/api/interview', { id: S.id });
        S.questions = questions;
        stepInterview();
      } catch (e) {
        oops(e, go);
      }
    };
    go();
  };
  show(node);
}

function stepInterview() {
  S.step = 2;
  const node = el(`<div>
    <h1>${esc(t('iv_h1'))}</h1><p class="sub">${esc(t('iv_sub'))}</p>
    <div class="qs"></div>
    <div class="actions"><button class="btn">${esc(t('iv_btn'))}</button>
    <span class="sub warn" hidden>${esc(t('iv_missing'))}</span></div>
  </div>`);
  const qs = node.querySelector('.qs');
  const picked = new Array(S.questions.length).fill('');
  S.questions.forEach((q, i) => {
    const qEl = el(`<section class="q">
      <h3>${i + 1}. ${esc(q.question)}</h3>
      <div class="chips"></div>
      <input class="free" placeholder="${esc(t('iv_free'))}">
    </section>`);
    const chips = qEl.querySelector('.chips');
    (q.choices || []).forEach((c) => {
      const chip = el(`<button class="chip" type="button">${esc(c)}</button>`);
      chip.onclick = () => {
        chips.querySelectorAll('.chip').forEach((x) => x.classList.remove('on'));
        chip.classList.add('on');
        picked[i] = c;
        qEl.querySelector('.free').value = '';
        qEl.classList.remove('blank');
      };
      chips.appendChild(chip);
    });
    qEl.querySelector('.free').oninput = (e) => {
      picked[i] = e.target.value.trim();
      chips.querySelectorAll('.chip').forEach((x) => x.classList.remove('on'));
      if (picked[i]) qEl.classList.remove('blank');
    };
    qs.appendChild(qEl);
  });
  node.querySelector('.btn').onclick = () => {
    const firstBlank = picked.findIndex((a) => !a);
    if (firstBlank !== -1) {
      qs.children[firstBlank].classList.add('blank');
      node.querySelector('.warn').hidden = false;
      qs.children[firstBlank].scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    S.answers = picked.slice();
    const go = async () => {
      loading('load_options', 'load_options_sub');
      try {
        const { options } = await api('/api/options', { id: S.id, answers: S.answers });
        S.options = options;
        stepOptions();
      } catch (e) {
        oops(e, go);
      }
    };
    go();
  };
  show(node);
}

function stepOptions() {
  S.step = 3;
  const node = el(`<div>
    <h1>${esc(t('op_h1'))}</h1><p class="sub">${esc(t('op_sub'))}</p>
    <div class="options"></div>
    <div class="actions"><button class="btn" disabled>${esc(t('op_btn'))}</button></div>
  </div>`);
  const grid = node.querySelector('.options');
  const goBtn = node.querySelector('.btn');
  S.options.forEach((o, i) => {
    const card = el(`<article class="card">
      <h2>${esc(o.title)}</h2>
      <div><h4>${esc(t('op_get'))}</h4><ul class="get">${o.what_you_get.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div><h4>${esc(t('op_miss'))}</h4><ul class="miss">${o.what_you_dont_get.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div><h4>${esc(t('op_cost'))}</h4><p class="hint">${esc(o.effort_cost)}</p></div>
      <div><h4>${esc(t('op_best'))}</h4><p class="hint">${esc(o.best_if)}</p></div>
      <div class="pick">${esc(t('op_pick'))}</div>
    </article>`);
    card.onclick = () => {
      grid.querySelectorAll('.card').forEach((c) => {
        c.classList.remove('on');
        c.querySelector('.pick').textContent = t('op_pick');
      });
      card.classList.add('on');
      card.querySelector('.pick').textContent = t('op_picked');
      S.choice = i;
      goBtn.disabled = false;
    };
    grid.appendChild(card);
  });
  goBtn.onclick = () => {
    const go = async () => {
      loading('load_build', 'load_build_sub');
      try {
        await api('/api/build', { id: S.id, choice: S.choice });
        stepDone();
      } catch (e) {
        oops(e, go);
      }
    };
    go();
  };
  show(node, { wide: true });
}

function stepDone() {
  S.step = 4;
  // preview iframe is unsandboxed on purpose: the demo needs localStorage, and this
  // is a local single-user app serving the user's own generated page
  const node = el(`<div>
    <h1>${esc(t('done_h1'))}</h1><p class="sub">${esc(t('done_sub'))}</p>
    <iframe class="preview" src="/demo/${esc(S.id)}" title="demo"></iframe>
    <p class="own-note">${esc(t('done_note'))}</p>
    <div class="actions">
      <a class="btn" href="/api/zip/${esc(S.id)}" download>${esc(t('done_zip'))}</a>
      <button class="btn-quiet">${esc(t('done_again'))}</button>
    </div>
  </div>`);
  node.querySelector('.btn-quiet').onclick = () => {
    localStorage.removeItem('df_id');
    S.id = null; S.idea = ''; S.questions = []; S.answers = []; S.options = []; S.choice = null;
    stepIdea();
  };
  show(node);
}

// ---------- boot: resume from session file if one exists ----------

document.getElementById('langToggle').textContent = S.lang === 'zh' ? 'EN' : '中文';
document.getElementById('langToggle').onclick = () => {
  S.lang = S.lang === 'zh' ? 'en' : 'zh';
  localStorage.setItem('df_lang', S.lang);
  location.reload();
};

(async function boot() {
  if (S.id) {
    try {
      const s = await api(`/api/session/${S.id}`);
      S.idea = s.idea;
      S.serverIdea = s.idea;
      // chrome copy follows the user's toggle (S.lang); session content keeps its own language
      if (s.has_demo) { S.step = 4; return stepDone(); }
      if (s.options) { S.questions = s.questions; S.answers = s.answers; S.options = s.options; return stepOptions(); }
      if (s.questions) { S.questions = s.questions; return stepInterview(); }
    } catch {
      localStorage.removeItem('df_id');
      S.id = null;
    }
  }
  stepIdea();
})();
