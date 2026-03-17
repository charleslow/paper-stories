/**
 * Paper Stories generation prompt.
 *
 * Sent to Claude to generate a story.json from paper/textbook sources.
 * The prompt enforces source fidelity — all excerpts must be verbatim from the source.
 *
 * Supports two modes:
 * - Paper mode (default): Deep-dive into an ML research paper
 * - Textbook mode (--textbook): Slower-paced walkthrough of a textbook chapter
 */

export function buildPrompt({ arxivId, arxivUrl, query, sourceDir, pdfPath, regionsPath, generationDir, title, isTextbook }) {
  const hasSource = !!sourceDir;
  const hasPdf = !!pdfPath;
  const hasRegions = !!regionsPath;
  const isLocal = !arxivId;

  // Source identification
  const sourceIdentification = arxivId
    ? `- arXiv ID: ${arxivId}\n- URL: ${arxivUrl}`
    : `- Title: ${title || 'Local Document'}\n- Source: Local PDF${hasSource ? ' + LaTeX' : ''}`;

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

  // Mode-specific guidance
  const modeDescription = isTextbook
    ? `You are generating a **textbook chapter walkthrough**. The goal is NOT to replace the textbook, but to provide
a thorough guided tour of the key concepts so the reader can "clear" the material much faster on a second read-through.

**Textbook mode principles:**
- **Go slowly.** The reader is not well-versed in this material. It is better to have too many chapters than to rush through a concept.
- **Cover thoroughly:** Key definitions, theorems, proofs (sketch the intuition), and core ideas should each get their own chapter.
- **Motivate concepts well.** Before introducing a definition or theorem, explain WHY it matters and what problem it solves.
- **Build understanding incrementally.** Each chapter should build on the previous ones. Use "As we saw in Chapter N..." connections.
- **Include insightful questions.** At the end of each chapter's explanation, include 1-3 thought-provoking questions that test understanding or invite deeper thinking. Format them as a "**Questions to consider:**" section. These should NOT be trivial recall questions — they should be the kind of questions a good teacher would ask to check if the student truly understood the concept.
- **Exercises:** If the source contains particularly good exercises, you may reference them and hint at the approach without giving away the full solution.`
    : `You are generating a **research paper walkthrough**. Your job is to create a deep, technically rigorous walkthrough
of the paper, structured as an interactive story.`;

  const chapterCountGuidance = isTextbook
    ? `**Chapter count**: Textbook chapters are dense and pedagogical. Aim for **30-40 chapters** for a dense textbook chapter.
Use more chapters rather than fewer — each concept, definition, and theorem deserves space to breathe.
A chapter that tries to cover too much is worse than two chapters that each explain one thing well.`
    : `**Chapter count**: Flexible based on query scope and paper length. Default to ~20 for
comprehensive deep-dives. Use fewer (8-15) for focused queries about a specific aspect.
Use more (20-25) for long or dense papers. The story should feel complete, not padded.`;

  const structureGuidance = isTextbook
    ? `**Structure**: Adapt to the textbook chapter's pedagogical flow:

- **Overview** → Set the scene: what is this chapter about and why does it matter?
- **Motivation / Setup** → What problem or question motivates this material?
- **Definitions** (one per chapter) → Introduce each key definition carefully with intuition
- **Key Ideas / Lemmas** → Build up the conceptual machinery
- **Theorems** (one per chapter) → State, motivate, and sketch the proof intuition
- **Examples** → Concrete examples that ground the abstractions
- **Connections** → How concepts relate to each other and to the broader field
- **Summary** → Key takeaways and what to remember

Each chapter should have ONE clear teaching point. Don't bundle a definition and a theorem into the same chapter unless they're inseparable.`
    : `**Structure**: Adapt to what the query needs:

For a **comprehensive deep-dive** (no query, or broad query), cover the full paper arc:
- Overview → Problem → Related Work → Key Insight → Methodology (multiple chapters) →
  Theoretical Analysis → Experiments/Results → Ablations → Limitations → Summary

For a **focused query** (e.g., "How does the attention mechanism work?"), go deeper on
the relevant aspect:
- Brief overview for context → Deep coverage of the queried topic across multiple
  chapters → Connections to the rest of the paper → Summary
- Skip or condense sections not relevant to the query`;

  const explanationGuidance = isTextbook
    ? `- **Tone**: Patient teacher explaining to a motivated student — clear, encouraging, thorough
- **Depth**: Assume the reader has basic mathematical maturity but is learning this topic for the first time
- **Structure**: Start with WHY this concept matters, then WHAT it is, then HOW it works, then what to WATCH OUT for
- **Math**: Use KaTeX-compatible LaTeX in explanations (inline: $...$ , display: $$...$$)
- **Intuition first**: Always ground formal definitions in intuition before or alongside the formalism
- **Questions**: End each chapter (except Overview and Summary) with 1-3 "Questions to consider" that test genuine understanding
- **Length per chapter**:
  - Overview/Summary: 200-350 words
  - Definition chapters: 200-300 words (intuition + formal statement + why it matters)
  - Theorem chapters: 250-400 words (statement + proof sketch/intuition + significance)
  - Example chapters: 150-250 words
  - Others: 150-250 words`
    : `- **Tone**: Knowledgeable colleague explaining the paper — technical but accessible
- **Depth**: Assume reader has ML background but hasn't read this paper
- **Structure**: Start with WHY, then WHAT, then HOW
- **Math**: Use KaTeX-compatible LaTeX in explanations (inline: $...$ , display: $$...$$)
- **Length per chapter**:
  - Overview/Summary: 200-300 words
  - Methodology chapters: 150-250 words
  - Results/Ablations: 100-200 words
  - Others: 120-200 words`;

  const totalChaptersRange = isTextbook ? '15-45 range' : '8-25 range';

  const excerptCountGuidance = isTextbook
    ? `- 1-3 excerpts per chapter (first and last chapters have 0 excerpts)
- Use multiple excerpts when a chapter covers a definition + its immediate example, or a theorem statement + a key step in the proof
- Prefer excerpts that teach something concrete — definitions, theorem statements, key equations, illuminating examples`
    : `- Exactly 1 excerpt per chapter (first and last chapters have 0 excerpts)
- Prefer excerpts that teach something concrete
- For text, include enough context to be meaningful (2-6 sentences)`;

  const excerptValidation = isTextbook
    ? `3b. All other chapters have 1-3 excerpts`
    : `3b. All other chapters have exactly 1 excerpt`;

  // Schema: use arxivId/arxivUrl if available, otherwise use title/sourceType
  const schemaFields = arxivId
    ? `"arxivId": "${arxivId}",
  "arxivUrl": "${arxivUrl}",`
    : `"arxivId": null,
  "arxivUrl": null,
  "sourceType": "local",`;

  return `You are a Paper Stories generator. ${modeDescription}

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
- Write findings to ${generationDir}/exploration.md
- End the file with the line: EXPLORATION_COMPLETE

### Stage 2: Chapter Outline
Design chapters that best serve the user's query and the source content.

${chapterCountGuidance}

${structureGuidance}

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
${excerptCountGuidance}

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

${explanationGuidance}
- **Cross-references**: Connect chapters ("As we saw in Chapter 3..." or "This connects to the loss function in the next chapter")
- **Vary transitions**: Don't start more than 2 chapters with the same pattern
- **Critical analysis**: Don't just describe — interpret. "This is clever because...", "The limitation here is...", "Compared to X, this approach..."

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
${excerptValidation}
4. Chapter labels are 2-4 words
5. Chapter IDs are sequential: chapter-0, chapter-1, ...
6. All KaTeX in explanations uses valid LaTeX syntax
7. No hallucinated claims — everything is grounded in the source
8. Total chapters: ${totalChaptersRange} (flexible based on query and content density)
9. If regions index was available, most excerpts should have a \`pdfRegion\` with valid page and bbox values

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
