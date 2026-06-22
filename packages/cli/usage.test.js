import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseStageUsage,
  parseClaudeUsage,
  parseCodexUsage,
  normalizeUsage,
  buildGenerationStats,
} from './usage.js';

describe('parseClaudeUsage', () => {
  it('extracts usage and cost from the claude --output-format json envelope', () => {
    const stdout = JSON.stringify({
      type: 'result',
      subtype: 'success',
      total_cost_usd: 0.0123,
      usage: {
        input_tokens: 1500,
        output_tokens: 320,
        cache_read_input_tokens: 800,
        cache_creation_input_tokens: 200,
      },
      result: 'done',
    });
    assert.deepEqual(parseClaudeUsage(stdout), {
      inputTokens: 1500,
      outputTokens: 320,
      cacheReadInputTokens: 800,
      cacheCreationInputTokens: 200,
      costUsd: 0.0123,
    });
  });

  it('parses a trailing JSON object when surrounded by other text', () => {
    const stdout = 'some log line\n{"usage":{"input_tokens":10,"output_tokens":5}}';
    const u = parseClaudeUsage(stdout);
    assert.equal(u.inputTokens, 10);
    assert.equal(u.outputTokens, 5);
  });

  it('falls back to modelUsage when there is no top-level usage', () => {
    const stdout = JSON.stringify({
      modelUsage: { 'claude-haiku-4-5': { usage: { input_tokens: 7, output_tokens: 3 } } },
    });
    const u = parseClaudeUsage(stdout);
    assert.equal(u.inputTokens, 7);
    assert.equal(u.outputTokens, 3);
  });

  it('returns null for non-JSON output', () => {
    assert.equal(parseClaudeUsage('not json at all'), null);
    assert.equal(parseClaudeUsage(''), null);
  });
});

describe('parseCodexUsage', () => {
  it('reads token usage from a JSON-lines event', () => {
    const stdout = [
      '{"type":"agent_message","text":"working"}',
      '{"type":"token_count","usage":{"input_tokens":2000,"output_tokens":450}}',
    ].join('\n');
    const u = parseCodexUsage(stdout);
    assert.equal(u.inputTokens, 2000);
    assert.equal(u.outputTokens, 450);
  });

  it('falls back to a human-readable token summary', () => {
    assert.deepEqual(parseCodexUsage('... tokens used: 12,345\n'), { totalTokens: 12345 });
  });

  it('returns null when nothing is parseable', () => {
    assert.equal(parseCodexUsage('no usage here'), null);
  });
});

describe('parseStageUsage', () => {
  it('routes by runner and never throws on garbage', () => {
    assert.equal(parseStageUsage(null, 'claude'), null);
    assert.equal(parseStageUsage(undefined, 'codex'), null);
    assert.ok(parseStageUsage('{"usage":{"input_tokens":1,"output_tokens":1}}', 'claude'));
  });
});

describe('normalizeUsage', () => {
  it('coerces missing fields to null and keeps numbers', () => {
    assert.deepEqual(normalizeUsage({ inputTokens: 5 }), {
      inputTokens: 5,
      outputTokens: null,
      cacheReadInputTokens: null,
      cacheCreationInputTokens: null,
      totalTokens: null,
      costUsd: null,
    });
    assert.deepEqual(normalizeUsage(null), {
      inputTokens: null,
      outputTokens: null,
      cacheReadInputTokens: null,
      cacheCreationInputTokens: null,
      totalTokens: null,
      costUsd: null,
    });
  });
});

describe('buildGenerationStats', () => {
  it('sums per-stage tokens and cost into totals', () => {
    const stats = buildGenerationStats([
      { key: 'index', model: 'claude-haiku-4-5', inputTokens: 1000, outputTokens: 200, costUsd: 0.01, totalTokens: null },
      { key: 'outline', model: 'claude-sonnet-4-6', inputTokens: 2000, outputTokens: 500, costUsd: 0.05, totalTokens: null },
    ]);
    assert.equal(stats.totals.inputTokens, 3000);
    assert.equal(stats.totals.outputTokens, 700);
    assert.equal(stats.totals.totalTokens, 3700);
    assert.ok(Math.abs(stats.totals.costUsd - 0.06) < 1e-9);
    assert.equal(stats.stages.length, 2);
    assert.ok(stats.generatedAt);
  });

  it('folds a stage that only reported a total into the grand total', () => {
    const stats = buildGenerationStats([
      { key: 'index', model: 'claude-haiku-4-5', inputTokens: 100, outputTokens: 50, totalTokens: null, costUsd: null },
      { key: 'exploration', model: 'gpt-5.4', inputTokens: null, outputTokens: null, totalTokens: 900, costUsd: null },
    ]);
    assert.equal(stats.totals.totalTokens, 150 + 900);
  });

  it('returns null totals when no stage reported usage', () => {
    const stats = buildGenerationStats([
      { key: 'index', model: 'claude-haiku-4-5', inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null },
    ]);
    assert.equal(stats.totals, null);
  });
});
