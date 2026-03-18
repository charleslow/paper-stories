/**
 * Local source adapter for textbook chapters and local PDFs.
 * Provides the same interface as arxiv.js but for local files.
 */
import { existsSync, copyFileSync } from 'fs';
import { join, resolve } from 'path';
import { listFilesRecursive, emptySourceResult, assertSourceResult } from './source-utils.js';

/**
 * Prepare local LaTeX source directory.
 * If latexDir is provided, validates it exists and lists .tex files.
 * Returns the same shape as arxiv.downloadLatexSource().
 */
export function prepareLocalSource(latexDir) {
  if (!latexDir) {
    return emptySourceResult();
  }

  const resolved = resolve(latexDir);
  if (!existsSync(resolved)) {
    throw new Error(`LaTeX directory not found: ${resolved}`);
  }

  const files = listFilesRecursive(resolved);
  const texFiles = files.filter(f => f.endsWith('.tex'));

  if (texFiles.length === 0) {
    console.log(`  ⚠ No .tex files found in ${resolved}`);
    return assertSourceResult({ sourceDir: resolved, hasSource: false, texFiles: [], allFiles: files });
  }

  console.log(`  ✓ Found ${files.length} files (${texFiles.length} .tex files) in ${resolved}`);
  return assertSourceResult({ sourceDir: resolved, hasSource: true, texFiles, allFiles: files });
}

/**
 * Prepare local PDF file.
 * Copies the PDF into the working directory for consistent handling.
 * Returns the path to the PDF in the working directory.
 */
export function prepareLocalPdf(pdfPath, workDir) {
  const resolved = resolve(pdfPath);
  if (!existsSync(resolved)) {
    throw new Error(`PDF not found: ${resolved}`);
  }

  // Copy PDF to work dir for consistent handling with the rest of the pipeline
  const destPath = join(workDir, 'paper.pdf');
  copyFileSync(resolved, destPath);
  console.log(`  ✓ PDF loaded from ${resolved}`);
  return destPath;
}

