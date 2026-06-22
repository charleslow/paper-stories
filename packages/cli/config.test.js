import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadDefaultConfig,
  mergeConfigs,
  parseModelOverrides,
} from './config.js';

describe('CLI config', () => {
  it('loads packaged default models', () => {
    const config = loadDefaultConfig();

    assert.equal(config.models.exploration, 'gpt-5.4');
    assert.equal(config.models.explanations, 'claude-opus-4-6');
    assert.equal(config.models.chat, 'gpt-5.4');
    // Mechanical stages default to the cheaper haiku model.
    assert.equal(config.models.index, 'claude-haiku-4-5');
    assert.equal(config.models.verification, 'claude-haiku-4-5');
    assert.equal(config.models.assemble, 'claude-haiku-4-5');
  });

  it('merges configs with later model values taking precedence', () => {
    const merged = mergeConfigs(
      { models: { exploration: 'default-exploration', outline: 'default-outline' } },
      { models: { exploration: 'local-exploration' } },
      { models: { outline: 'cli-outline' } },
    );

    assert.deepEqual(merged.models, {
      exploration: 'local-exploration',
      outline: 'cli-outline',
    });
  });

  it('parses comma-separated model overrides', () => {
    assert.deepEqual(
      parseModelOverrides('exploration=gpt-5.4,outline=claude-sonnet-4-6'),
      {
        models: {
          exploration: 'gpt-5.4',
          outline: 'claude-sonnet-4-6',
        },
      },
    );
  });

  it('rejects malformed model overrides', () => {
    assert.throws(
      () => parseModelOverrides('exploration'),
      /Use stage=model/,
    );
    assert.throws(
      () => parseModelOverrides('unknown=gpt-5.4'),
      /unknown model key/,
    );
  });
});
