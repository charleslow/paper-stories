/**
 * Paper Stories generation prompt.
 *
 * Sent to Claude/Codex to generate a story.json from paper/textbook/webpage sources.
 * The prompt enforces source fidelity — all excerpts must be verbatim from the source.
 *
 * Token-efficiency design
 * -----------------------
 * The pipeline runs as independent subprocesses, one per stage. To avoid paying
 * for the full multi-stage instruction set on every stage, both builders return
 * a structured `{ shared, stages }` object instead of one monolithic string:
 *
 *   - `shared`  — the byte-identical preamble (role, mode, source pointers, the
 *                 no-hallucination rule, the artifact map). It is placed FIRST in
 *                 every stage prompt so the identical prefix can be reused by the
 *                 model's prompt cache across back-to-back stages.
 *   - `stages`  — one instruction block per stage. Only the current stage's block
 *                 is appended, so a stage never carries instructions for stages it
 *                 won't run.
 *
 * Stages hand off through structured JSON files (index.json, outline.json,
 * excerpts.json, verification.json, explanations.json) keyed by chapter, plus a
 * grep-able `index.json` source map, so later stages read only what they need
 * instead of re-scanning the whole source.
 *
 * Claude adapts its pacing and style based on the source material:
 * - Research papers → focused deep-dive, ~20 chapters
 * - Textbook chapters → slower pedagogical walkthrough, 30-40 chapters
 */

/**
 * Shared "how to use the source index" note included in every stage's preamble.
 * The index uses line numbers as hard demarcators for text files (.tex/.md) so
 * downstream stages can Read exact ranges without Grep. For PDF-only sources the
 * index is skipped and segments is an empty array.
 */
const INDEX_USAGE = `## Source Index (index.json)
Stage 0 writes a structured map of the source to \`index.json\` in the generation directory.
Every later stage should read it FIRST to navigate the source instead of re-reading everything.
When indexing was possible (text source available), each entry in \`segments\` has:
- \`id\` — stable short id (e.g. "seg-12")
- \`kind\` — section | subsection | definition | theorem | lemma | proof | equation | figure | table | other
- \`label\` — human label (e.g. "Section 3.2", "Theorem 1", "Figure 4")
- \`sourceFile\` — relative path to the .tex or .md file the segment lives in
- \`lineStart\` / \`lineEnd\` — EXACT 1-indexed line range in sourceFile. Pull a segment with
  Read(sourceFile, { offset: lineStart - 1, limit: lineEnd - lineStart + 1 }).
- \`page\` — 0-indexed PDF page if known (optional)
When \`index.json\` carries \`"indexSkipped": true\` or an empty \`segments\` array, no text source
was available — navigate the PDF or source files directly without an index.`;

/**
 * Build the generation prompt for a multi-source ("collection") story that
 * weaves together several papers / PDFs / webpages and cites all of them.
 *
 * Returns `{ shared, stages }` driving the SAME seven stages (index → exploration
 * → outline → excerpts → verification → explanations → assemble) as buildPrompt()
 * so the pipeline in index.js can run it stage-by-stage unchanged. The key
 * differences from single-source mode:
 *   - a top-level `sources` array is emitted (summarized "at the front")
 *   - every excerpt carries a `sourceId` tying it back to one source
 *   - each source has its own files, PDF, and regions index; `pdfRegion.page`
 *     is relative to that source's PDF, and index.json segments carry `sourceId`
 *
 * @param {Object}   args
 * @param {Array}    args.sources       - per-source descriptors (see index.js)
 * @param {string}   [args.query]
 * @param {string}   args.generationDir
 */
