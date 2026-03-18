/**
 * Shared utilities for source adapters (arxiv.js, local.js).
 *
 * Defines the SourceResult interface and common file-system helpers.
 */
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * @typedef {Object} SourceResult
 * @property {string|null} sourceDir  - Absolute path to the extracted/local source directory
 * @property {boolean}     hasSource  - Whether usable LaTeX source files were found
 * @property {string[]}    texFiles   - Relative paths to .tex files within sourceDir
 * @property {string[]}    allFiles   - Relative paths to all files within sourceDir
 */

/**
 * Build a SourceResult with no available source.
 * @returns {SourceResult}
 */
export function emptySourceResult() {
  return { sourceDir: null, hasSource: false, texFiles: [], allFiles: [] };
}

/**
 * Validate that an object conforms to the SourceResult interface.
 * Throws if the shape is wrong.
 * @param {any} obj
 * @returns {SourceResult}
 */
export function assertSourceResult(obj) {
  if (typeof obj !== 'object' || obj === null) {
    throw new Error('SourceResult must be a non-null object');
  }
  if (typeof obj.hasSource !== 'boolean') {
    throw new Error('SourceResult.hasSource must be a boolean');
  }
  if (!Array.isArray(obj.texFiles)) {
    throw new Error('SourceResult.texFiles must be an array');
  }
  if (!Array.isArray(obj.allFiles)) {
    throw new Error('SourceResult.allFiles must be an array');
  }
  if (obj.hasSource && typeof obj.sourceDir !== 'string') {
    throw new Error('SourceResult.sourceDir must be a string when hasSource is true');
  }
  return obj;
}

/**
 * Recursively list all files in a directory, returning relative paths.
 * @param {string} dir    - Absolute path to the directory
 * @param {string} prefix - Path prefix for recursion (internal)
 * @returns {string[]}
 */
export function listFilesRecursive(dir, prefix = '') {
  const results = [];
  if (!existsSync(dir)) return results;

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const relPath = prefix ? `${prefix}/${entry}` : entry;

    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        results.push(...listFilesRecursive(fullPath, relPath));
      } else {
        results.push(relPath);
      }
    } catch {
      // Skip unreadable files
    }
  }
  return results;
}
