# BACKLOG — deliberately NOT in v1 (YAGNI tripwire)

Anything below was considered and rejected for v1. Do not implement without a new decision.

- Docker / containerization — v1 is `npm start`, nothing more
- Any database — sessions are single JSON files under `sessions/`
- Queues / job runners — engine calls are synchronous with timeout+retry
- Auth / accounts / multi-tenant — single local user, no login
- Second web service / microservices — exactly one Node process
- Custom build engine / orchestration platform — we ride `claude -p`, period
- Multi-file demo output / build pipelines — demo is ONE self-contained html file
- Deployment / hosting of generated demos — user downloads the zip, that's delivery
- Streaming progress UI for engine calls — a spinner + timeout is enough for v1
- Persona harness UI dashboard — `metrics/e2e_results.json` + CLI output is enough

- **Option-aware capture probes** (from G3 final review): must_have_features are option-blind — a hands-free option (auto-tracker/sync) legitimately negates a manual-entry probe (jz2 s2 class). Fixtures could carry per-option-shape expectations; capture probes are currently text-effectively-only since `button` is near-universal. Deferred: v1 gate is green without it; revisit if novice feedback surfaces option-mismatch confusion.

- **README GIF walkthrough**(contract §5, post-v0.1.0):v0.1.0 以 4 张真实流程截图替代(docs/walkthrough/,内容来自未经修改的真实 G4 session,评审确认为 disclosed substitution)。后续用 ffmpeg/录屏做成 GIF 或短视频。
