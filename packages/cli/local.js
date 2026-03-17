/**
 * Local source adapter for textbook chapters and local PDFs.
 * Provides the same interface as arxiv.js but for local files.
 */
import { existsSync, readdirSync, statSync, copyFileSync, mkdirSync } from 'fs';
import { join, resolve, extname } from 'path';

/**
 * Prepare local LaTeX source directory.
 * If latexDir is provided, validates it exists and lists .tex files.
 * Returns the same shape as arxiv.downloadLatexSource().
 */
export function prepareLocalSource(latexDir) {
  if (!latexDir) {
    return { sourceDir: null, hasSource: false, texFiles: [], allFiles: [] };
  }

  const resolved = resolve(latexDir);
  if (!existsSync(resolved)) {
    throw new Error(`LaTeX directory not found: ${resolved}`);
  }

  const files = listFilesRecursive(resolved);
  const texFiles = files.filter(f => f.endsWith('.tex'));

  if (texFiles.length === 0) {
    console.log(`  ⚠ No .tex files found in ${resolved}`);
    return { sourceDir: resolved, hasSource: false, texFiles: [], allFiles: files };
  }

  console.log(`  ✓ Found ${files.length} files (${texFiles.length} .tex files) in ${resolved}`);
  return { sourceDir: resolved, hasSource: true, texFiles, allFiles: files };
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

/**
 * Recursively list all files in a directory.
 */
function listFilesRecursive(dir, prefix = '') {
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
