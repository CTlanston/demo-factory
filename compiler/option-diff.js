'use strict';

// Deterministic "materially different" check: character-bigram Jaccard
// similarity over each option's full text. Cheap-and-free stand-in for
// embedding distance; threshold tuned on fixtures (see tests).
const SIMILARITY_THRESHOLD = 0.55;

function bigrams(text) {
  const clean = text.toLowerCase().replace(/[\s\p{P}]+/gu, '');
  const set = new Set();
  for (let i = 0; i < clean.length - 1; i++) set.add(clean.slice(i, i + 2));
  return set;
}

function similarity(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

function optionText(opt) {
  return [
    opt.title,
    ...(opt.what_you_get || []),
    ...(opt.what_you_dont_get || []),
    opt.best_if || '',
  ].join(' ');
}

// Returns {ok, pairs: [{i, j, similarity}]} — ok=false if any pair too similar.
function materiallyDifferent(options, threshold = SIMILARITY_THRESHOLD) {
  const pairs = [];
  for (let i = 0; i < options.length; i++) {
    for (let j = i + 1; j < options.length; j++) {
      pairs.push({ i, j, similarity: similarity(optionText(options[i]), optionText(options[j])) });
    }
  }
  return { ok: pairs.every((p) => p.similarity < threshold), pairs };
}

module.exports = { similarity, materiallyDifferent, SIMILARITY_THRESHOLD };
