import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { prepareLocalSource, prepareLocalPdf } from './local.js';
import { listFilesRecursive, emptySourceResult, assertSourceResult } from './source-utils.js';

const TEST_DIR = join(tmpdir(), 'paper-stories-test-' + process.pid);

function setup() {
  mkdirSync(TEST_DIR, { recursive: true });
}

function cleanup() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

// --- listFilesRecursive ---

describe('listFilesRecursive', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('returns empty array for non-existent directory', () => {
    assert.deepEqual(listFilesRecursive('/no/such/dir'), []);
  });

  it('lists files recursively with relative paths', () => {
    const dir = join(TEST_DIR, 'src');
    mkdirSync(join(dir, 'sub'), { recursive: true });
    writeFileSync(join(dir, 'main.tex'), '');
    writeFileSync(join(dir, 'sub', 'chapter.tex'), '');
    writeFileSync(join(dir, 'fig.png'), '');

    const files = listFilesRecursive(dir).sort();
    assert.deepEqual(files, ['fig.png', 'main.tex', 'sub/chapter.tex']);
  });

  it('returns empty array for empty directory', () => {
    const dir = join(TEST_DIR, 'empty');
    mkdirSync(dir, { recursive: true });
    assert.deepEqual(listFilesRecursive(dir), []);
  });
});

// --- emptySourceResult / assertSourceResult ---

describe('SourceResult interface', () => {
  it('emptySourceResult returns correct shape', () => {
    const r = emptySourceResult();
    assert.equal(r.sourceDir, null);
    assert.equal(r.hasSource, false);
    assert.deepEqual(r.texFiles, []);
    assert.deepEqual(r.allFiles, []);
  });

  it('assertSourceResult accepts valid result', () => {
    const valid = { sourceDir: '/tmp', hasSource: true, texFiles: ['a.tex'], allFiles: ['a.tex'] };
    assert.doesNotThrow(() => assertSourceResult(valid));
  });

  it('assertSourceResult rejects missing hasSource', () => {
    assert.throws(() => assertSourceResult({ sourceDir: null, texFiles: [], allFiles: [] }), /hasSource/);
  });

  it('assertSourceResult rejects non-array texFiles', () => {
    assert.throws(() => assertSourceResult({ hasSource: false, texFiles: 'bad', allFiles: [] }), /texFiles/);
  });

  it('assertSourceResult rejects null sourceDir when hasSource is true', () => {
    assert.throws(() => assertSourceResult({ sourceDir: null, hasSource: true, texFiles: [], allFiles: [] }), /sourceDir/);
  });
});

// --- prepareLocalSource ---

describe('prepareLocalSource', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('returns emptySourceResult when latexDir is null', () => {
    const result = prepareLocalSource(null);
    assert.equal(result.hasSource, false);
    assert.equal(result.sourceDir, null);
  });

  it('throws when latexDir does not exist', () => {
    assert.throws(() => prepareLocalSource('/no/such/dir'), /not found/);
  });

  it('returns hasSource=false when no .tex files exist', () => {
    const dir = join(TEST_DIR, 'no-tex');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'readme.md'), '');

    const result = prepareLocalSource(dir);
    assert.equal(result.hasSource, false);
    assert.deepEqual(result.texFiles, []);
    assert.equal(result.allFiles.length, 1);
  });

  it('returns hasSource=true with tex files listed', () => {
    const dir = join(TEST_DIR, 'with-tex');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'main.tex'), '\\documentclass{article}');
    writeFileSync(join(dir, 'fig.png'), '');

    const result = prepareLocalSource(dir);
    assert.equal(result.hasSource, true);
    assert.deepEqual(result.texFiles, ['main.tex']);
    assert.equal(result.allFiles.length, 2);
  });
});

// --- prepareLocalPdf ---

describe('prepareLocalPdf', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('throws when PDF does not exist', () => {
    assert.throws(() => prepareLocalPdf('/no/such/file.pdf', TEST_DIR), /not found/);
  });

  it('copies PDF to work directory and returns path', () => {
    const pdf = join(TEST_DIR, 'input.pdf');
    writeFileSync(pdf, '%PDF-1.4 fake');

    const workDir = join(TEST_DIR, 'work');
    mkdirSync(workDir, { recursive: true });

    const result = prepareLocalPdf(pdf, workDir);
    assert.equal(result, join(workDir, 'paper.pdf'));
    assert(existsSync(result));
  });
});
