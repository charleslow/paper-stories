#!/usr/bin/env node

/**
 * Paper Stories CLI
 *
 * Generates interactive walkthrough stories from arXiv papers, local PDFs, or webpages.
 *
 * Usage:
 *   paper-stories generate --mode paper 2401.12345 [--query "..."] [--output-dir ./out]
 *   paper-stories generate --mode paper --pdf ./paper.pdf
 *   paper-stories generate --mode textbook --pdf ./ch4.pdf
 *   paper-stories generate --mode webpage https://example.com/article
 */

import { Command, Option } from 'commander';
import { spawn, execFileSync } from 'child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync, copyFileSync } from 'fs';
import { join, resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import ora from 'ora';
import { loadDefaultConfig, mergeConfigs, parseModelOverrides } from './config.js';
import { parseArxivId, downloadLatexSource, downloadPdf } from './arxiv.js';
import { prepareLocalPdf } from './local.js';
import { prepareWebpage } from './webpage.js';
import { emptySourceResult } from './source-utils.js';
import { buildPrompt, buildCollectionPrompt } from './prompt.js';
import { validateStory } from './validate.js';
import { parseStageUsage, normalizeUsage, buildGenerationStats } from './usage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const program = new Command();

program
  .name('paper-stories')
  .description('Generate interactive walkthrough stories from arXiv papers, local PDFs, or webpages')
  .version('0.2.0');

program
  .command('generate')
  .description('Generate a story from an arXiv paper, local PDF, or webpage')
  .argument('[source]', 'arXiv URL/ID (paper or textbook mode) or webpage URL (webpage mode). Omit when using --pdf.')
  .option('-q, --query <query>', 'Optional focus query for the story')
  .option('-o, --output-dir <dir>', 'Output directory', '.')
  .option('-c, --cache-repo <path>', 'Path to code-stories-cache repo for direct publishing')
  .option('-s, --slug <slug>', 'Story slug for the output filename')
  .addOption(
    new Option('--mode <mode>', 'Story generation mode (required)')
      .choices(['paper', 'textbook', 'webpage', 'collection'])
      .makeOptionMandatory(),
  )
  .option('--pdf <path>', 'Path to local PDF file (for paper or textbook mode)')
  .option(
    '--source <spec>',
    'A source for --mode collection, as <type>:<value> where type is arxiv|pdf|url. Repeatable.',
    (value, previous) => (previous || []).concat([value]),
    [],
  )
  .option('--models <overrides>', 'Override stage models, e.g. exploration=gpt-5.4,explanations=claude-sonnet-4-6')
  .action(async (source, options) => {
    try {
      options.config = mergeConfigs(
        loadDefaultConfig(),
        parseModelOverrides(options.models),
      );

      if (options.mode === 'collection') {
        if (source) {
          console.error('✗ Error: --mode collection takes sources via repeated --source flags, not a positional argument.');
          process.exit(1);
        }
        if (options.pdf) {
          console.error('✗ Error: --pdf cannot be used with --mode collection (use --source pdf:<path>).');
          process.exit(1);
        }
        if (!options.source || options.source.length < 2) {
          console.error('✗ Error: --mode collection requires at least two --source flags, e.g. --source arxiv:1706.03762 --source pdf:./ch3.pdf');
          process.exit(1);
        }
        await generateCollectionStory(options);
      } else if (options.mode === 'webpage') {
        if (!source) {
          console.error('✗ Error: --mode webpage requires a URL as the positional argument.');
          process.exit(1);
        }
        if (options.pdf) {
          console.error('✗ Error: --pdf cannot be used with --mode webpage.');
          process.exit(1);
        }
        await generateWebpageStory(source, options);
      } else {
        const inputCount = [Boolean(source), Boolean(options.pdf)].filter(Boolean).length;
        if (inputCount !== 1) {
          console.error('✗ Error: provide exactly one input: an arXiv URL/ID or --pdf <path>.');
          process.exit(1);
        }
        if (options.pdf) {
          await generateLocalStory(options);
        } else {
          await generateStory(source, options);
        }
      }
    } catch (err) {
      console.error(`\n✗ Error: ${err.message}`);
      process.exit(1);
    }
  });

program.parse();

/**
 * Generate a story from a webpage.
 */
async function generateWebpageStory(url, options) {
  const generationId = uuidv4();

  console.log(`\n🌐 Paper Stories Generator (webpage)`);
  console.log(`   URL: ${url}`);
  console.log(`   Query: ${options.query || '(comprehensive deep-dive)'}`);
  console.log(`   Generation ID: ${generationId}\n`);

  const workDir = join(resolve(options.outputDir), '.paper-stories-tmp', generationId);
  const generationDir = join(workDir, 'generation');
  mkdirSync(generationDir, { recursive: true });

  console.log('📥 Fetching webpage source...');
  const { sourceResult, metadata } = await prepareWebpage(url, workDir);

  const promptParts = buildPrompt({
    arxivId: null,
    arxivUrl: null,
    query: options.query,
    sourceDir: sourceResult.sourceDir,
    pdfPath: null,
    regionsPath: null,
    generationDir,
    title: metadata.title,
    sourceUrl: metadata.url,
    mode: options.mode,
  });

  await runGenerationPipeline({
    promptParts,
    generationDir,
    workDir,
    sourceResult,
    pdfPath: null,
    options,
    sourceType: 'webpage',
    sourceUrl: metadata.url,
  });
}

/**
 * Generate a story from a local PDF (textbook chapter, etc.)
 */
async function generateLocalStory(options) {
  const generationId = uuidv4();

  console.log(`\n📄 Paper Stories Generator (local PDF)`);
  console.log(`   PDF: ${resolve(options.pdf)}`);
  console.log(`   Query: ${options.query || '(comprehensive deep-dive)'}`);
  console.log(`   Generation ID: ${generationId}\n`);

  // Create working directory
  const workDir = join(resolve(options.outputDir), '.paper-stories-tmp', generationId);
  const generationDir = join(workDir, 'generation');
  mkdirSync(generationDir, { recursive: true });

  // Prepare local PDF
  console.log('📂 Preparing local sources...');
  const sourceResult = emptySourceResult();
  const pdfPath = prepareLocalPdf(options.pdf, workDir);

  // Extract PDF text regions
  let regionsPath = null;
  if (pdfPath) {
    console.log('📐 Extracting PDF text regions...');
    regionsPath = join(workDir, 'regions.json');
    if (!extractPdfRegions(pdfPath, regionsPath)) {
      regionsPath = null;
    }
  }

  // Build the prompt
  const promptParts = buildPrompt({
    arxivId: null,
    arxivUrl: null,
    query: options.query,
    sourceDir: sourceResult.hasSource ? sourceResult.sourceDir : null,
    pdfPath,
    regionsPath,
    generationDir,
    title: null,
    sourceUrl: null,
    mode: options.mode,
  });

  // Run the shared generation pipeline
  await runGenerationPipeline({
    promptParts,
    generationDir,
    workDir,
    sourceResult,
    pdfPath,
    options,
    sourceType: 'local',
    sourceUrl: null,
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
    if (!extractPdfRegions(pdfPath, regionsPath)) {
      regionsPath = null;
    }
  }

  // Build the prompt
  const promptParts = buildPrompt({
    arxivId,
    arxivUrl,
    query: options.query,
    sourceDir: sourceResult.hasSource ? sourceResult.sourceDir : null,
    pdfPath,
    regionsPath,
    generationDir,
    title: null,
    sourceUrl: arxivUrl,
    mode: options.mode,
  });

  // Run the shared generation pipeline
  await runGenerationPipeline({
    promptParts,
    generationDir,
    workDir,
    sourceResult,
    pdfPath,
    options,
    sourceType: 'arxiv',
    sourceUrl: arxivUrl,
  });
}

/**
 * Extract PDF text/image regions with PyMuPDF into regionsPath.
 * Returns true on success; logs a warning and returns false on failure so the
 * caller can proceed without bounding boxes.
 */
function extractPdfRegions(pdfPath, regionsPath) {
  const extractScript = join(__dirname, 'extract_regions.py');
  try {
    execFileSync('uv', ['run', extractScript, pdfPath, '-o', regionsPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const regions = JSON.parse(readFileSync(regionsPath, 'utf8'));
    const blockCount = regions.pages.reduce((sum, p) => sum + p.blocks.length, 0);
    console.log(`   ✓ Extracted ${blockCount} text blocks from ${regions.totalPages} pages`);
    return true;
  } catch (err) {
    console.warn(`   ⚠ Region extraction failed (story will proceed without bboxes): ${err.message}`);
    return false;
  }
}

/**
 * Prepare a single source for a collection story from a `<type>:<value>` spec.
 * Each source gets its own working directory so files/PDFs never collide.
 */
async function prepareCollectionSource(spec, id, sourceWorkDir) {
  const idx = spec.indexOf(':');
  if (idx < 0) {
    throw new Error(`Invalid --source "${spec}". Use <type>:<value>, e.g. arxiv:1706.03762, pdf:./ch3.pdf, url:https://...`);
  }
  const type = spec.slice(0, idx).trim().toLowerCase();
  const value = spec.slice(idx + 1).trim();
  mkdirSync(sourceWorkDir, { recursive: true });

  if (type === 'arxiv') {
    const arxivId = parseArxivId(value);
    const arxivUrl = `https://arxiv.org/abs/${arxivId}`;
    const [sourceResult, pdfPath] = await Promise.all([
      downloadLatexSource(arxivId, sourceWorkDir),
      downloadPdf(arxivId, sourceWorkDir),
    ]);
    return {
      id, type: 'arxiv', arxivId, arxivUrl, sourceUrl: arxivUrl,
      sourceResult, hasSource: sourceResult.hasSource,
      sourceDir: sourceResult.hasSource ? sourceResult.sourceDir : null, pdfPath,
    };
  }
  if (type === 'pdf') {
    const pdfPath = prepareLocalPdf(value, sourceWorkDir);
    return { id, type: 'local', sourceResult: emptySourceResult(), hasSource: false, sourceDir: null, pdfPath };
  }
  if (type === 'url') {
    const { sourceResult, metadata } = await prepareWebpage(value, sourceWorkDir);
    return {
      id, type: 'webpage', sourceUrl: metadata.url, title: metadata.title,
      sourceResult, hasSource: true, sourceDir: sourceResult.sourceDir, pdfPath: null,
    };
  }
  throw new Error(`Unknown source type "${type}" in --source "${spec}". Use arxiv, pdf, or url.`);
}

/**
 * Generate a story that synthesizes multiple mixed sources (arXiv + PDF + webpage).
 */
async function generateCollectionStory(options) {
  const generationId = uuidv4();

  console.log(`\n📚 Paper Stories Generator (collection — ${options.source.length} sources)`);
  for (const spec of options.source) console.log(`   • ${spec}`);
  console.log(`   Query: ${options.query || '(comprehensive cross-source deep-dive)'}`);
  console.log(`   Generation ID: ${generationId}\n`);

  const workDir = join(resolve(options.outputDir), '.paper-stories-tmp', generationId);
  const generationDir = join(workDir, 'generation');
  mkdirSync(generationDir, { recursive: true });

  // Fetch every source into its own subdirectory in parallel (downloads are the
  // slow, independent part). Region extraction is a synchronous subprocess, so
  // run it afterwards in order to keep its logging readable.
  console.log(`📥 Preparing ${options.source.length} sources...`);
  const sources = await Promise.all(
    options.source.map((spec, i) =>
      prepareCollectionSource(spec, `s${i + 1}`, join(workDir, 'sources', `s${i + 1}`)),
    ),
  );
  for (const prepared of sources) {
    if (!prepared.pdfPath) continue;
    console.log(`📐 Extracting PDF text regions for ${prepared.id}...`);
    const regionsPath = join(workDir, 'sources', prepared.id, 'regions.json');
    if (extractPdfRegions(prepared.pdfPath, regionsPath)) prepared.regionsPath = regionsPath;
  }

  const failedSources = sources
    .map((s, i) => ({ s, spec: options.source[i] }))
    .filter(({ s }) => !s.hasSource && !s.pdfPath);
  if (failedSources.length > 0) {
    const list = failedSources.map(({ s, spec }) => `${s.id} (${spec})`).join(', ');
    throw new Error(
      `The following source(s) failed to yield readable content: ${list}. ` +
      `All sources must be readable before generation can start.`,
    );
  }

  const promptParts = buildCollectionPrompt({ sources, query: options.query, generationDir });

  const pdfArtifacts = sources
    .filter(s => s.pdfPath)
    .map(s => ({ sourceId: s.id, path: s.pdfPath }));

  await runGenerationPipeline({
    promptParts,
    generationDir,
    workDir,
    options,
    sourceType: 'collection',
    sourceUrl: null,
    addDirs: [generationDir, workDir],
    pdfArtifacts,
  });
}

/**
 * Shared generation pipeline: prompt stages → configured agents → validate → save.
 *
 * @param {Object}   args
 * @param {string[]} [args.addDirs]      - Directories to grant the agents. Defaults to those
 *                                         derived from sourceResult/pdfPath (single-source flows).
 * @param {Array<{sourceId: string|null, path: string}>} [args.pdfArtifacts]
 *                                         - PDFs to publish alongside the story. For collection
 *                                           stories there is one per source; for single-source
 *                                           flows it defaults to the single pdfPath (sourceId null).
 */
async function runGenerationPipeline({ promptParts, generationDir, workDir, sourceResult, pdfPath, options, sourceType, sourceUrl, addDirs, pdfArtifacts }) {
  const { shared, stages: stageInstructions } = promptParts;

  // Directories the per-stage agents are allowed to read.
  const dirs = addDirs || [
    generationDir,
    ...(sourceResult?.hasSource ? [sourceResult.sourceDir] : []),
    ...(pdfPath ? [workDir] : []),
  ];
  // PDFs to copy out at publish/save time.
  const artifacts = pdfArtifacts || (pdfPath ? [{ sourceId: null, path: pdfPath }] : []);

  // Write the full prompt (shared prefix + every stage block) for debugging.
  const debugPrompt = [shared, ...Object.entries(stageInstructions).map(([k, v]) => `\n\n=== STAGE: ${k} ===\n${v}`)].join('');
  writeFileSync(join(generationDir, '_prompt.md'), debugPrompt);

  console.log('\n🤖 Launching configured story generation stages...\n');

  const spinner = ora({
    text: 'Stage 0: Indexing source...',
    color: 'cyan',
  }).start();

  // A stage is complete when its expected artifact exists and is well-formed:
  // structured stages must produce parseable JSON with the expected top-level
  // key; the prose/marker stages keep the original sentinel-string check. This
  // is stricter than the old substring marker (a half-written JSON file fails).
  const jsonComplete = (key) => (p) => fileIsJsonWith(p, key);
  const markerComplete = (marker) => (p) => hasMarker(p, marker);

  const stages = [
    { key: 'index', output: 'index.json', label: 'Stage 0: Indexing source...', isComplete: jsonComplete('segments') },
    { key: 'exploration', output: 'exploration.md', label: 'Stage 1: Exploring sources...', isComplete: markerComplete('EXPLORATION_COMPLETE') },
    { key: 'outline', output: 'outline.json', label: 'Stage 2: Planning chapter outline...', isComplete: jsonComplete('chapters') },
    { key: 'excerpts', output: 'excerpts.json', label: 'Stage 3: Collecting excerpts...', isComplete: jsonComplete('chapters') },
    { key: 'verification', output: 'verification.json', label: 'Stage 4: Verifying excerpts against source...', isComplete: jsonComplete('chapters') },
    { key: 'explanations', output: 'explanations.json', label: 'Stage 5: Writing explanations...', isComplete: jsonComplete('chapters') },
    { key: 'assemble', output: 'DONE', label: 'Stage 6: Assembling final story...', isComplete: markerComplete('DONE') },
  ];

  // Per-stage token usage, collected for story.generation so the viewer can
  // surface model + token cost per stage on the overview page.
  const stageUsages = [];

  try {
    for (const stage of stages) {
      const model = options.config.models[stage.key];
      spinner.text = `${stage.label} [${model}]`;
      const expectedPath = join(generationDir, stage.output);
      const { usage } = await runConfiguredStage({
        prompt: buildStagePrompt(shared, stageInstructions[stage.key]),
        model,
        dirs,
        workDir,
        expectedPath,
        isComplete: () => stage.isComplete(expectedPath),
        stageLabel: stage.label,
      });
      stageUsages.push({ key: stage.key, model: model ?? null, ...normalizeUsage(usage) });
    }
  } catch (err) {
    spinner.fail('Generation failed');
    throw err;
  }

  // Check for story.json
  const storyPath = join(generationDir, 'story.json');
  if (!existsSync(storyPath)) {
    spinner.fail('The assemble stage did not produce a story.json');
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

  // Attach per-stage token usage + totals so the viewer can show how the story
  // was generated (model + tokens per stage) on its first page.
  story.generation = buildGenerationStats(stageUsages);

  // Record which chat model this story was built with so the viewer can use
  // the same model for routing and labeling regardless of startup config.
  story.chatModel = options.config.models.chat ?? null;
  if (sourceType && !story.sourceType) story.sourceType = sourceType;
  if (sourceUrl && !story.sourceUrl) story.sourceUrl = sourceUrl;

  spinner.succeed(`Story generated: "${story.title}" (${story.chapters.length} chapters)`);

  const slug = options.slug || slugify(story.title);
  // Resolve final PDF filenames (and wire them into story.sources[].pdfFile for
  // multi-source stories) before writing the story JSON anywhere.
  const pdfOutputs = assignPdfFilenames(story, slug, artifacts);

  // Publish to cache repo if specified
  if (options.cacheRepo) {
    await publishToCache(story, slug, options.cacheRepo, pdfOutputs);
  } else {
    const outputPath = join(resolve(options.outputDir), `${slug}.json`);
    story.id = slug;
    writeFileSync(outputPath, JSON.stringify(story, null, 2));
    for (const { path: srcPath, filename } of pdfOutputs) {
      const pdfOutputPath = join(resolve(options.outputDir), filename);
      copyFileSync(srcPath, pdfOutputPath);
      console.log(`✓ PDF saved to: ${pdfOutputPath}`);
    }
    console.log(`\n✓ Story saved to: ${outputPath}`);
  }

  console.log(`\n📁 Generation files kept at: ${generationDir}`);
}

/**
 * Decide the published filename for each PDF artifact and, for multi-source
 * stories, record it on the matching `story.sources[].pdfFile` so the viewer
 * can load the right PDF per excerpt. Returns [{ path, filename }] for copying.
 *
 * Single-source artifacts (sourceId null) keep the legacy `<slug>.pdf` name.
 */
function assignPdfFilenames(story, slug, artifacts) {
  const outputs = [];
  for (const { sourceId, path: srcPath } of artifacts) {
    if (!srcPath || !existsSync(srcPath)) continue;
    const filename = sourceId ? `${slug}-${sourceId}.pdf` : `${slug}.pdf`;
    outputs.push({ path: srcPath, filename });
    if (sourceId && Array.isArray(story.sources)) {
      const src = story.sources.find(s => s.id === sourceId);
      if (src) src.pdfFile = filename;
    }
  }
  return outputs;
}

function buildStagePrompt(shared, stageInstructions) {
  // Shared prefix first — byte-identical across stages so the model's prompt
  // cache can reuse it on back-to-back runs — then ONLY this stage's block.
  return `${shared}

## Current Stage Execution
Run ONLY the stage below. Preserve the schema and constraints from the instructions above, but do not
perform any other stage. When done, write exactly the file(s) the stage names — nothing else.

${stageInstructions}`;
}

function runConfiguredStage({ prompt, model, dirs, workDir, expectedPath, isComplete, stageLabel }) {
  if (model?.startsWith('claude-')) {
    return runClaudeStage({ prompt, model, dirs, expectedPath, isComplete, stageLabel });
  }
  return runCodexStage({ prompt, model, dirs, cwd: workDir, expectedPath, isComplete, stageLabel });
}

function runClaudeStage({ prompt, model, dirs, expectedPath, isComplete, stageLabel }) {
  const allowedTools = 'Read,Grep,Glob,Write';
  // --output-format json makes the final stdout a single JSON envelope carrying
  // the run's token usage, which we parse for per-stage token tracking. Content
  // is written to files by the agent, so this only changes stdout.
  const args = ['-p', '--output-format', 'json', '--allowedTools', allowedTools];
  if (model) args.push('--model', model);
  for (const dir of dirs) args.push('--add-dir', dir);

  return runAgentProcess({
    command: 'claude',
    args,
    prompt,
    cwd: process.cwd(),
    expectedPath,
    isComplete,
    stageLabel,
    model,
    runner: 'claude',
    notFoundMsg: 'Claude CLI not found. Install it with: npm install -g @anthropic-ai/claude-code',
  });
}

function runCodexStage({ prompt, model, dirs, cwd, expectedPath, isComplete, stageLabel }) {
  const args = ['exec'];
  if (model) args.push('--model', model);
  args.push('--sandbox', 'danger-full-access', '-C', cwd);
  for (const dir of dirs) args.push('--add-dir', dir);
  args.push('-');

  return runAgentProcess({
    command: 'codex',
    args,
    prompt,
    cwd,
    expectedPath,
    isComplete,
    stageLabel,
    model,
    runner: 'codex',
    notFoundMsg: 'Codex CLI not found. Install it with: npm install -g @openai/codex',
  });
}

function runAgentProcess({ command, args, prompt, cwd, expectedPath, isComplete, stageLabel, model, runner, notFoundMsg }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;
    delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
    delete cleanEnv.CLAUDE_CODE_SESSION;

    const proc = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
      env: cleanEnv,
    });

    let settled = false;
    let stdout = '';
    let stderr = '';

    const cleanup = () => {
      proc.kill('SIGTERM');
      process.exit(1);
    };
    const clearHandlers = () => {
      process.off('SIGINT', cleanup);
      process.off('SIGTERM', cleanup);
    };
    const settle = (error, value) => {
      if (settled) return;
      settled = true;
      clearHandlers();
      if (error) rejectPromise(error);
      else resolvePromise(value);
    };

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      // Best-effort token accounting; never let a usage-parse failure fail a stage.
      const usage = parseStageUsage(stdout, runner);
      if (isComplete()) {
        settle(null, { stdout, stderr, usage });
        return;
      }

      let message = `${stageLabel} did not produce a well-formed ${basename(expectedPath)} (exit code: ${code})`;
      if (model) message += ` [model: ${model}]`;
      if (stderr) message += `\nstderr: ${stderr.slice(0, 500)}`;
      if (stdout) message += `\nstdout: ${stdout.slice(0, 500)}`;
      settle(new Error(message));
    });

    proc.on('error', (err) => {
      settle(new Error(err.code === 'ENOENT' ? notFoundMsg : `Failed to spawn ${command}: ${err.message}`));
    });

    proc.stdin.on('error', () => {
      // The process exited before the prompt was fully written; close/error will settle.
    });
    proc.stdin.write(prompt);
    proc.stdin.end();

    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
  });
}

