/**
 * arXiv paper extraction utilities.
 * Downloads LaTeX source and PDF from arXiv.
 */
import { execSync } from 'child_process';
import { mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { listFilesRecursive, emptySourceResult, assertSourceResult } from './source-utils.js';

/**
 * Parse an arXiv URL or ID into a normalized paper ID.
 * Supports:
 *   - https://arxiv.org/abs/2401.12345
 *   - https://arxiv.org/abs/2401.12345v2
 *   - https://arxiv.org/pdf/2401.12345
 *   - 2401.12345
 */
export function parseArxivId(input) {
  // Strip trailing slashes / whitespace
  input = input.trim().replace(/\/+$/, '');

  // Direct ID (e.g., "2401.12345" or "2401.12345v2")
  const directMatch = input.match(/^(\d{4}\.\d{4,5}(?:v\d+)?)$/);
  if (directMatch) return directMatch[1];

  // URL format
  const urlMatch = input.match(/arxiv\.org\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5}(?:v\d+)?)/);
  if (urlMatch) return urlMatch[1];

  throw new Error(`Cannot parse arXiv ID from: ${input}`);
}

/**
 * Download LaTeX source tarball from arXiv and extract it.
 * Returns the directory containing the extracted source files.
 */
export async function downloadLatexSource(arxivId, outputDir) {
  const sourceDir = join(outputDir, 'source');
  mkdirSync(sourceDir, { recursive: true });

  const sourceUrl = `https://arxiv.org/e-print/${arxivId}`;
  const tarPath = join(outputDir, 'source.tar.gz');

  console.log(`  Downloading LaTeX source from ${sourceUrl}...`);

  try {
    // Download with curl (follow redirects, respect rate limits)
    execSync(
      `curl -sL -o "${tarPath}" -H "User-Agent: paper-stories/0.1" "${sourceUrl}"`,
      { timeout: 60000 }
    );

    // Detect file type and extract accordingly
    const fileType = execSync(`file "${tarPath}"`, { encoding: 'utf8' }).trim();

    if (fileType.includes('gzip') || fileType.includes('tar')) {
      execSync(`tar -xzf "${tarPath}" -C "${sourceDir}" 2>/dev/null || tar -xf "${tarPath}" -C "${sourceDir}"`, {
        timeout: 30000
      });
    } else if (fileType.includes('PDF')) {
      // Some papers only have PDF, no source
      console.log('  ⚠ No LaTeX source available (PDF only). Proceeding with PDF.');
      return emptySourceResult();
    } else {
      // Try plain TeX (some papers are a single .tex file, not tarred)
      const content = readFileSync(tarPath, 'utf8');
      if (content.includes('\\begin{document}') || content.includes('\\documentclass')) {
        const { writeFileSync: writeFile } = await import('fs');
        writeFile(join(sourceDir, 'main.tex'), content);
      } else {
        console.log(`  ⚠ Unknown source format: ${fileType}`);
        return emptySourceResult();
      }
    }

    // List what we got
    const files = listFilesRecursive(sourceDir);
    const texFiles = files.filter(f => f.endsWith('.tex'));
    console.log(`  ✓ Extracted ${files.length} files (${texFiles.length} .tex files)`);

    return assertSourceResult({ sourceDir, hasSource: true, texFiles, allFiles: files });
  } catch (err) {
    console.error(`  ✗ Failed to download source: ${err.message}`);
    return emptySourceResult();
  }
}

/**
 * Download PDF from arXiv.
 */
export async function downloadPdf(arxivId, outputDir) {
  const pdfPath = join(outputDir, 'paper.pdf');
  const pdfUrl = `https://arxiv.org/pdf/${arxivId}.pdf`;

  console.log(`  Downloading PDF from ${pdfUrl}...`);

  try {
    execSync(
      `curl -sL -o "${pdfPath}" -H "User-Agent: paper-stories/0.1" "${pdfUrl}"`,
      { timeout: 60000 }
    );

    // Verify it's a PDF
    const fileType = execSync(`file "${pdfPath}"`, { encoding: 'utf8' });
    if (!fileType.includes('PDF')) {
      console.log('  ⚠ Downloaded file is not a valid PDF');
      return null;
    }

    console.log('  ✓ PDF downloaded');
    return pdfPath;
  } catch (err) {
    console.error(`  ✗ Failed to download PDF: ${err.message}`);
    return null;
  }
}

