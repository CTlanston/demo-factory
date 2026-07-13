'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULT_MODEL = process.env.DEMO_FACTORY_MODEL || 'claude-haiku-4-5-20251001';
// A healthy haiku demo build finishes in ~60-90s; 150s is generous headroom. Kept short
// on purpose — a longer ceiling just lets a wedged CLI call stack up (a 240s ceiling once
// produced a 23-min run in G3 and orphaned children).
const DEFAULT_TIMEOUT_MS = Number(process.env.DEMO_FACTORY_TIMEOUT_MS) || 150 * 1000;
const DEFAULT_LEDGER = process.env.DEMO_FACTORY_LEDGER || path.join(__dirname, '..', 'metrics', 'cost_ledger.jsonl');

// One claude -p call. Prompt goes over stdin (long prompts), result comes back
// as the CLI's --output-format json envelope.
function runOnce(prompt, { model, timeoutMs, claudePath }) {
  return new Promise((resolve) => {
    const started = Date.now();
    // --tools "" = pure text generation: without it claude -p acts as an agent and may
    // *describe* the demo (or write files) instead of printing the document (seen in G2)
    // detached → the child leads its own process group; on timeout we SIGKILL the whole
    // group (-pid) so the CLI's own children are reaped, not orphaned
    const child = spawn(claudePath, ['-p', '--output-format', 'json', '--model', model, '--tools', ''], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    // decode as utf8 streams — per-chunk Buffer.toString() corrupts multibyte
    // characters split across the ~64KB pipe boundary (zh demo output hits this)
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
    }, timeoutMs);

    const done = (out) => {
      clearTimeout(timer);
      resolve({ durationMs: Date.now() - started, ...out });
    };

    child.on('error', (err) => done({ ok: false, error: `spawn failed: ${err.message}` }));
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => {
      if (timedOut) return done({ ok: false, error: `engine timed out after ${timeoutMs}ms` });
      if (code !== 0) return done({ ok: false, error: `engine exited ${code}: ${stderr.slice(0, 500)}` });
      let envelope;
      try {
        envelope = JSON.parse(stdout);
      } catch {
        return done({ ok: false, error: `engine output not JSON: ${stdout.slice(0, 200)}` });
      }
      if (!envelope || typeof envelope !== 'object' || envelope.is_error || typeof envelope.result !== 'string') {
        return done({ ok: false, error: `engine error result: ${String(envelope?.result).slice(0, 500)}` });
      }
      done({
        ok: true,
        text: envelope.result,
        costUsd: envelope.total_cost_usd ?? null,
        inputTokens: envelope.usage?.input_tokens ?? null,
        outputTokens: envelope.usage?.output_tokens ?? null,
      });
    });

    child.stdin.on('error', () => {}); // child died before reading stdin; close() reports it
    child.stdin.end(prompt);
  });
}

function appendLedger(ledgerPath, row) {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.appendFileSync(ledgerPath, JSON.stringify(row) + '\n');
}

// Public API: one retry on failure, every attempt logged to the cost ledger.
async function runEngine(prompt, opts = {}) {
  const model = opts.model || DEFAULT_MODEL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const claudePath = opts.claudePath || 'claude';
  const ledgerPath = opts.ledgerPath || DEFAULT_LEDGER;
  const purpose = opts.purpose || 'unspecified';

  let last;
  for (let attempt = 1; attempt <= 2; attempt++) {
    last = await runOnce(prompt, { model, timeoutMs, claudePath });
    appendLedger(ledgerPath, {
      ts: new Date().toISOString(),
      purpose,
      model,
      attempt,
      ok: last.ok,
      duration_ms: last.durationMs,
      cost_usd: last.ok ? last.costUsd : null,
      input_tokens: last.ok ? last.inputTokens : null,
      output_tokens: last.ok ? last.outputTokens : null,
      error: last.ok ? null : last.error,
    });
    if (last.ok) break;
  }
  return last;
}

module.exports = { runEngine, DEFAULT_MODEL };
