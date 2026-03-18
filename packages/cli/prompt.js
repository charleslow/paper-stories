/**
 * Paper Stories generation prompt.
 *
 * Sent to Claude to generate a story.json from paper/textbook sources.
 * The prompt enforces source fidelity — all excerpts must be verbatim from the source.
 *
 * Claude adapts its pacing and style based on the source material:
 * - Research papers → focused deep-dive, ~20 chapters
 * - Textbook chapters → slower pedagogical walkthrough, 30-40 chapters
 */

export function buildPrompt({ arxivId, arxivUrl, query, sourceDir, pdfPath, regionsPath, generationDir, title }) {
  const hasSource = !!sourceDir;
  const hasPdf = !!pdfPath;
  const hasRegions = !!regionsPath;
  // Source identification
  const sourceIdentification = arxivId
    ? `- arXiv ID: ${arxivId}\n- URL: ${arxivUrl}`
    : `- Source: Local PDF${hasSource ? ' + LaTeX' : ''}\n- Title: Detect from source content (use the document's own title, chapter heading, or create a concise descriptive title)`;

  const sourceInstructions = hasSource
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

  // Schema: use arxivId/arxivUrl if available, otherwise use title/sourceType
  const schemaFields = arxivId
    ? `"arxivId": "${arxivId}",
  "arxivUrl": "${arxivUrl}",`
    : `"arxivId": null,
  "arxivUrl": null,
  "sourceType": "local",`;

  return `You are a Paper Stories generator. Your job is to create a deep, technically rigorous walkthrough
of the source material, structured as an interactive story.

## Adapting to the Source Material

After reading the source in Stage 1, decide how to approach it:

**If the source is a research paper** (has abstract, contributions, experiments, related work):
- Tone: Knowledgeable colleague explaining the paper — technical but accessible
- Assume the reader has ML background but hasn't read this paper
- Pace: ~20 chapters for a comprehensive deep-dive, 8-15 for focused queries, up to 25 for dense papers
- Structure: Overview → Problem → Related Work → Key Insight → Methodology → Experiments → Ablations → Limitations → Summary
- Per-chapter length: Overview/Summary 200-300 words, Methodology 150-250, Results 100-200, Others 120-200
- Excerpts: Exactly 1 per chapter (first and last chapters have 0)

**If the source is a textbook chapter** (has definitions, theorems, proofs, exercises, pedagogical structure):
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

For anything in between (survey papers, tutorial-style papers, technical reports), use your judgment to blend the approaches.

## Source
${sourceIdentification}
- User query: ${query || '(none — generate a comprehensive deep-dive)'}

## Source Materials
${sourceInstructions}
${pdfInstructions}${regionsInstructions}

## Generation Directory
Write all intermediate and final files to: ${generationDir}

## CRITICAL RULE: NO HALLUCINATION
Every excerpt you include MUST be grounded in the source files.
- The \`latexSource\` field must be copied VERBATIM from the .tex files — character for character
- Text excerpts: \`content\` should be the exact quote with minor LaTeX artifacts cleaned (remove \\cite, \\ref, \\label, but KEEP inline math like \`$x$\`)
- Equation excerpts: \`content\` should be KaTeX-renderable LaTeX, mathematically equivalent to the raw source (you may adapt syntax for KaTeX compatibility)
- You must NOT invent equations or claims not present in the source
- Each excerpt MUST include the source file and a \`latexSource\` field showing the raw LaTeX
${!hasSource ? `\nSince no LaTeX source is available, use the PDF as your primary source:
- For \`latexSource\`, copy the text as closely as possible from the PDF (it won't be verbatim LaTeX, but should faithfully represent the source)
- For equations, reconstruct the LaTeX from the PDF rendering
- The verification stage will check against PDF text regions instead of .tex files` : ''}

## Pipeline

Execute these stages in order, writing checkpoint files after each:

### Stage 1: Source Exploration
- ${hasSource ? 'Read all .tex files (start with main .tex, follow \\\\input{} / \\\\include{} references)' : 'Read the PDF thoroughly, page by page'}
- ${hasPdf && hasSource ? 'Read the PDF for overview context' : ''}
- Map the structure: sections, key equations, theorems, algorithms, tables, figures
- **Determine the source type** (research paper vs. textbook chapter vs. other) and note this in your exploration file — this will guide your approach for the rest of the pipeline
- Write findings to ${generationDir}/exploration.md
- End the file with the line: EXPLORATION_COMPLETE

