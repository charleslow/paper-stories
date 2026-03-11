#!/usr/bin/env node

/**
 * Paper Stories CLI
 *
 * Generates interactive paper walkthrough stories from arXiv papers.
 *
 * Usage:
 *   paper-stories generate <arxiv-url> [--query "..."] [--output-dir ./out]
 *   paper-stories generate 2401.12345 --query "attention mechanism"
 */

import { Command } from 'commander';
import { spawn, execFileSync } from 'child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync, copyFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import ora from 'ora';
import { parseArxivId, downloadLatexSource, downloadPdf } from './arxiv.js';
import { buildPrompt } from './prompt.js';
import { validateStory } from './validate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const program = new Command();

program
  .name('paper-stories')
  .description('Generate interactive walkthrough stories from arXiv papers')
  .version('0.1.0');

program
  .command('generate')
  .description('Generate a story from an arXiv paper')
  .argument('<arxiv>', 'arXiv URL or paper ID (e.g., 2401.12345)')
  .option('-q, --query <query>', 'Optional focus query for the story')
  .option('-o, --output-dir <dir>', 'Output directory', '.')
  .option('-c, --cache-repo <path>', 'Path to code-stories-cache repo for direct publishing')
  .option('-s, --slug <slug>', 'Story slug for the output filename')
  .action(async (arxiv, options) => {
    try {
      await generateStory(arxiv, options);
    } catch (err) {
      console.error(`\n✗ Error: ${err.message}`);
      process.exit(1);
    }
  });

program.parse();

async function generateStory(arxivInput, options) {
  // Parse arXiv ID
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

  // Extract PDF text regions with bounding boxes
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
  });

  // Write prompt for debugging
  writeFileSync(join(generationDir, '_prompt.md'), prompt);

  // Spawn Claude
  console.log('\n🤖 Launching Claude for story generation...\n');

  const spinner = ora({
    text: 'Stage 1: Exploring paper sources...',
    color: 'cyan',
  }).start();

  // Progress tracking
  const stages = [
    { marker: 'EXPLORATION_COMPLETE', label: 'Stage 2: Planning chapter outline...' },
    { marker: 'OUTLINE_COMPLETE', label: 'Stage 3: Collecting verified excerpts...' },
    { marker: 'EXCERPTS_COMPLETE', label: 'Stage 4: Verifying excerpts against source...' },
    { marker: 'VERIFICATION_COMPLETE', label: 'Stage 5: Writing explanations...' },
    { marker: 'EXPLANATIONS_COMPLETE', label: 'Stage 6: Assembling final story...' },
    { marker: 'DONE', label: null }, // Final marker
  ];

  let currentStage = 0;

  // Poll for progress
  const progressInterval = setInterval(() => {
    while (currentStage < stages.length) {
      const { marker, label } = stages[currentStage];
      // Check for marker as a file or in checkpoint files
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

    const proc = spawn('claude', ['-p', '--allowedTools', allowedTools, ...dirs], {
      stdio: ['pipe', 'pipe', 'pipe'],
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

    // Send prompt via stdin
    proc.stdin.write(prompt);
    proc.stdin.end();

    // Cleanup on signals
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
    // Copy to output directory
    const slug = options.slug || slugify(story.title);
    const outputPath = join(resolve(options.outputDir), `${slug}.json`);
    story.id = slug;
    writeFileSync(outputPath, JSON.stringify(story, null, 2));
    // Copy PDF alongside the story JSON
    if (pdfPath && existsSync(pdfPath)) {
      const pdfOutputPath = join(resolve(options.outputDir), `${slug}.pdf`);
      copyFileSync(pdfPath, pdfOutputPath);
      console.log(`✓ PDF saved to: ${pdfOutputPath}`);
    }
    console.log(`\n✓ Story saved to: ${outputPath}`);
  }

  // Cleanup
  console.log(`\n📁 Generation files kept at: ${generationDir}`);
}

async function publishToCache(story, slug, cacheRepoPath, pdfPath) {
  const storiesDir = join(cacheRepoPath, 'stories');
  if (!existsSync(storiesDir)) {
    throw new Error(`Cache repo stories directory not found: ${storiesDir}`);
  }

  // Update story ID to slug
  story.id = slug;

  // Write story file
  const storyPath = join(storiesDir, `${slug}.json`);
  writeFileSync(storyPath, JSON.stringify(story, null, 2));

  // Copy PDF alongside the story JSON
  if (pdfPath && existsSync(pdfPath)) {
    const pdfOutputPath = join(storiesDir, `${slug}.pdf`);
    copyFileSync(pdfPath, pdfOutputPath);
    console.log(`✓ PDF published to: ${pdfOutputPath}`);
  }

  // Update manifest
  const manifestPath = join(storiesDir, 'manifest.json');
  let manifest = { stories: [] };
  if (existsSync(manifestPath)) {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  }

  // Remove existing entry with same slug
  manifest.stories = manifest.stories.filter(s => s.id !== slug);

  // Add new entry at the beginning
  manifest.stories.unshift({
    id: slug,
    title: story.title,
    arxivId: story.arxivId,
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