export function buildCollectionPrompt({ sources, query, generationDir }) {
  const sourceBlocks = sources.map((s, i) => {
    const lines = [`### Source ${i + 1} — id: \`${s.id}\` (type: ${s.type})`];
    if (s.arxivId) lines.push(`- arXiv ID: ${s.arxivId}`);
    if (s.sourceUrl || s.arxivUrl) lines.push(`- URL: ${s.sourceUrl || s.arxivUrl}`);
    if (s.title) lines.push(`- Title hint: ${s.title}`);
    if (s.type === 'webpage') {
      lines.push(`- Webpage bundle dir: ${s.sourceDir} (read page.md, page-metadata.json, page.html)`);
    } else if (s.hasSource) {
      lines.push(`- LaTeX source dir: ${s.sourceDir} (PRIMARY — Glob/Read/Grep the .tex files)`);
    }
    if (s.pdfPath) {
      lines.push(`- PDF: ${s.pdfPath}${s.hasSource ? ' (SECONDARY — figures/tables context)' : ' (PRIMARY source)'}`);
    }
    if (s.regionsPath) {
      lines.push(`- PDF regions index: ${s.regionsPath} (text + image blocks with normalized bboxes; pages are relative to THIS source's PDF)`);
    }
    if (!s.hasSource && s.type !== 'webpage' && !s.pdfPath) {
      lines.push('- (no readable source files were available for this entry)');
    }
    return lines.join('\n');
  }).join('\n\n');

  const idList = sources.map(s => `\`${s.id}\``).join(', ');

  const shared = `You are a Paper Stories generator working in MULTI-SOURCE mode. Your job is to create a single,
coherent walkthrough that synthesizes and cross-references SEVERAL sources, citing each one.

## Story Mode: Collection (multiple sources)

- Tone: A knowledgeable colleague guiding the reader across a set of related sources — drawing
  connections, contrasts, and a throughline that no single source provides on its own.
- The story is NOT a sequence of independent summaries. Build one narrative that braids the sources
  together: introduce a problem, then pull the relevant idea/equation/result from whichever source
  addresses it, comparing and contrasting as you go.
- Pace: 12-25 chapters depending on how many sources there are and their density.
- Structure: Overview (introduce ALL sources and the throughline) → shared background → each major
  theme/idea (pulling excerpts from whichever sources are relevant) → comparisons/tensions between
  sources → synthesis → Summary.
- Per-chapter length: Overview/Summary 250-400 words, others 150-300 words.
- Excerpts: 1-3 per chapter (first and last chapters have 0). A chapter MAY mix excerpts from
  different sources when comparing them.

## Sources
You are given ${sources.length} sources. Use EXACTLY these ids (${idList}) — do not invent new ids.
Every excerpt you collect MUST be tagged with the \`sourceId\` of the source it came from.

${sourceBlocks}

- User query: ${query || '(none — synthesize a comprehensive cross-source deep-dive)'}

## Generation Directory
Write all intermediate and final files to: ${generationDir}

${INDEX_USAGE}
In collection mode every index.json segment ALSO carries a \`sourceId\` (one of ${idList}) and its
\`page\` is relative to that source's own PDF.

## CRITICAL RULE: NO HALLUCINATION
Every excerpt you include MUST be grounded in ONE specific source's files.
- \`latexSource\` must be copied VERBATIM from that source — character for character (for webpages, the
  raw quote from page.md or page.html; for PDF-only sources, faithfully transcribed from the PDF).
- Text excerpts: \`content\` is the exact quote with LaTeX artifacts cleaned (drop \\cite/\\ref/\\label,
  KEEP inline math like \`$x$\`).
- Equation excerpts: \`content\` is KaTeX-renderable LaTeX, mathematically equivalent to the source.
- NEVER attribute a quote to the wrong source. \`sourceId\` must match where \`latexSource\` actually lives.
- Do NOT invent claims, equations, or cross-source comparisons not supported by the sources.

## Pipeline & Artifacts
Each stage reads the prior artifacts and writes its own. You run exactly ONE stage per invocation —
do not perform other stages. The hand-off files (relative to the generation directory):
- \`index.json\`        (Stage 0) — grep-anchored source map, segments tagged with sourceId
- \`exploration.md\`    (Stage 1) — per-source findings + a Connections section
- \`outline.json\`      (Stage 2) — chapter plan referencing index segment ids
- \`excerpts.json\`     (Stage 3) — collected excerpts keyed by chapter
- \`verification.json\` (Stage 4) — verified/corrected excerpts keyed by chapter
- \`explanations.json\` (Stage 5) — chapter explanations keyed by chapter
- \`story.json\` + \`DONE\` (Stage 6) — final assembled story`;

  const stages = {
    index: `### Stage 0: Source Index
Build a line-demarcated map of every source that has text files (.tex or .md) so later stages can
navigate without re-reading everything. For PDF-only sources, skip segments (they will be read
directly from the PDF). Read each text source in turn and catalogue its segments: sections,
definitions, theorems, lemmas, key equations, figures, tables. For EACH segment record \`id\`, \`kind\`,
\`label\`, \`sourceId\` (one of ${idList}), \`sourceFile\`, \`lineStart\`/\`lineEnd\` (EXACT 1-indexed line
range — later stages use Read(sourceFile, { offset: lineStart - 1, limit: lineEnd - lineStart + 1 })),
and \`page\` (0-indexed in THAT source's PDF) when known. Also extract per source: title, authors (as
written), publication month+year, and institutions.
Write valid JSON to ${generationDir}/index.json:
\`\`\`json
{
  "sources": [
    { "id": "<one of ${idList}>", "title": "", "authors": [], "publishedYear": null, "publishedMonth": null, "institutions": [] }
  ],
  "segments": [
    { "id": "seg-1", "kind": "theorem", "label": "Theorem 1", "sourceId": "s1", "sourceFile": "main.tex", "lineStart": 87, "lineEnd": 142, "page": null }
  ]
}
\`\`\`
Output ONLY valid JSON to the file (no prose, no markers).`,

    exploration: `### Stage 1: Source Exploration
Read ${generationDir}/index.json FIRST to orient, then read the regions of each source that matter.
- Explore EACH source in turn (read its .tex / page.md / PDF), navigating via index line ranges when available.
- For EACH source confirm: a concise title, authors (as written), publication month+year, and
  institutions/affiliations if listed.
- Note the throughline: what connects these sources? Where do they agree, differ, or build on each other?
- Write findings to ${generationDir}/exploration.md, organized per source plus a "Connections" section.
- End the file with the line: EXPLORATION_COMPLETE`,

    outline: `### Stage 2: Chapter Outline
Read ${generationDir}/index.json and ${generationDir}/exploration.md first. Design chapters per the
Collection structure above. First chapter = Overview (no excerpts, introduces all sources). Last
chapter = Summary (no excerpts). One clear teaching point per chapter; chapter labels 2-4 words. For
each chapter note which source(s) and which index segment ids it will draw excerpts from.
Write valid JSON to ${generationDir}/outline.json:
\`\`\`json
{
  "chapters": [
    { "id": "chapter-0", "label": "Overview", "teachingPoint": "", "segmentIds": [], "sourceIds": [] }
  ]
}
\`\`\`
Output ONLY valid JSON to the file.`,

    excerpts: `### Stage 3: Excerpt Collection
Read ${generationDir}/index.json and ${generationDir}/outline.json first. For each chapter, collect
1-3 excerpts (first and last chapters: 0). For each planned segment, Read its \`sourceFile\` at the
given \`lineStart\`/\`lineEnd\` range; fall back to Grep when no index segment exists (PDF-only sources).
Each excerpt is one of: \`text\`, \`equation\`, or \`figure\`. For EACH excerpt:
1. Read the specific source file containing it (use the index line range, or Grep for PDF-only sources).
2. Copy the EXACT raw source into \`latexSource\` — character for character.
3. Set \`sourceId\` to that source's id, and \`sourceFile\` to the relative path within that source.
4. Write a KaTeX-renderable \`content\` (clean text for text/figure caption; pure KaTeX LaTeX for equation).
5. PDF region mapping: if the source has a regions index, find the matching block and set
   \`pdfRegion\` to \`{ "page": <0-indexed page in THAT source's PDF>, "bbox": [x0,y0,x1,y1] }\`. Omit if no match.
   For figure excerpts, match against \`type: "image"\` blocks near the caption.
- text vs equation: if prose and math are mixed, use \`text\` (it renders \`$...$\` and \`$$...$$\`).
- For webpage figure excerpts, set \`visualUrl\` to a real image URL from that source's page-metadata.json.
Write valid JSON to ${generationDir}/excerpts.json:
\`\`\`json
{
  "chapters": [
    { "id": "chapter-1", "excerpts": [ { "content": "", "latexSource": "", "type": "text", "sourceId": "s1", "sourceFile": "", "label": "", "visualUrl": null, "pdfRegion": null } ] }
  ]
}
\`\`\`
Output ONLY valid JSON to the file.`,

    verification: `### Stage 4: Verification
Read ${generationDir}/excerpts.json. For EVERY excerpt: confirm \`latexSource\` exists verbatim in the
source named by its \`sourceId\` (Grep the .tex files / page.md / re-read the PDF page). Confirm the
\`sourceId\` is correct — a quote attributed to the wrong source is a hallucination and must be fixed or
removed. For equations, confirm \`content\` is mathematically equivalent to \`latexSource\`. Remove or
replace any excerpt that cannot be verified.
Write the verified/corrected excerpts (SAME shape as excerpts.json) to ${generationDir}/verification.json.
Output ONLY valid JSON to the file.`,

    explanations: `### Stage 5: Explanation Writing
Read ${generationDir}/outline.json and ${generationDir}/verification.json. Write each chapter's
explanation markdown. Make explanations self-contained (inline the key idea; do not write "as shown in
the excerpt above"). Ground formalism in intuition. Use KaTeX ($...$ inline, $$...$$ display).
Cross-reference chapters AND sources by name ("Whereas Source A frames this as..., Source B..."). When a
chapter draws on multiple sources, make the comparison explicit. Interpret, don't just describe.
Write valid JSON to ${generationDir}/explanations.json:
\`\`\`json
{ "chapters": [ { "id": "chapter-0", "explanation": "" } ] }
\`\`\`
Output ONLY valid JSON to the file.`,

    assemble: `### Stage 6: Final Assembly
Read ${generationDir}/index.json, ${generationDir}/outline.json, ${generationDir}/verification.json,
and ${generationDir}/explanations.json, then assemble everything into ${generationDir}/story.json with
this schema:
\`\`\`json
{
  "id": "<generated-uuid>",
  "title": "<Concise title for the combined story>",
  "arxivId": null,
  "arxivUrl": null,
  "sourceType": "collection",
  "sources": [
    {
      "id": "<one of ${idList}>",
      "type": "<arxiv|local|webpage>",
      "title": "<source title>",
      "authors": ["<Author One>"],
      "url": "<arXiv/webpage URL or null>",
      "arxivId": "<arXiv id or null>",
      "publishedYear": <int or null>,
      "publishedMonth": <int 1-12 or null>,
      "institutions": ["<Institution>"]
    }
  ],
  "query": ${JSON.stringify(query || null)},
  "createdAt": "<ISO-8601 timestamp>",
  "chapters": [
    {
      "id": "chapter-0",
      "label": "<2-4 word label>",
      "excerpts": [
        {
          "content": "<display text / KaTeX equation>",
          "latexSource": "<verbatim raw source>",
          "type": "<text|equation|figure>",
          "sourceId": "<which source — REQUIRED>",
          "sourceFile": "<relative path within that source>",
          "label": "<e.g. 'Section 3.2' or 'Equation 5'>",
          "visualUrl": "<optional image URL for webpage figures>",
          "pdfRegion": { "page": 0, "bbox": [0.1, 0.2, 0.9, 0.35] }
        }
      ],
      "explanation": "<Markdown + KaTeX>"
    }
  ]
}
\`\`\`

**Validation before writing:**
1. \`sources\` includes EVERY id in ${idList}, each with a title (authors/year/institutions where known).
2. Every non-Overview/Summary excerpt has a \`sourceId\` that appears in \`sources\`.
3. Every excerpt's \`latexSource\` is non-empty and came from verification.json.
4. First (Overview) and last (Summary) chapters have \`excerpts: []\`; all others have 1-3 excerpts.
5. Chapter ids are sequential (chapter-0, chapter-1, ...); labels are 2-4 words.
6. All KaTeX is valid; no hallucinated claims; no \`pdfRegion\` unless it came from a regions index.
7. Do NOT set \`pdfFile\` on sources — the CLI fills that in after assembly.

Write ${generationDir}/story.json, then create ${generationDir}/DONE containing exactly "DONE".`,
  };

  return { shared, stages };
}

