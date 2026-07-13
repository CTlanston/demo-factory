'use strict';

// Terms a complete novice should never see in the wizard.
const BANNED_TERMS = [
  // en (matched on ASCII word boundaries, case-insensitive)
  'api', 'backend', 'frontend', 'database', 'sql', 'server', 'deploy',
  'deployment', 'framework', 'hosting', 'html', 'css', 'javascript',
  'json', 'app store', 'source code', 'repository', 'algorithm', 'cloud',
  // zh (substring match)
  '数据库', '后端', '前端', '服务器', '部署', '框架', '接口', '代码',
  '云端', '云服务', '域名', '算法', '编程', '程序员', '脚本',
];

function isCjk(term) {
  return /[一-鿿]/.test(term);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Returns array of {term, index} hits found in text.
function findBannedTerms(text, extraTerms = []) {
  const hits = [];
  const terms = [...BANNED_TERMS, ...extraTerms];
  for (const term of terms) {
    if (isCjk(term)) {
      const idx = text.indexOf(term);
      if (idx !== -1) hits.push({ term, index: idx });
    } else {
      // (?:e?s)? catches common plurals: APIs, databases, frameworks
      const re = new RegExp(`(?<![a-z0-9])${escapeRegex(term)}(?:e?s)?(?![a-z0-9])`, 'i');
      const m = re.exec(text);
      if (m) hits.push({ term, index: m.index });
    }
  }
  return hits;
}

module.exports = { BANNED_TERMS, findBannedTerms };
