import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const VALID_MODEL_KEYS = new Set([
  'exploration',
  'outline',
  'excerpts',
  'verification',
  'explanations',
  'assemble',
  'chat',
]);

const PACKAGE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = path.join(PACKAGE_DIR, 'config.yaml');

function validateConfig(parsed, configPath) {
  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${configPath}: top-level value must be a YAML mapping`);
  }

  const models = parsed.models;
  if (models !== undefined) {
    if (typeof models !== 'object' || Array.isArray(models)) {
      throw new Error(`${configPath}: "models" must be a mapping of stage names to model strings`);
    }
    for (const key of Object.keys(models)) {
      if (!VALID_MODEL_KEYS.has(key)) {
        throw new Error(`${configPath}: unknown model key "${key}". Valid keys: ${[...VALID_MODEL_KEYS].join(', ')}`);
      }
      if (typeof models[key] !== 'string' || models[key].trim() === '') {
        throw new Error(`${configPath}: models.${key} must be a non-empty string`);
      }
    }
  }

  return parsed;
}

export function loadConfigFile(configPath, { optional = true } = {}) {
  if (!fs.existsSync(configPath)) {
    if (optional) return {};
    throw new Error(`Missing required config file: ${configPath}`);
  }

  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
  } catch (e) {
    throw new Error(`Failed to read ${configPath}: ${e.message}`);
  }

  let parsed;
  try {
    parsed = yaml.load(raw);
  } catch (e) {
    throw new Error(`Failed to parse ${configPath}: ${e.message}`);
  }

  return validateConfig(parsed, configPath);
}

export function loadDefaultConfig() {
  return loadConfigFile(DEFAULT_CONFIG_PATH, { optional: false });
}

export function mergeConfigs(...configs) {
  const merged = {};
  for (const config of configs) {
    if (!config || typeof config !== 'object') continue;
    const { models, ...rest } = config;
    Object.assign(merged, rest);
    if (models) {
      merged.models = {
        ...(merged.models || {}),
        ...models,
      };
    }
  }
  return merged;
}

export function parseModelOverrides(value) {
  if (!value) return {};

  const models = {};
  for (const rawPair of value.split(',')) {
    const pair = rawPair.trim();
    if (!pair) continue;

    const separator = pair.includes('=') ? '=' : pair.includes(':') ? ':' : null;
    if (!separator) {
      throw new Error(`Invalid --models entry "${pair}". Use stage=model,stage=model.`);
    }

    const [rawKey, ...rawValueParts] = pair.split(separator);
    const key = rawKey.trim();
    const model = rawValueParts.join(separator).trim();

    if (!VALID_MODEL_KEYS.has(key)) {
      throw new Error(`--models: unknown model key "${key}". Valid keys: ${[...VALID_MODEL_KEYS].join(', ')}`);
    }
    if (!model) {
      throw new Error(`--models: ${key} must be a non-empty model name`);
    }

    models[key] = model;
  }

  return Object.keys(models).length > 0 ? { models } : {};
}
