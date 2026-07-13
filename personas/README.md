# Persona harness

The harness defines the product: if a run passes here, a real novice could have done it.

- `fixtures.json` — 20 personas (10 domains × 2), each `{one_line_idea, canned_answers, expectations}`. See `_contract` inside the file.
- `runner.js` (iter 4) — drives the REAL wizard over HTTP against the running app through all 4 steps, including the REAL `claude -p` engine call. No UI mocks.

## Per-run pass criteria (all programmatic)

1. **Interview**: 5–8 questions; zero banned-term hits (global list + persona `banned`); each question parses as a question.
2. **Options**: exactly 3; pairwise similarity below threshold (materially different).
3. **Demo**: `demo.html` exists, single file, valid HTML, renders in headless Chromium with zero console errors, and passes every persona `must_have_features` DOM probe.
4. **Export**: zip complete and self-contained (demo.html + README_你的代码.md).
5. **Wall-clock** ≤ 10 min/run including engine.

Results append to `metrics/e2e_results.json` (one row per run: persona, seed, model, cost, per-criterion pass/fail, duration).
