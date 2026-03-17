#!/usr/bin/env node

/**
 * Paper Stories CLI
 *
 * Generates interactive walkthrough stories from arXiv papers or local PDFs (textbooks, etc.).
 *
 * Usage:
 *   paper-stories generate <arxiv-url> [--query "..."] [--output-dir ./out]
 *   paper-stories generate 2401.12345 --query "attention mechanism"
 *   paper-stories generate --pdf ./ch4.pdf [--latex-dir ./ch4/] --title "Chapter 4"
 */

import { Command } from 'commander';
import { spawn, execFileSync } from 'child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync, copyFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import ora from 'ora';
import { parseArxivId, downloadLatexSource, downloadPdf } from './arxiv.js';
import { prepareLocalSource, prepareLocalPdf } from './local.js';
import { buildPrompt } from './prompt.js';
import { validateStory } from './validate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const program = new Command();

program
  .name('paper-stories')
  .description('Generate interactive walkthrough stories from arXiv papers or local PDFs')
  .version('0.2.0');

program
  .command('generate')
  .description('Generate a story from an arXiv paper or local PDF')
  .argument('[arxiv]', 'arXiv URL or paper ID (e.g., 2401.12345). Omit when using --pdf.')
  .option('-q, --query <query>', 'Optional focus query for the story')
  .option('-o, --output-dir <dir>', 'Output directory', '.')
  .option('-c, --cache-repo <path>', 'Path to code-stories-cache repo for direct publishing')
  .option('-s, --slug <slug>', 'Story slug for the output filename')
  .option('--pdf <path>', 'Path to local PDF file (for textbooks, chapters, or any non-arXiv source)')
  .option('--latex-dir <path>', 'Path to local LaTeX source directory (optional, used with --pdf)')
  .option('--title <title>', 'Title for the story (used with --pdf)')
  .action(async (arxiv, options) => {
    try {
      if (options.pdf) {
        await generateLocalStory(options);
      } else {
        if (!arxiv) {
          console.error('✗ Error: provide an arXiv URL/ID or use --pdf <path>');
          process.exit(1);
        }
        await generateStory(arxiv, options);
      }
    } catch (err) {
      console.error(`\n✗ Error: ${err.message}`);
      process.exit(1);
    }
  });

program.parse();

/**
 * Generate a story from a local PDF (textbook chapter, etc.)
 */