function hasMarker(filePath, marker) {
  if (!existsSync(filePath)) return false;
  try {
    return readFileSync(filePath, 'utf8').includes(marker);
  } catch {
    return false;
  }
}

/**
 * A structured stage is complete only when its output file exists AND parses as
 * JSON AND carries the expected top-level key. This is stricter than a substring
 * marker: a half-written or truncated JSON file is treated as a failed stage.
 */
function fileIsJsonWith(filePath, requiredKey) {
  if (!existsSync(filePath)) return false;
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    if (requiredKey && (data === null || typeof data !== 'object' || !(requiredKey in data))) return false;
    return true;
  } catch {
    return false;
  }
}

async function publishToCache(story, slug, cacheRepoPath, pdfOutputs) {
  const storiesDir = join(cacheRepoPath, 'stories');
  if (!existsSync(storiesDir)) {
    throw new Error(`Cache repo stories directory not found: ${storiesDir}`);
  }

  story.id = slug;

  const storyPath = join(storiesDir, `${slug}.json`);
  writeFileSync(storyPath, JSON.stringify(story, null, 2));

  for (const { path: srcPath, filename } of pdfOutputs || []) {
    if (!existsSync(srcPath)) continue;
    const pdfOutputPath = join(storiesDir, filename);
    copyFileSync(srcPath, pdfOutputPath);
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