export function buildPrompt({
  arxivId,
  arxivUrl,
  query,
  sourceDir,
  pdfPath,
  regionsPath,
  generationDir,
  title,
  sourceUrl: providedSourceUrl,
  mode,
}) {
  const hasSource = !!sourceDir;
  const hasPdf = !!pdfPath;
  const hasRegions = !!regionsPath;
  const sourceUrl = providedSourceUrl || arxivUrl || null;
  const isWebpage = mode === 'webpage';
  // Source identification
  const sourceIdentification = isWebpage
    ? `- Source: Webpage\n- URL: ${sourceUrl}\n- Title: ${title || 'Detect from webpage metadata and content'}`
    : arxivId
    ? `- arXiv ID: ${arxivId}\n- URL: ${arxivUrl}`
    : `- Source: Local PDF${hasSource ? ' + LaTeX' : ''}\n- Title: Detect from source content (use the document's own title, chapter heading, or create a concise descriptive title)`;

  const sourceInstructions = isWebpage
    ? `The fetched webpage source bundle is available at: ${sourceDir}
Use Read tools to inspect:
- page.md: readable extracted text, headings, captions, and image candidates
- page-metadata.json: canonical URL, title, description, author/date if detected, headings, and image URLs
- page.html: raw HTML fallback for exact source verification

The webpage files are your PRIMARY source of truth.`
    : hasSource
    ? `The source's LaTeX files are available at: ${sourceDir}
Use Glob and Read tools to explore and read them. These are your PRIMARY source of truth.`
    : `No LaTeX source is available.`;

  const pdfInstructions = hasPdf
    ? `The PDF is available at: ${pdfPath}
Use Read tool to read it. ${hasSource ? 'Use this as a SECONDARY source for figures/tables context.' : 'This is your PRIMARY source.'}`
    : '';

  const regionsInstructions = hasRegions
    ? `\nA pre-extracted PDF regions index is available at: ${regionsPath}
This file contains text blocks and image blocks with normalized bounding boxes for every page of the PDF.
Each block has a \`type\` field: "text" (with a \`text\` field) or "image" (bounding box only — for embedded figures/charts/diagrams).
Use this to assign \`pdfRegion\` fields to excerpts (see Stage 3 for details).`
    : '';

  // Mode-specific story instructions — only the relevant mode is included in the prompt.
  const modeSection = mode === 'paper'
    ? `## Story Mode: Research Paper

- Tone: Knowledgeable colleague explaining the paper — technical but accessible
- Assume the reader has ML background but hasn't read this paper
- Pace: ~20 chapters for a comprehensive deep-dive, 8-15 for focused queries, up to 25 for dense papers
- Structure: Overview → Problem → Related Work → Key Insight → Methodology → Experiments → Ablations → Limitations → Summary
- Per-chapter length: Overview/Summary 200-300 words, Methodology 150-250, Results 100-200, Others 120-200
- Excerpts: Exactly 1 per chapter (first and last chapters have 0)`
    : mode === 'textbook'
    ? `## Story Mode: Textbook Chapter

- Tone: Patient teacher explaining to a motivated student — clear, encouraging, thorough
- Assume the reader has basic mathematical maturity but is learning this topic for the first time
- The goal is NOT to replace the textbook, but to provide a guided tour of key concepts so the reader can "clear" the material much faster on a second read-through
- **Go slowly.** It is better to have too many chapters than to rush through a concept. Aim for **30-40 chapters**.
- **Motivate concepts well.** Before introducing a definition or theorem, explain WHY it matters and what problem it solves.
- **Cover thoroughly:** Key definitions, theorems, proofs (sketch the intuition), and core ideas should each get their own chapter. One teaching point per chapter.
- **Build incrementally.** Use "As we saw in Chapter N..." connections.
- **Include 1-3 insightful questions** at the end of the story (in the Summary chapter's explanation). Format as "**Questions to consider:**". These can be drawn from good exercises in the source or created to test genuine understanding and invite deeper thinking. These should NOT be trivial recall.
- **Exercises:** If the source contains good exercises, reference them and hint at the approach without giving away the solution.
- Structure: Overview → Motivation → Definitions (one per chapter) → Key Ideas → Theorems (one per chapter) → Examples → Connections → Summary
- Per-chapter length: Overview/Summary 200-350 words, Definitions 200-300, Theorems 250-400, Examples 150-250, Others 150-250
- Excerpts: 1-3 per chapter (first and last chapters have 0). Use multiple when a chapter covers definition + example, or theorem + proof step.
- **Proof excerpts (use sparingly)**: For at most 1-2 chapters where the proof technique *itself* is the key insight (not just the result), you may use a \`proof\` excerpt type. See Stage 3 for the format. If in doubt, skip it — a prose explanation in the chapter's \`explanation\` field is almost always sufficient.`
    : `## Story Mode: Webpage Guide

- Tone: Clear technical guide through the page, using the page's own structure and claims as anchors
- Assume the reader wants the page's ideas unpacked without losing source fidelity
- Pace: 8-20 chapters depending on density; use fewer chapters for short posts and more for long technical pages
- Structure: Overview → Context → Main Ideas → Diagrams/Examples → Implications → Caveats → Summary
- Per-chapter length: 150-300 words, with longer chapters only when the webpage has dense technical arguments
- Excerpts: 1-3 per chapter (first and last chapters have 0). Use multiple excerpts when pairing prose with a diagram, table, or example.
- Diagrams/images: Use image candidates from \`page-metadata.json\` when they are central to understanding. For such excerpts, use \`type: "figure"\`, set \`visualUrl\` to the absolute image URL, and set \`content\` to the image caption, alt text, or nearby explanatory sentence.`;

  // Schema: use arxivId/arxivUrl if available, otherwise use source metadata.
  const schemaFields = isWebpage
    ? `"arxivId": null,
  "arxivUrl": null,
  "sourceType": "webpage",
  "sourceUrl": "${sourceUrl}",`
    : arxivId
    ? `"arxivId": "${arxivId}",
  "arxivUrl": "${arxivUrl}",`
    : `"arxivId": null,
  "arxivUrl": null,
  "sourceType": "local",`;

  const sourceWord = isWebpage ? 'webpage file' : hasSource ? '.tex file' : 'PDF page';
  const rawWord = isWebpage ? 'webpage text/HTML' : hasSource ? 'LaTeX' : 'text';

  const shared = `You are a Paper Stories generator. Your job is to create a deep, technically rigorous walkthrough
of the source material, structured as an interactive story.

${modeSection}

## Source
${sourceIdentification}
- User query: ${query || '(none — generate a comprehensive deep-dive)'}

## Source Materials
${sourceInstructions}
${pdfInstructions}${regionsInstructions}

## Generation Directory
Write all intermediate and final files to: ${generationDir}

${INDEX_USAGE}

## CRITICAL RULE: NO HALLUCINATION
Every excerpt you include MUST be grounded in the source files.
- The \`latexSource\` field must be copied VERBATIM from the source files — character for character
- Text excerpts: \`content\` should be the exact quote with minor LaTeX artifacts cleaned (remove \\cite, \\ref, \\label, but KEEP inline math like \`$x$\`)
- Equation excerpts: \`content\` should be KaTeX-renderable LaTeX, mathematically equivalent to the raw source (you may adapt syntax for KaTeX compatibility)
- You must NOT invent equations or claims not present in the source
- Each excerpt MUST include the source file and a \`latexSource\` field showing the raw source quote
${isWebpage ? `\nFor webpage stories:
- Treat \`latexSource\` as the raw source quote from \`page.md\` or \`page.html\`, even though it is not LaTeX
- Prefer exact passages from \`page.md\` for text excerpts
- Use \`page-metadata.json\` for canonical URL, author/date hints, headings, and image candidates
- Use \`visualUrl\` only for image URLs that appear in \`page-metadata.json\`
- The verification stage must confirm each quote or image URL exists in the fetched source bundle` : ''}
${!hasSource ? `\nSince no LaTeX source is available, use the PDF as your primary source:
- For \`latexSource\`, copy the text as closely as possible from the PDF (it won't be verbatim LaTeX, but should faithfully represent the source)
- For equations, reconstruct the LaTeX from the PDF rendering
- The verification stage will check against PDF text regions instead of .tex files` : ''}