async function generateLocalStory(options) {
  const generationId = uuidv4();
  const title = options.title || 'Local Document';

  console.log(`\n📄 Paper Stories Generator (local PDF)`);
  console.log(`   PDF: ${resolve(options.pdf)}`);
  console.log(`   LaTeX: ${options.latexDir ? resolve(options.latexDir) : '(none)'}`);
  console.log(`   Title: ${title}`);
  console.log(`   Query: ${options.query || '(comprehensive deep-dive)'}`);
  console.log(`   Generation ID: ${generationId}\n`);

  // Create working directory
  const workDir = join(resolve(options.outputDir), '.paper-stories-tmp', generationId);
  const generationDir = join(workDir, 'generation');
  mkdirSync(generationDir, { recursive: true });

  // Prepare local sources
  console.log('📂 Preparing local sources...');
  const sourceResult = options.latexDir
    ? prepareLocalSource(options.latexDir)
    : { sourceDir: null, hasSource: false, texFiles: [], allFiles: [] };
  const pdfPath = prepareLocalPdf(options.pdf, workDir);

  // Extract PDF text regions
  let regionsPath = null;
  if (pdfPath) {
    console.log('📐 Extracting PDF text regions...');
    regionsPath = join(workDir, 'regions.json');
    const extractScript = join(__dirname, 'extract_regions.py');
    try {
      execFileSync('uv', ['run', extractScript, pdfPath, '-o', regionsPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const regions = JSON.parse(readFileSync(regionsPath, 'utf8'));
      const blockCount = regions.pages.reduce((sum, p) => sum + p.blocks.length, 0);
      console.log(`   ✓ Extracted ${blockCount} text blocks from ${regions.totalPages} pages`);
    } catch (err) {
      console.warn(`   ⚠ Region extraction failed (story will proceed without bboxes): ${err.message}`);
      regionsPath = null;
    }
  }

  // Build the prompt
  const prompt = buildPrompt({
    arxivId: null,
    arxivUrl: null,
    query: options.query,
    sourceDir: sourceResult.hasSource ? sourceResult.sourceDir : null,
    pdfPath,
    regionsPath,
    generationDir,
    title,
  });

  // Run the shared generation pipeline
  await runGenerationPipeline({
    prompt,
    generationDir,
    workDir,
    sourceResult,
    pdfPath,
    options,
  });
}

/**
 * Generate a story from an arXiv paper (existing flow).
 */
async function generateStory(arxivInput, options) {
  const arxivId = parseArxivId(arxivInput);
  const arxivUrl = `https://arxiv.org/abs/${arxivId}`;
  const generationId = uuidv4();

  console.log(`\n📄 Paper Stories Generator`);
  console.log(`   Paper: ${arxivUrl}`);
  console.log(`   Query: ${options.query || '(comprehensive deep-dive)'}`);
  console.log(`   Generation ID: ${generationId}\n`);

  // Create working directory
  const workDir = join(resolve(options.outputDir), '.paper-stories-tmp', generationId);
  const generationDir = join(workDir, 'generation');
  mkdirSync(generationDir, { recursive: true });

  // Download source materials
  console.log('📥 Downloading paper sources...');
  const [sourceResult, pdfPath] = await Promise.all([
    downloadLatexSource(arxivId, workDir),
    downloadPdf(arxivId, workDir),
  ]);

  if (!sourceResult.hasSource && !pdfPath) {
    throw new Error('Could not download either LaTeX source or PDF. Check the arXiv ID.');
  }

  // Extract PDF text regions
  let regionsPath = null;
  if (pdfPath) {
    console.log('📐 Extracting PDF text regions...');
    regionsPath = join(workDir, 'regions.json');
    const extractScript = join(__dirname, 'extract_regions.py');
    try {
      execFileSync('uv', ['run', extractScript, pdfPath, '-o', regionsPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const regions = JSON.parse(readFileSync(regionsPath, 'utf8'));
      const blockCount = regions.pages.reduce((sum, p) => sum + p.blocks.length, 0);
      console.log(`   ✓ Extracted ${blockCount} text blocks from ${regions.totalPages} pages`);
    } catch (err) {
      console.warn(`   ⚠ Region extraction failed (story will proceed without bboxes): ${err.message}`);
      regionsPath = null;
    }
  }

  // Build the prompt
  const prompt = buildPrompt({
    arxivId,
    arxivUrl,
    query: options.query,
    sourceDir: sourceResult.hasSource ? sourceResult.sourceDir : null,
    pdfPath,
    regionsPath,
    generationDir,
    title: null,
  });

  // Run the shared generation pipeline
  await runGenerationPipeline({
    prompt,
    generationDir,
    workDir,
    sourceResult,
    pdfPath,
    options,
  });
}

/**
 * Shared generation pipeline: prompt → Claude → validate → save.
 */
async function runGenerationPipeline({ prompt, generationDir, workDir, sourceResult, pdfPath, options }) {
  // Write prompt for debugging
  writeFileSync(join(generationDir, '_prompt.md'), prompt);

  // Spawn Claude
  console.log('\n🤖 Launching Claude for story generation...\n');

  const spinner = ora({
    text: 'Stage 1: Exploring sources...',
    color: 'cyan',
  }).start();

  // Progress tracking
  const stages = [
    { marker: 'EXPLORATION_COMPLETE', label: 'Stage 2: Planning chapter outline...' },
    { marker: 'OUTLINE_COMPLETE', label: 'Stage 3: Collecting verified excerpts...' },
    { marker: 'EXCERPTS_COMPLETE', label: 'Stage 4: Verifying excerpts against source...' },
    { marker: 'VERIFICATION_COMPLETE', label: 'Stage 5: Writing explanations...' },
    { marker: 'EXPLANATIONS_COMPLETE', label: 'Stage 6: Assembling final story...' },
    { marker: 'DONE', label: null },
  ];

  let currentStage = 0;

  const progressInterval = setInterval(() => {
    while (currentStage < stages.length) {
      const { marker, label } = stages[currentStage];
      const doneFile = join(generationDir, 'DONE');
      const checkFiles = [
        join(generationDir, 'exploration.md'),
        join(generationDir, 'outline.md'),
        join(generationDir, 'excerpts.md'),
        join(generationDir, 'verification.md'),
        join(generationDir, 'explanations.md'),
        doneFile,
      ];

      let found = false;
      for (const f of checkFiles) {
        if (existsSync(f)) {
          try {
            const content = readFileSync(f, 'utf8');
            if (content.includes(marker)) {
              found = true;
              break;
            }
          } catch { /* ignore */ }
        }
      }

      if (found) {
        currentStage++;
        if (label) {
          spinner.text = label;
        }
      } else {
        break;
      }
    }
  }, 2000);

  // Spawn Claude process
  const claudeResult = await new Promise((resolvePromise, rejectPromise) => {
    const allowedTools = 'Read,Grep,Glob,Write';
    const dirs = ['--add-dir', generationDir];
    if (sourceResult.hasSource) {
      dirs.push('--add-dir', sourceResult.sourceDir);
    }
    if (pdfPath) {
      dirs.push('--add-dir', workDir);
    }

    // Strip CLAUDECODE env vars so nested claude sessions don't fail
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;
    delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
    delete cleanEnv.CLAUDE_CODE_SESSION;

    const proc = spawn('claude', ['-p', '--allowedTools', allowedTools, ...dirs], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cleanEnv,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
      } else {
        rejectPromise(new Error(`Claude exited with code ${code}\n${stderr}`));
      }
    });

    proc.on('error', (err) => {
      rejectPromise(new Error(`Failed to spawn Claude: ${err.message}`));
    });

    proc.stdin.write(prompt);
    proc.stdin.end();

    const cleanup = () => {
      proc.kill('SIGTERM');
      process.exit(1);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  });

  clearInterval(progressInterval);

  // Check for story.json
  const storyPath = join(generationDir, 'story.json');
  if (!existsSync(storyPath)) {
    spinner.fail('Claude did not produce a story.json');
    console.error('Check generation directory:', generationDir);
    process.exit(1);
  }

  // Validate story JSON
  let story;
  try {
    story = JSON.parse(readFileSync(storyPath, 'utf8'));
    validateStory(story);
  } catch (err) {
    spinner.fail(`Invalid story.json: ${err.message}`);
    process.exit(1);
  }

  spinner.succeed(`Story generated: "${story.title}" (${story.chapters.length} chapters)`);

  // Publish to cache repo if specified
  if (options.cacheRepo) {
    const slug = options.slug || slugify(story.title);
    await publishToCache(story, slug, options.cacheRepo, pdfPath);
  } else {
    const slug = options.slug || slugify(story.title);
    const outputPath = join(resolve(options.outputDir), `${slug}.json`);
    story.id = slug;
    writeFileSync(outputPath, JSON.stringify(story, null, 2));
    if (pdfPath && existsSync(pdfPath)) {
      const pdfOutputPath = join(resolve(options.outputDir), `${slug}.pdf`);
      copyFileSync(pdfPath, pdfOutputPath);
      console.log(`✓ PDF saved to: ${pdfOutputPath}`);
    }
    console.log(`\n✓ Story saved to: ${outputPath}`);
  }

  console.log(`\n📁 Generation files kept at: ${generationDir}`);
}

async function publishToCache(story, slug, cacheRepoPath, pdfPath) {
  const storiesDir = join(cacheRepoPath, 'stories');
  if (!existsSync(storiesDir)) {
    throw new Error(`Cache repo stories directory not found: ${storiesDir}`);
  }

  story.id = slug;

  const storyPath = join(storiesDir, `${slug}.json`);
  writeFileSync(storyPath, JSON.stringify(story, null, 2));

  if (pdfPath && existsSync(pdfPath)) {
    const pdfOutputPath = join(storiesDir, `${slug}.pdf`);
    copyFileSync(pdfPath, pdfOutputPath);
    console.log(`✓ PDF published to: ${pdfOutputPath}`);
  }

  const manifestPath = join(storiesDir, 'manifest.json');
  let manifest = { stories: [] };
  if (existsSync(manifestPath)) {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  }

  manifest.stories = manifest.stories.filter(s => s.id !== slug);

  manifest.stories.unshift({
    id: slug,
    title: story.title,
    arxivId: story.arxivId || null,
    createdAt: story.createdAt,
  });

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`\n✓ Published to cache: ${storyPath}`);
  console.log(`✓ Manifest updated: ${manifestPath}`);
  console.log(`\n🔗 View at: https://charleslow.github.io/paper-stories/?repo=charleslow/code-stories-cache&story=${slug}`);
}

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}
