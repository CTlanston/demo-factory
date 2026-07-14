# EVIDENCE LEDGER — demo-factory

Append-only. Every "done" claim links to a fresh run artifact below.

---

## Iteration 1 — 2026-07-09 — scaffold + persona harness + engine verify

**Environment (fresh run):**
- `claude --version` → `2.1.150 (Claude Code)` at `~/Library/pnpm/nodejs/20.20.2/bin/claude`
- `node --version` → v20.20.2, npm 10.8.2

**Engine verification (fresh run):**
- Command: `claude -p "Reply with exactly: ENGINE_OK" --model claude-haiku-4-5-20251001`
- Output: `ENGINE_OK` ✅ (headless `-p` mode works; haiku available as cheap bulk model)

**Fixture validation (fresh run, `node -e` structural check):**
- personas: 20, unique ids: 20
- domains: 记账/相册/报名接龙/菜谱/健身打卡/小店价目表/班级通知/宠物记录/读书笔记/生日提醒 — 2 each
- all personas have ≥8 canned_answers, ≥2 must_have_features probes, banned[] present → `FIXTURES_VALID`
- post-review re-check: 0 comma-joined selectors; reviewer-flagged weak tokens (天/本/新) removed

**Review (independent subagent, no self-review):**
- Verdict: APPROVE. 0 blockers/majors. Minors fixed in a145de8 (weak probe tokens, selector normalization, probe-text contract now includes placeholder/aria-label/value/title). Deferred: none. YAGNI: clean (zero deps). PII in diff: none found by reviewer.

**Merge:** dd93702 on main.

**Cost ledger:** 1 engine call (haiku, trivial prompt) — verification only, cost negligible; per-run cost logging starts when `engine/` wrapper lands (iter 3).

---

## Iteration 2 — 2026-07-09 — compiler module + G1 gate

**G1 unit gate (fresh run on main @ 567133d):** `npm test` → `# tests 24 / # pass 24 / # fail 0` ✅
- Covers: banned-term checker (zh substring, en word-boundary, plurals, no false positives, persona extras), option-diff (materially-different pass @ sims ≤0.07, rephrasing fail @ 0.86, threshold 0.55), 3 prompt templates encode spec constraints, extractJson fence tolerance, validateInterview (5/8 boundary pass, 4/9 fail, jargon, non-questions), validateOptions (count/fields/near-dupes), validateDemoHtml (external script/link/img, protocol-relative, data: href allowed, SVG xmlns allowed), fixtures sanity.

**Review (independent subagent):** first pass REQUEST_CHANGES — 1 major (plural en jargon escaped: "databases/APIs/servers" → 0 hits) + 3 minors. Fixed in 98c7213. Second independent re-review: APPROVE, all fixes verified empirically (plurals → 3 hits, no substring false positives, threshold constant used, URL checks correct). YAGNI: clean, still zero npm deps.

**Deferred (reviewer-noted, tracked for G3 failure analysis):** semantic duplicates with different surface wording can pass bigram Jaccard; mixed zh/en option sets score ~0 similarity. Watch in G3 failure classes.

**Merge:** 567133d on main.

**Cost ledger:** 0 engine calls this iteration.

---

## Iteration 3 — 2026-07-09 — engine wrapper

**Unit tests (fresh run on iter3-engine @ 6e24cb3, verified again on main after merge):** `npm test` → `# tests 32 / # pass 32 / # fail 0` ✅
- New coverage: success envelope parse, stdin transport (ECHO length), timeout kill + retry (2 ledger rows), transient-fail→retry-recovers, bad JSON, literal `null` JSON, is_error envelope, missing binary, 360KB multibyte output with zero U+FFFD.

**Real engine smoke (fresh run through wrapper):** `runEngine('Reply with exactly: WRAPPER_OK', {purpose:'iter3-smoke'})` → `{ok:true, text:"WRAPPER_OK", costUsd:0.0110635, durationMs:13862}` — first row in `metrics/cost_ledger.jsonl`.

