/**
 * Token-usage accounting for the generation pipeline.
 *
 * Each stage runs as a subprocess; these pure helpers turn its stdout into a
 * normalized per-stage usage record and roll the records into the
 * `story.generation` block the viewer reads. Parsing is best-effort: a stage
 * that reports nothing yields nulls rather than failing generation.
 */

/**
 * Parse a stage subprocess's stdout into a token-usage record (or null).
 * @param {string} stdout
 * @param {'claude'|'codex'} runner
 */
export function parseStageUsage(stdout, runner) {
  try {
    return runner === 'claude' ? parseClaudeUsage(stdout) : parseCodexUsage(stdout);
  } catch {
    return null;
  }
}

/** Parse the JSON envelope emitted by `claude -p --output-format json`. */
export function parseClaudeUsage(stdout) {
  const text = (stdout || '').trim();
  if (!text) return null;
  let obj = null;
  try { obj = JSON.parse(text); } catch { /* fall through to trailing-object match */ }
  if (!obj) {
    const m = text.match(/\{[\s\S]*\}\s*$/);
    if (m) { try { obj = JSON.parse(m[0]); } catch { /* give up */ } }
  }
  if (!obj || typeof obj !== 'object') return null;

  let u = obj.usage;
  if ((!u || typeof u !== 'object') && obj.modelUsage && typeof obj.modelUsage === 'object') {
    const first = Object.values(obj.modelUsage)[0];
    u = first?.usage || first;
  }
  const cost = typeof obj.total_cost_usd === 'number' ? obj.total_cost_usd : null;
  if (!u || typeof u !== 'object') {
    return cost != null ? { costUsd: cost } : null;
  }
  return {
    inputTokens: u.input_tokens ?? null,
    outputTokens: u.output_tokens ?? null,
    cacheReadInputTokens: u.cache_read_input_tokens ?? null,
    cacheCreationInputTokens: u.cache_creation_input_tokens ?? null,
    costUsd: cost,
  };
}

/** Best-effort parse of Codex output (JSON-lines events, then a text fallback). */
export function parseCodexUsage(stdout) {
  const text = stdout || '';
  let usage = null;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let o;
    try { o = JSON.parse(t); } catch { continue; }
    const u = o.usage || o.token_usage || o.tokenUsage || (o.msg && (o.msg.usage || o.msg.token_usage));
    if (u && typeof u === 'object') {
      usage = {
        inputTokens: u.input_tokens ?? u.prompt_tokens ?? u.inputTokens ?? null,
        outputTokens: u.output_tokens ?? u.completion_tokens ?? u.outputTokens ?? null,
        cacheReadInputTokens: u.cached_input_tokens ?? u.cache_read_input_tokens ?? null,
        cacheCreationInputTokens: null,
        costUsd: null,
      };
    }
  }
  if (usage) return usage;
  const m = text.match(/tokens used[:\s]+([0-9][0-9,]*)/i);
  if (m) return { totalTokens: Number(m[1].replace(/,/g, '')) };
  return null;
}

/** Coerce a parsed usage record into a fixed numeric/null shape for storage. */
export function normalizeUsage(usage) {
  const u = usage || {};
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    inputTokens: num(u.inputTokens),
    outputTokens: num(u.outputTokens),
    cacheReadInputTokens: num(u.cacheReadInputTokens),
    cacheCreationInputTokens: num(u.cacheCreationInputTokens),
    totalTokens: num(u.totalTokens),
    costUsd: num(u.costUsd),
  };
}

/**
 * Roll per-stage usages into the `story.generation` block the viewer reads.
 * Totals are null when no stage reported a given field, so the viewer can show
 * "n/a" rather than a misleading 0.
 *
 * @param {Array<object>} stageUsages - normalized per-stage records (with key/model)
 * @param {string[]} parseErrors - stage keys where usage parsing produced null
 */
export function buildGenerationStats(stageUsages, parseErrors = []) {
  const sumKeys = ['inputTokens', 'outputTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens', 'costUsd'];
  const totals = {};
  let any = false;
  for (const k of sumKeys) {
    let sum = 0;
    let seen = false;
    for (const s of stageUsages) {
      if (typeof s[k] === 'number') { sum += s[k]; seen = true; }
    }
    totals[k] = seen ? sum : null;
    if (seen) any = true;
  }
  // Grand total of all tokens: input+output per stage, falling back to a stage's
  // reported totalTokens when it didn't break the count down (e.g. some Codex runs).
  let tokenSum = 0;
  let tokenSeen = false;
  for (const s of stageUsages) {
    if (typeof s.inputTokens === 'number' || typeof s.outputTokens === 'number') {
      tokenSum += (s.inputTokens || 0) + (s.outputTokens || 0);
      tokenSeen = true;
    } else if (typeof s.totalTokens === 'number') {
      tokenSum += s.totalTokens;
      tokenSeen = true;
    }
  }
  totals.totalTokens = tokenSeen ? tokenSum : null;
  return {
    generatedAt: new Date().toISOString(),
    stages: stageUsages,
    totals: any || tokenSeen ? totals : null,
    ...(parseErrors.length ? { parseErrors } : {}),
  };
}