## Pipeline & Artifacts
Each stage reads the prior artifacts and writes its own. You run exactly ONE stage per invocation —
do not perform other stages. The hand-off files (relative to the generation directory):
- \`index.json\`        (Stage 0) — grep-anchored source map + document metadata
- \`exploration.md\`    (Stage 1) — narrative findings / structure map
- \`outline.json\`      (Stage 2) — chapter plan referencing index segment ids
- \`excerpts.json\`     (Stage 3) — collected excerpts keyed by chapter
- \`verification.json\` (Stage 4) — verified/corrected excerpts keyed by chapter
- \`explanations.json\` (Stage 5) — chapter explanations keyed by chapter
- \`story.json\` + \`DONE\` (Stage 6) — final assembled story`;

  const stages = {
    index: `### Stage 0: Source Index
Build a line-demarcated map of the ${isWebpage ? 'webpage source (page.md and page-metadata.json)' : 'LaTeX source (.tex files)'} so later stages can navigate without re-reading
everything. Read each source file and catalogue its segments: sections, definitions, theorems, lemmas,
key equations, figures, tables. For EACH segment record:
- \`id\` — stable short id ("seg-1", "seg-2", ...)
- \`kind\` — section | subsection | definition | theorem | lemma | proof | equation | figure | table | other
- \`label\` — human label ("Section 3.2", "Theorem 1", "Figure 4")
- \`sourceFile\` — relative path to the source file (e.g. "main.tex" or "page.md")
- \`lineStart\`/\`lineEnd\` — EXACT 1-indexed line range in sourceFile. Later stages pull the segment
  with Read(sourceFile, { offset: lineStart - 1, limit: lineEnd - lineStart + 1 }).
- \`page\` — 0-indexed PDF page if known (optional, null otherwise)
Also extract document metadata from the title page / abstract / author block: title, authors (full
names as written), publication month+year, institutions/affiliations (deduplicated).
Write valid JSON to ${generationDir}/index.json:
\`\`\`json
{
  "metadata": { "title": "", "authors": [], "publishedYear": null, "publishedMonth": null, "institutions": [] },
  "segments": [
    { "id": "seg-1", "kind": "section", "label": "Section 1", "sourceFile": "main.tex", "lineStart": 42, "lineEnd": 120, "page": null }
  ]
}
\`\`\`
Output ONLY valid JSON to the file (no prose, no markers).`,

    exploration: `### Stage 1: Source Exploration
Read ${generationDir}/index.json FIRST to orient, then read the regions of the source that matter,
navigating via the index line numbers (Read sourceFile at lineStart/lineEnd) when segments are present.
- ${isWebpage ? 'Read page.md and page-metadata.json thoroughly; use page.html only when the readable extraction needs confirmation' : hasSource ? 'Read the key .tex regions (start with the main .tex, follow \\\\input{} / \\\\include{} references) using the index line ranges to jump to sections' : 'Read the PDF thoroughly, page by page'}
- ${hasPdf && hasSource ? 'Read the PDF for overview context' : ''}
- Map the structure: sections, key equations, theorems, algorithms, tables, figures
- **Confirm paper metadata** from the index / title page / abstract / author block:
  - Authors: full names as they appear in the paper
  - Publication date: month and year (submission date, conference proceedings, journal volume, or arXiv date)
  - Institutions/affiliations: for each author if listed (deduplicate)
- Write findings to ${generationDir}/exploration.md
- End the file with the line: EXPLORATION_COMPLETE`,

    outline: `### Stage 2: Chapter Outline
Read ${generationDir}/index.json and ${generationDir}/exploration.md first. Design chapters that best
serve the user's query and the source content. Follow the chapter count and structure from your Story
Mode guidelines above.

**Required constraints**:
- First chapter: Overview (no excerpts) — orient the reader
- Last chapter: Summary (no excerpts) — key takeaways
- Each chapter should have ONE clear teaching point
- Chapter labels: 2-4 words (for sidebar)
- For each chapter, note which index segment ids it will draw its excerpt(s) from

Write valid JSON to ${generationDir}/outline.json:
\`\`\`json
{
  "chapters": [
    { "id": "chapter-0", "label": "Overview", "teachingPoint": "", "segmentIds": [] }
  ]
}
\`\`\`
Output ONLY valid JSON to the file.`,

    excerpts: `### Stage 3: Excerpt Collection
Read ${generationDir}/index.json and ${generationDir}/outline.json first. For each chapter, collect its
excerpts from the source (first and last chapters: 0). For each planned segment, Read its \`sourceFile\`
at the given \`lineStart\`/\`lineEnd\` range (Read(sourceFile, { offset: lineStart - 1, limit: lineEnd - lineStart + 1 }))
to pull the content; fall back to Grep when no index is available.

Each excerpt should be one of:
- **text**: A key paragraph, definition, or claim (may contain inline or display math)
- **equation**: A PURE mathematical equation or formula — contains ONLY math, no surrounding prose
- **figure**: A diagram, chart, table, or illustration
- **proof** *(textbook mode only, at most 1-2 per story)*: A step-by-step proof walkthrough for a theorem whose *proof technique* is the core insight. Use only when the how-it-is-proved matters as much as the result itself. See format below.

**IMPORTANT — choosing between text and equation types:**
If an excerpt mixes prose with math (e.g., a sentence defining a variable followed by an equation, or a paragraph that includes inline math expressions), it MUST be typed as "text", NOT "equation". The "equation" type is ONLY for excerpts whose entire content is a mathematical expression — no natural-language sentences surrounding it. When in doubt, use "text". The text renderer supports both inline math (\`$...$\`) and display math (\`$$...$$\`), so equations embedded in prose will render correctly as text excerpts.

For EACH excerpt you collect:
1. Read the source ${sourceWord} containing it (use the index line range, or Grep if no index)
2. Copy the EXACT raw ${rawWord} into \`latexSource\` — character for character
3. Record which file it came from
4. Write a KaTeX-renderable version into \`content\` (see below)

**Text excerpts**: \`content\` should be readable text — remove \\cite{}, \\ref{}, \\label{} etc., but KEEP inline math expressions (e.g. \`$\\lambda$\`, \`$x^2$\`). Keep \`latexSource\` as the raw version.

**Equation excerpts**: \`content\` should be **clean KaTeX-compatible LaTeX** that renders correctly. The content must be PURE math — no prose text, no sentences. You may adapt from the raw source:
- Strip \\begin{equation}/\\end{equation} and similar environments — just the math content
- Remove \\label{}, \\tag{}, \\nonumber
- Replace unsupported macros with KaTeX equivalents
- Use \\begin{aligned}...\\end{aligned} for multi-line equations
- The equation does NOT need to be an exact string match of the source, but MUST be mathematically equivalent
- Keep \`latexSource\` as the raw verbatim copy from the ${hasSource ? '.tex file' : 'PDF'}
- If the source passage mixes prose with equations, use type "text" instead and embed the math with $...$ or $$...$$ delimiters

**Figure excerpts**: For diagrams, charts, tables, and illustrations:
- \`content\` should be the figure's caption text (cleaned of LaTeX artifacts, like text excerpts)
- \`latexSource\` should be the raw \\begin{figure}...\\end{figure} (or \\begin{table}...\\end{table}) block from the ${isWebpage ? 'webpage source/caption/alt text' : hasSource ? '.tex file' : 'PDF'}
- \`label\` should be e.g. "Figure 1" or "Table 2"
- \`pdfRegion\` is especially important for figures — match against "image" type blocks in the regions index (see below)
${isWebpage ? '- For webpage figures, set `visualUrl` to the matching absolute image URL from `page-metadata.json` when a useful diagram/image is available.' : ''}

**PDF Region mapping** (if regions index is available):
For each excerpt, find the matching block(s) in the regions index and add a \`pdfRegion\` field:
1. Read the regions index JSON file
2. For **text/equation excerpts**: search for blocks with \`type: "text"\` whose \`text\` best matches the excerpt's \`content\` (substring matching)
3. For **figure excerpts**: search for blocks with \`type: "image"\` on the same page as the figure's caption. Match the image block nearest to (typically just above) the caption text block.
4. Set \`pdfRegion\` to \`{ "page": <0-indexed page number>, "bbox": [x0, y0, x1, y1] }\`
5. The bbox values are already normalized to [0, 1] range in the regions index — use them directly
6. If multiple blocks match, use the first/primary block
7. If no match is found, omit \`pdfRegion\` for that excerpt (it's optional)
8. Some figures use vector graphics rather than embedded images — these won't appear as image blocks. That's fine, omit \`pdfRegion\`.

**Proof excerpts** (textbook mode only, at most 1-2 per story — skip unless the proof technique is genuinely the insight):
- \`type\`: \`"proof"\`
- \`statement\`: The theorem or claim being proved (Markdown + KaTeX)
- \`label\`: e.g. \`"Theorem 3.1"\` or \`"Lemma 2"\`
- \`steps\`: array of 4-10 logical steps, each with:
  - \`content\`: The proof line itself (Markdown + KaTeX) — one logical move per step
  - \`explanation\`: (optional) Why this step is valid — the insight, the tool used, what makes it non-obvious
- Proof excerpts have no \`latexSource\`, \`content\`, or \`pdfRegion\` at the top level

Guidelines:
- Prefer excerpts that teach something concrete — definitions, theorem statements, key equations, illuminating examples
- For text, include enough context to be meaningful (2-6 sentences)
- Follow the excerpt count from your Story Mode guidelines above (first and last chapters always have 0).

Write valid JSON to ${generationDir}/excerpts.json:
\`\`\`json
{
  "chapters": [
    { "id": "chapter-1", "excerpts": [ { "content": "", "latexSource": "", "type": "text", "sourceFile": "", "label": "", "pdfRegion": null } ] }
  ]
}
\`\`\`
Output ONLY valid JSON to the file.`,

    verification: `### Stage 4: Verification
Read ${generationDir}/excerpts.json. For EVERY excerpt collected in Stage 3:
1. ${isWebpage ? 'Use Grep/Read to search for a distinctive phrase from the `latexSource` in page.md or page.html, and verify any `visualUrl` against page-metadata.json' : hasSource ? 'Use Grep to search for a distinctive phrase from the `latexSource` in the source files' : 'Verify the excerpt text against the PDF regions index or re-read the relevant PDF page'}
2. Confirm the raw ${isWebpage ? 'webpage quote' : hasSource ? 'LaTeX' : 'text'} source exists ${isWebpage ? 'verbatim in the webpage source bundle' : hasSource ? 'verbatim in the .tex files' : 'in the PDF'}
3. For equation excerpts, verify that \`content\` is mathematically equivalent to \`latexSource\` (same symbols, operators, structure — just cleaned for KaTeX)
4. If a latexSource cannot be verified, REMOVE the excerpt or replace it with a verified one

Write the verified/corrected excerpts (SAME shape as excerpts.json) to ${generationDir}/verification.json.
Output ONLY valid JSON to the file.`,

    explanations: `### Stage 5: Explanation Writing
Read ${generationDir}/outline.json and ${generationDir}/verification.json. Write the explanation
markdown for each chapter:

- **Structure**: Cover WHY this concept matters, WHAT it is, HOW it works, and what to WATCH OUT for — but weave these together as natural prose, not as labeled sections or mechanical topic sentences
- **No mechanical openers**: Never start a chapter with phrases like "This chapter matters because...". Instead, open with a compelling observation, a question, an analogy, or a concrete consequence that draws the reader in. The motivation should be felt, not announced.
- **Self-contained explanations**: Write each explanation so it stands alone — the reader should be able to follow every point without looking at the excerpt. Do NOT write "as shown in the excerpt above", "the passage above states", or "as you can see in the quote". Inline the key idea, equation, or claim directly.
- **Intuition first**: Always ground formal definitions in intuition before or alongside the formalism
- **Math**: Use KaTeX-compatible LaTeX in explanations (inline: $...$ , display: $$...$$)
- **Cross-references**: Connect chapters ("As we saw in Chapter 3..." or "This connects to the loss function in the next chapter")
- **Vary transitions**: Don't start more than 2 chapters with the same pattern
- **Critical analysis**: Don't just describe — interpret. "This is clever because...", "The limitation here is...", "Compared to X, this approach..."
- Adapt tone and depth to the source type (see your Story Mode guidelines above)

Write valid JSON to ${generationDir}/explanations.json:
\`\`\`json
{ "chapters": [ { "id": "chapter-0", "explanation": "" } ] }
\`\`\`
Output ONLY valid JSON to the file.`,

    assemble: `### Stage 6: Final Assembly
Read ${generationDir}/index.json, ${generationDir}/outline.json, ${generationDir}/verification.json,
and ${generationDir}/explanations.json, then assemble everything into a single story.json file.

**Schema** (write to ${generationDir}/story.json):
\`\`\`json
{
  "id": "<generated-uuid>",
  "title": "<Title — concise, may be shortened>",
  ${schemaFields}
  "authors": ["<Author One>", "<Author Two>"],
  "publishedYear": <year as integer, e.g. 2024>,
  "publishedMonth": <month as integer 1-12, e.g. 9 for September>,
  "institutions": ["<Institution One>", "<Institution Two>"],
  "query": ${JSON.stringify(query || null)},
  "createdAt": "<ISO-8601 timestamp>",
  "chapters": [
    {
      "id": "chapter-0",
      "label": "<2-4 word sidebar label>",
      "excerpts": [
        {
          "content": "<KaTeX-renderable content: clean text for text excerpts, KaTeX-compatible LaTeX for equations>",
          "latexSource": "<Raw source — exact verbatim copy from source file>",
          "type": "<text|equation|figure>",
          "sourceFile": "<relative path to source file>",
          "label": "<e.g. 'Section 3.2' or 'Equation 5' or 'Definition 1'>",
          "visualUrl": "<optional absolute image URL for webpage figure excerpts>",
          "sourceUrl": "<optional webpage URL for webpage excerpts>",
          "pdfRegion": { "page": "<from regions index>", "bbox": ["<x0, y0, x1, y1 from matching block>"] }
        },
        {
          "type": "proof",
          "statement": "<Theorem or claim being proved — Markdown + KaTeX>",
          "label": "<e.g. 'Theorem 3.1'>",
          "steps": [
            { "content": "<Proof step — Markdown + KaTeX>", "explanation": "<Why this step works — optional>" }
          ]
        }
      ],
      "explanation": "<Markdown with KaTeX math. Use $...$ for inline, $$...$$ for display.>"
    }
  ]
}
\`\`\`

Use the verified excerpts from verification.json and the explanations from explanations.json; take
metadata (authors/year/institutions/title) from index.json's \`metadata\` unless exploration corrected it.

**Validation before writing:**
1. Every non-proof excerpt.latexSource exists ${hasSource ? 'verbatim in the source files' : 'faithfully in the PDF'} (it came from verification.json)
2. Every non-proof excerpt has a non-empty latexSource field; proof excerpts have statement + steps instead
2a. authors is an array of strings (or null if genuinely undetectable)
2b. publishedYear and publishedMonth are integers (or null if genuinely undetectable)
2c. institutions is an array of unique institution strings (or null if none listed)
3. First chapter (Overview) and last chapter (Summary) have \`excerpts: []\`
4. All other chapters have at least 1 excerpt
5. Chapter labels are 2-4 words
6. Chapter IDs are sequential: chapter-0, chapter-1, ...
7. All KaTeX in explanations uses valid LaTeX syntax
8. No hallucinated claims — everything is grounded in the source
9. Total chapters: flexible based on source type and content density (8-45 range)
10. If regions index was available, most excerpts should have a \`pdfRegion\` with valid page and bbox values

Write the final story.json to ${generationDir}/story.json.
After writing, end by creating a file ${generationDir}/DONE containing just the text "DONE".

## Important Notes
- For equations, the \`content\` field should be KaTeX-renderable LaTeX (adapted from source if needed). The \`latexSource\` field must be the raw verbatim copy.
- For text excerpts, the \`content\` field should be readable (no \\cite{} etc.) but the \`latexSource\` should be the raw version.
- Generate a proper UUID v4 for the story id.`,
  };

  return { shared, stages };
}