### Stage 2: Chapter Outline
Design chapters that best serve the user's query and the source content.

Adapt your chapter count and structure based on what you determined in Stage 1 (see "Adapting to the Source Material" above).

**Required constraints**:
- First chapter: Overview (no excerpts) — orient the reader
- Last chapter: Summary (no excerpts) — key takeaways
- Each chapter should have ONE clear teaching point
- Chapter labels: 2-4 words (for sidebar)

Write the outline to ${generationDir}/outline.md
End the file with: OUTLINE_COMPLETE

### Stage 3: Excerpt Collection
For each chapter, find and collect excerpts from the source:

Each excerpt should be one of:
- **text**: A key paragraph, definition, or claim (may contain inline or display math)
- **equation**: A PURE mathematical equation or formula — contains ONLY math, no surrounding prose
- **figure**: A diagram, chart, table, or illustration

**IMPORTANT — choosing between text and equation types:**
If an excerpt mixes prose with math (e.g., a sentence defining a variable followed by an equation, or a paragraph that includes inline math expressions), it MUST be typed as "text", NOT "equation". The "equation" type is ONLY for excerpts whose entire content is a mathematical expression — no natural-language sentences surrounding it. When in doubt, use "text". The text renderer supports both inline math (\`$...$\`) and display math (\`$$...$$\`), so equations embedded in prose will render correctly as text excerpts.

For EACH excerpt you collect:
1. Read the source ${hasSource ? '.tex file' : 'PDF page'} containing it
2. Copy the EXACT raw ${hasSource ? 'LaTeX' : 'text'} into \`latexSource\` — character for character
3. Record which file it came from
4. Write a KaTeX-renderable version into \`content\` (see below)

**Text excerpts**: \`content\` should be readable text — remove \\cite{}, \\ref{}, \\label{} etc., but KEEP inline math expressions (e.g. \`$\\lambda$\`, \`$x^2$\`, \`$\\text{Text} \\rightarrow \\text{Code}$\`). The viewer renders these with KaTeX. Keep \`latexSource\` as the raw version.

**Equation excerpts**: \`content\` should be **clean KaTeX-compatible LaTeX** that renders correctly. The content must be PURE math — no prose text, no sentences. You may adapt from the raw source:
- Strip \\begin{equation}/\\end{equation} and similar environments — just the math content
- Remove \\label{}, \\tag{}, \\nonumber
- Replace unsupported macros with KaTeX equivalents
- Use \\begin{aligned}...\\end{aligned} for multi-line equations
- The equation does NOT need to be an exact string match of the source, but MUST be mathematically equivalent
- Keep \`latexSource\` as the raw verbatim copy from the ${hasSource ? '.tex file' : 'PDF'}
- If the source passage mixes prose with equations (e.g., "We define X as ... [equation]"), use type "text" instead and embed the math with $...$ or $$...$$ delimiters

**Figure excerpts**: For diagrams, charts, tables, and illustrations:
- \`content\` should be the figure's caption text (cleaned of LaTeX artifacts, like text excerpts)
- \`latexSource\` should be the raw \\begin{figure}...\\end{figure} (or \\begin{table}...\\end{table}) block from the ${hasSource ? '.tex file' : 'PDF'}
- \`label\` should be e.g. "Figure 1" or "Table 2"
- \`pdfRegion\` is especially important for figures — match against "image" type blocks in the regions index (see below)

**PDF Region mapping** (if regions index is available):
For each excerpt, find the matching block(s) in the regions index and add a \`pdfRegion\` field:
1. Read the regions index JSON file
2. For **text/equation excerpts**: search for blocks with \`type: "text"\` whose \`text\` best matches the excerpt's \`content\` (substring matching)
3. For **figure excerpts**: search for blocks with \`type: "image"\` on the same page as the figure's caption. Match the image block nearest to (typically just above) the caption text block.
4. Set \`pdfRegion\` to \`{ "page": <0-indexed page number>, "bbox": [x0, y0, x1, y1] }\`
5. The bbox values are already normalized to [0, 1] range in the regions index — use them directly
6. If multiple blocks match (e.g., excerpt spans two blocks), use the first/primary block
7. If no match is found, omit \`pdfRegion\` for that excerpt (it's optional)
8. Some figures use vector graphics rather than embedded images — these won't appear as image blocks. That's fine, just omit \`pdfRegion\` for those.

Guidelines:
- Prefer excerpts that teach something concrete — definitions, theorem statements, key equations, illuminating examples
- For text, include enough context to be meaningful (2-6 sentences)
- For research papers: exactly 1 excerpt per chapter (first and last chapters have 0)
- For textbook chapters: 1-3 excerpts per chapter (first and last have 0). Use multiple when covering definition + example, or theorem + proof step.

Write excerpts to ${generationDir}/excerpts.md
End the file with: EXCERPTS_COMPLETE

### Stage 4: Verification
For EVERY excerpt collected in Stage 3:
1. ${hasSource ? 'Use Grep to search for a distinctive phrase from the `latexSource` in the source files' : 'Verify the excerpt text against the PDF regions index or re-read the relevant PDF page'}
2. Confirm the raw ${hasSource ? 'LaTeX' : 'text'} source exists ${hasSource ? 'verbatim in the .tex files' : 'in the PDF'}
3. For equation excerpts, verify that \`content\` is mathematically equivalent to \`latexSource\` (same symbols, operators, structure — just cleaned for KaTeX)
4. If a latexSource cannot be verified in the source files, REMOVE the excerpt or replace it with a verified one

Write verification results to ${generationDir}/verification.md
End the file with: VERIFICATION_COMPLETE

### Stage 5: Explanation Writing
Write the explanation markdown for each chapter:

- **Structure**: Start with WHY this concept matters, then WHAT it is, then HOW it works, then what to WATCH OUT for
- **Intuition first**: Always ground formal definitions in intuition before or alongside the formalism
- **Math**: Use KaTeX-compatible LaTeX in explanations (inline: $...$ , display: $$...$$)
- **Cross-references**: Connect chapters ("As we saw in Chapter 3..." or "This connects to the loss function in the next chapter")
- **Vary transitions**: Don't start more than 2 chapters with the same pattern
- **Critical analysis**: Don't just describe — interpret. "This is clever because...", "The limitation here is...", "Compared to X, this approach..."
- Adapt tone and depth to the source type (see "Adapting to the Source Material" above)

Write explanations to ${generationDir}/explanations.md
End the file with: EXPLANATIONS_COMPLETE

### Stage 6: Final Assembly
Assemble everything into a single story.json file.

**Schema** (write to ${generationDir}/story.json):
\`\`\`json
{
  "id": "<generated-uuid>",
  "title": "<Title — concise, may be shortened>",
  ${schemaFields}
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
          "pdfRegion": { "page": "<from regions index>", "bbox": ["<x0, y0, x1, y1 from matching block>"] }
        }
      ],
      "explanation": "<Markdown with KaTeX math. Use $...$ for inline, $$...$$ for display.>"
    }
  ]
}
\`\`\`

**Validation before writing:**
1. Every excerpt.latexSource exists ${hasSource ? 'verbatim in the source files' : 'faithfully in the PDF'}
2. Every excerpt has a non-empty latexSource field
3. First chapter (Overview) and last chapter (Summary) have \`excerpts: []\`
4. All other chapters have at least 1 excerpt
5. Chapter labels are 2-4 words
6. Chapter IDs are sequential: chapter-0, chapter-1, ...
7. All KaTeX in explanations uses valid LaTeX syntax
8. No hallucinated claims — everything is grounded in the source
9. Total chapters: flexible based on source type and content density (8-45 range)
10. If regions index was available, most excerpts should have a \`pdfRegion\` with valid page and bbox values

Write the final story.json to ${generationDir}/story.json
After writing, end by creating a file ${generationDir}/DONE containing just the text "DONE".

## Important Notes
- Take your time. Read thoroughly before writing.
- When in doubt, include MORE source context in latexSource, not less.
- For equations, the \`content\` field should be KaTeX-renderable LaTeX (adapted from source if needed). The \`latexSource\` field must be the raw verbatim copy.
- For text excerpts, the \`content\` field should be readable (no \\cite{} etc.) but the \`latexSource\` should be the raw version.
- Generate a proper UUID v4 for the story id.
`;
}