**Review (independent subagent):** first pass REQUEST_CHANGES — 1 BLOCKER (per-chunk Buffer.toString() corrupts multibyte chars split across ~64KB pipe boundaries; reviewer reproduced U+FFFD on 300KB zh payload) + 1 MINOR (literal `null` JSON envelope → uncaughtException) + 3 NITs. Fixed in 6e24cb3 (setEncoding('utf8'), null guard, `??` for timeoutMs, 2 regression tests; fixing also exposed fake-CLI pipe-truncation bug — exit moved into write callback). Re-review: APPROVE — reviewer re-ran independent probes (270000 chars exact, zero U+FFFD; null → failure-not-crash). Declined by design: cache-token ledger columns (cost_usd authoritative), SIGKILL process-group (watch in G3).

**YAGNI:** clean — zero new deps, no forbidden infra.

**Merge:** `merge iter3` on main.

**Cost ledger:** 2 real engine calls this iteration (iter3-smoke $0.0110635 logged in ledger; reviewer's independent smoke logged to scratchpad ledger, ~$0.011). Running total in-repo ledger: $0.0111.

---

## Iteration 4 — 2026-07-09 — wizard UI + server

**Unit/integration tests (fresh run on main after merge):** `npm test` → `# tests 38 / # pass 38 / # fail 0` ✅
- New coverage: zip byte layout (CRCs, central dir, EOCD), full 4-step HTTP flow against fake engine (labeled unit/CI-only), 400/404/502 paths, non-object JSON body 400, raw-socket path traversal, static serving, engine-failure → humane zh 502 with retry copy.

**Browser walkthrough (fresh, fake engine, real Chromium):** all 4 steps driven in the Browser pane — idea → 6 zh questions → 3 option cards → build → iframe preview + zip link; zero console errors/warnings; EN toggle verified (h1/placeholder/toggle switch to English). Fake-engine runs write to a /tmp ledger — `metrics/cost_ledger.jsonl` keeps only real rows (fake pollution found during walkthrough was removed and the script isolated).

**Review (independent subagent):** APPROVE with 3 MINORs + 4 NITs, 0 blockers. Reviewer empirically verified: 38/38 tests; full curl flow on fake-engine server; `unzip -t` + Python zipfile strict parse + macOS ditto extract (zh filename ok); attack pass on traversal/encodings/UUID ids all rejected; XSS audit — every engine/user text interpolation goes through esc(); YAGNI clean (no deps field at all); PII zero hits; banned-term scan of UI copy clean except contract-mandated step-4 代码归你 wording. MINORs fixed post-approval in 86491a4: non-object JSON body → 400 (+tests), stale-idea edit now re-creates session, lang toggle no longer overridden by session lang, network-failure gets plain-language copy, esc(S.id), iframe-sandbox rationale comment. Declined (NITs): unreachable-413 copy, same-tmp concurrent session writes (unreachable from sequential UI; noted for G3).

**YAGNI:** package.json has no dependencies/devDependencies field; server is node:http only; zip writer hand-rolled store-only (~60 lines); no DB/queue/auth/Docker/second service.

**Merge:** `merge iter4` on main.

**Cost ledger:** 0 real engine calls this iteration (browser walkthrough + tests used the labeled fake).

---

## Iteration 5 — 2026-07-09/10 — E2E persona runner + G2 gate GREEN

**G2 gate (fresh real-engine runs, haiku, all 4 wizard steps over HTTP against the spawned real server):**
- Run 1: 0/2 — failure class A: mojibake — question-mark validator regex was literally `[??]` (two ASCII `?`; the intended full-width `？` U+FF1F had been silently mangled), so ALL zh interviews failed. G1 had passed because the test file was mangled identically. Fixed with explicit `？` escapes + byte-verified regression test. Failure class B: cw2 demo probes — good demo, case-sensitive tokens (`walk` vs `Walk`); probes now case-insensitive.
- Run 2: 1/2 — failure class C: `claude -p` acted as an *agent* and returned a prose description of the demo instead of the document (raw output captured by new session.invalid persistence). Fixed: `--tools ''` → pure text boundary; build prompt hardened. Real smoke: `TOOLS_OFF_OK` 7.0s.
- Run 3: 1/2 — failure class D: fixture false-negative — jz1 demo was fully functional (monthly total, per-category stats, entries list) but none of 5 narrow tokens appeared in probe text (`记录` only in `<title>`). Probe-text contract now includes document.title; jz1 tokens broadened with zh synonyms (`账` later dropped as near-tautological per review).
- **Run 4 (gate): 2/2 PASS — jz1 177s $0.1439, cw2 164s $0.1550.** Per-run rows (incl. all failures, unretouched) in metrics/e2e_results.json.

**Unit tests:** 40/40 (new: ？ regression, wizard-badiv raw-persistence, non-object body).

**Review (independent subagent, adversarial):** REQUEST_CHANGES — 1 BLOCKER *demonstrated by reviewer*: runner readiness accepted any HTTP responder on the port → false `engine:"real"` PASS against a stale stub server; also orphaned server on puppeteer-launch failure. Fixed in 9783cec: readiness = our child's post-listen startup line + exitCode liveness check; unified try/finally lifecycle; SIGINT/SIGTERM kill. Re-review APPROVE: reviewer re-ran impostor (hard fail, no row), orphan (port freed), SIGINT mid-run (exit 130, no orphan), stub run (PASS, metrics byte-identical via shasum), 40/40. Reviewer YAGNI position: puppeteer-core devDependency justified (contract requires headless-Chromium render + selector probes; hand-rolled CDP would be forbidden custom infra); product keeps ZERO runtime deps (no dependencies field).

**Gate-integrity audit (reviewer):** all 5 criteria init false, early abort leaves criteria false, pass = every(Boolean); could not construct a false PASS post-fix.

**Merge:** `merge iter5` on main.

**Cost ledger:** 25 real engine rows total, cumulative **$1.06** (G2 runs ×4 incl. failed generations, 2 smokes, 1 debug interview; reviewer smokes went to scratchpad ledgers). Per-run costs in e2e_results.json.

---

## Iteration 6 — 2026-07-10 → 2026-07-13 — G3 E2E@scale: 98/100 GREEN

**Gate:** 20 personas × 5 seeds = 100 REAL runs through the running app (HTTP, no mocks, real engine) — **98 pass / 2 fail / 0 infra ≥ 95** ✅. Definitive rows in `metrics/e2e_g3_rerun.json` (101 rows; pre-declared rule: latest row per persona×seed; sole duplicate ds1:0 PASS in both).

**The path (all runs real, all failures adjudicated against on-disk artifacts before any fix):**
| Run | Score | What it taught |
|---|---|---|
| haiku #1 | 75/100 | 25-failure fan-out analysis → 5 zh ASCII-quote JSON breaks, 5 localStorage cross-run crashes, hidden-in-tab features, options floor |
| re-run | collapsed | harness bug (shared Chromium died; cascade) → self-healing pool, two-tier infra classification, exit-2 guard (green gate impossible with exclusions) |
| haiku #2 (parallel) | 89/100 | 11-failure fan-out → build-time JS parse gate, btoa/unicode + semantic-button + capture-affordance prompt rules; 4 genuine product gaps KEPT as failures |
| haiku #3 | 94/100 | haiku ceiling: static mockups, photo-count-instead-of-photos — capability, not probes |
| sonnet #1 | 92/100 | sonnet fixed the mockup gaps but exposed fixture flaw: hands-free options (photo/auto-sync) have no manual `<input>` — 7 capture fixtures assumed one |
| haiku #4 (fixed fixtures) | 90/100 | confirms haiku capability floor (e.g. jz2 s2: zero interactive elements) |
| **sonnet definitive** | **98/100** | 81 rows (run killed by session teardown) + 20 completion rows for the missing tail personas at the SAME commit (3724796); both batches post-date the commit |

**Residual failures (kept, honest):** bl2 s4 — 统计结果 probe: all 3 stats tokens genuinely absent from the demo. ds2 s2 — engine emitted external `google.com/search` URLs on both draws; single-file validator correctly 502'd (no demo shipped).

**Final review (independent, merge-blocking):** REQUEST_CHANGES → this EVIDENCE entry (only blocker) → APPROVE expected on existence. Verdict quote: "the gate was not bent — every skeptical re-scoring keeps it at ≥95". Reviewer independently: recomputed 98/100; cross-checked **all 101** sessions against ledger rows (every build sonnet, every interview/options haiku); verified stitching honesty (completion = exactly the killed run's missing tail; fresh FAIL kept); verified rejected-as-gaming tokens still absent; skeptical re-scorings: no-button-broadening → 96, harshest duration → 97, both → 95 (still green). Prior in-iteration reviews: iter6 fixes APPROVE ×2, fixture option-shape APPROVE.

**Fixture evolution (integrity-reviewed):** ACCEPTED (feature verified present in real artifacts): capture selectors [input]→[input,button] on 7 features (hands-free options' capture affordance; text_any co-gates), tokens ¥/明细/排行/花费/receipts/❮❯/📌/⭐☆, document.title in probe text, case-insensitive matching. REJECTED as gaming (kept failing honestly): 菜谱 (cp1), bare 新 (bj1), weekday tokens (bj2), 已读 (ds2), display-selector broadens for read-only demos.

**Duration (criterion 5, ≤10 min):** gated at concurrency 1; recorded (`wall_clock_ok`) under concurrency (contention ≠ single-user latency; 4 of 5 over-600s rows were laptop-sleep artifacts — one ledger row shows a 4.1h suspension gap). Fresh concurrency-1 certification with final config (sonnet build): jz1 170s / cw2 321s / cp1 189s — 3/3 PASS, gated.

**Model policy:** interview/options = haiku (cheap, contract "cheap for bulk"); build = claude-sonnet-5 (`DEMO_FACTORY_BUILD_MODEL`) — the demo is the deliverable wow artifact; haiku plateaued at 90-94 with genuine capability gaps. Contract-compatible (permissive clause); per-call model+cost in ledger, per-run in results rows.

**Unit tests:** 43/43 (incl. parse-gate, resample-recovery, U+FF1F regression, impostor-server, zip byte-layout).

**Cost:** definitive G3 set $45.88 (sonnet build avg ~$0.42/run). Cumulative ledger (all iterations, all G3 attempts, smokes, debug): **$169.91** across 2763 engine calls (haiku $95.34, sonnet $74.57).

**Merge:** iter6-g3 → main (this commit).

---

## Iteration 7 — 2026-07-13 — G4 showcase (5/5) + G5 feedback kit

**G4 gate:** 5 showcase personas (jz1 记账 / cw2 宠物-en / cp1 菜谱 / xd1 价目表 / sr2 生日-en) run END-TO-END through the real app, sequential (duration GATED at concurrency 1): **5/5 PASS**, 227-391s, $0.48-0.63/run. Rows: `metrics/g4_showcase.json`; artifacts: `examples/<persona>/demo.html` — byte-identical to the session files (reviewer-verified 5/5 BYTE-MATCH; sessions/ is gitignored, so the byte-match evidence is local-only by design).

**Model-policy deviation (disclosed):** contract §3 G4 says showcase runs use the "full model". First attempt ran ALL steps on claude-sonnet-5: 3/5 — sonnet builds tripped the engine's 150s default timeout on 3 sessions (6 timeout rows in the ledger, 02:40-03:10Z window) and sonnet's more-templated options tripped the similarity floor once (all draws ≥0.58). Shipped showcase instead uses the SHIPPING config — haiku interview/options + **claude-sonnet-5 builds** — on the reading that (a) the marketing artifact (demo.html) IS full-model output, and (b) showcasing the exact config users get is more honest marketing than an all-sonnet pipeline nobody ships. The failed all-sonnet attempt is preserved in the ledger, not hidden. Reviewer position: "honest and contract-defensible — conditional on explicit disclosure" (this paragraph).

**Wow-bar verification (independent reviewer, all 5 rendered):** zero console/page errors on all 5; real typographic hierarchy, warm cohesive palettes, seeded data relative to today (今天 badge, "Today 🎉"); interaction-tested demo 01 (photo→recognize→save→total updates→localStorage persists) and demo 05 (add friend→persists under namespaced key). "Not static mockups; KICKOFF spirit met."

**G5:** `FEEDBACK.md` — recruit criteria (10 novices, zero coding/AI-tool experience, ≥6 zh-first), hands-off session script (one sentence, then silence), per-novice observation sheet, three post-questions, signal thresholds (unaided-to-demo ≥3/10 = kill criterion; option comprehension ≥5/10; would-show-with-named-person ≥3/10), results + verdict table. Kill criterion will be carried verbatim into README at release (G6).

**Review (independent):** REQUEST_CHANGES — 1 BLOCKER (this EVIDENCE entry), 1 MAJOR (FEEDBACK referenced a README that doesn't exist yet — reworded), 3 MINOR (call-count precision in examples 02/05 — fixed from ledger: 5 and 4 calls incl. options retries; model-note in examples/README — added; inline start command in FEEDBACK — added). NIT accepted-as-is: demo 05's "friends's" grammar stays — examples are shipped UNEDITED by policy (authenticity over polish). Reviewer verified empirically: sequential timing legit (ts arithmetic), ledger reconciles to the cent, zero external URLs in all 5 demos, PII zero hits, 43/43 tests, zero code changes in the diff.

**Cost:** showcase final 5 runs $2.64; incl. the disclosed all-sonnet failed attempt ~$5.4 total for G4 (the 6 timeout rows carry no logged cost, so true spend is ≥$5.39).

**Merge:** iter7-g4g5 → main (this commit).

---

## Iteration 8 — 2026-07-13 — G6 release materials + scrub (public push PENDING USER CONFIRMATION)

**Materials:** README.md (who-for / wedge / kill criterion character-identical to FEEDBACK.md / receipts / cost note), QUICKSTART.md (no-install `npm start`, real env vars, verified port), LICENSE (MIT, "Lanston" — deliberate public attribution), .github/workflows/ci.yml (G1 unit matrix node 20+22 + stubbed-engine E2E smoke; stub labeled in header AND both job names per contract §5 "stub ONLY in CI").

**§5 GIF deviation (disclosed):** no GIF in v0.1.0 (no ffmpeg on the build machine). Substituted with 4 README-embedded screenshots (docs/walkthrough/) captured by replaying the REAL jz1 G4 session (5585bafd) through the real UI at its four stages — content unedited, engine not re-invoked. Reviewer position: "acceptable only as a disclosed substitution" — this entry + BACKLOG entry are that disclosure. GIF remains in BACKLOG for post-v0.1.0.

**Scrub (§0.8, fresh runs):** gitleaks 8.30.1 over the tracked tree and over the `git archive` export → **no leaks**. Tracked-file greps: `/Users/` 0, `@gmail` 0, `ctlanston` 0, hostname 0; case-insensitive `lanston` → LICENSE copyright line only (deliberate). metrics/ + examples/: zero absolute paths, zero external URLs. PROMPT_FABLE5.md + KICKOFF.md untracked (internal docs stay local).

**History plan (reviewer-endorsed):** private history contains the internal contract doc, so the PUBLIC repo will be created from a clean squash export (fresh history starting at v0.1.0); the private repo keeps full history locally. Known acceptable caveat: EVIDENCE.md cites private-history hashes that won't resolve publicly.

**CI verification (empirical, by reviewer):** `npm ci --dry-run` lockfile in sync; the exact e2e job command run locally with the stub → PASS exit 0; CHROME_PATH=/usr/bin/google-chrome correct for ubuntu-latest; fake CLI is 100755 with shebang in-tree; unit tests hermetic; no secrets, real engine unreachable in CI. Local: 43/43 tests + CI-replica stubbed smoke 1/1 PASS.

**README honesty pass (reviewer-forced corrections):** cost range widened to $0.4-0.7 (G3 shipping-config median $0.44, max $1.02 with retries — stated), duration 3-7 min (G4 max 391s).

**Review:** REQUEST_CHANGES (B1 this entry; M1 GIF disclosure; m2 ranges; m3 checklist; n4 wording) → all addressed → re-review pending.

**POST-CONFIRMATION CHECKLIST (blocked on user):** ① user confirms repo name / LICENSE attribution / squash-export plan → ② `gh repo create` public from clean export → ③ fill `<repo-url>` in QUICKSTART + add Actions badge to README → ④ push → ⑤ Actions green → ⑥ tag v0.1.0 → ⑦ handoff RELEASED.

**Cost:** this iteration $0 engine spend (screenshots replay a saved session; smoke used the stub).

---

## RELEASED — 2026-07-13 — v0.1.0 public

- User confirmed release + "Lanston" attribution (AskUserQuestion, 2026-07-13).
- Public repo: https://github.com/CTlanston/demo-factory (clean squash export; fresh history; internal contract docs absent — verified; final gitleaks on export: no leaks).
- Actions run 29272016871: 3/3 jobs green — test(20) 10s, test(22) 7s, e2e-smoke-stubbed 15s with real log line `[1/1] PASS jz1 seed=0` (engine stubbed in CI by design, labeled).
- Tag + Release: https://github.com/CTlanston/demo-factory/releases/tag/v0.1.0
- DONE DEFINITION (§6): all boxes checked. Next milestone is NOT code: run FEEDBACK.md's 10-novice test. Kill criterion is live.

---

## Iteration 9 — 2026-07-13 — v0.2.0 hardening (production gaps, each verified)

**Scope (user-selected: "本地产品硬化 v0.2", within contract YAGNI):**
- **Security:** server binds 127.0.0.1 by default (was 0.0.0.0 — wizard + sessions were LAN-reachable). `DEMO_FACTORY_HOST` is a deliberate opt-out. Verified: unit test (loopback accepts, LAN interface refuses) + reviewer's independent curl probes (LAN refused; opt-out works).
- **Windows:** engine spawns `claude` via a self-built quoted command line on win32 (array-args + shell:true silently DROPS the empty `--tools ""` — reviewer-demonstrated; the fix passes the exact quoted line through a real shell in a regression test using an argv-probe). Model name validated `^[A-Za-z0-9._-]+$` before entering the shell line (closes env-injection). `.js` engine stubs run via node on all platforms; no process groups on win32. Explicit test-file list (cmd.exe doesn't glob).
- **sessions GC:** keep newest 200 + delete `.json.tmp` crash leftovers older than 1h (unit-tested; non-session files untouched; runs only in startServer).
- **npx:** `bin/demo-factory.js` + files whitelist → `npx github:CTlanston/demo-factory`. Verified: bin boots + HTTP 200; reviewer re-verified from the packed tarball (personas/ absent, boots).
- **Humane boot:** EADDRINUSE → plain-language message + PORT suggestion, no stack (tested); missing `claude` CLI → QUICKSTART pointer; graceful SIGINT with sessions-are-safe message.

**Verification:** 48/48 unit tests (5 new). Real engine (POSIX path unchanged): SPAWN_V2_OK 4.4s + B1_FIX_OK 6.6s smokes + full real E2E cw2 PASS ($0.62, ledger-reconciled by reviewer). Stub e2e PASS. Review: REQUEST_CHANGES (B1 win32 arg-drop — real bug caught before any Windows user hit it; B2 CI-red assertion; M1 overbroad claim) → all fixed → **APPROVE**.

**v0.2.0 TAG GATE:** tag only after public Actions run is green INCLUDING both Windows legs (unit matrix + stubbed e2e).
**Disclosures:** (a) Windows verification is CI-with-stubbed-engine; the real `claude.cmd` path is NOT verified on a physical Windows machine (QUICKSTART says so; issues welcome). (b) win32 timeout kills the cmd.exe shell; a child under it may be orphaned (accepted: no process groups on win32; timeout path only). (c) self-set `DEMO_FACTORY_CLAUDE` containing `"` or `%VAR%` enters the win32 line raw (same self-set-env class as m2, accepted).

**Cost:** 3 real engine calls (~$0.64). **Merge:** iter9-hardening → main (this commit).
