/**
 * Paper Stories generation prompt.
 *
 * Sent to Claude to generate a story.json from arXiv paper sources.
 * The prompt enforces source fidelity — all excerpts must be verbatim from the paper.
 */

export function buildPrompt({ arxivId, arxivUrl, query, sourceDir, pdfPath, regionsPath, generationDir }) {
  const hasSource = !!sourceDir;
  const hasPdf = !!pdfPath;
  const hasRegions = !!regionsPath;

  const sourceInstructions = hasSource
    ? `The paper's LaTeX source files are available at: ${sourceDir}
Use Glob and Read tools to explore and read them. These are your PRIMARY source of truth.`
    : `No LaTeX source is available for this paper.`;

  const pdfInstructions = hasPdf
    ? `The paper's PDF is available at: ${pdfPath}
Use Read tool to read it. ${hasSource ? 'Use this as a SECONDARY source for figures/tables context.' : 'This is your PRIMARY source.'}`
    : '';

  const regionsInstructions = hasRegions
    ? `\nA pre-extracted PDF text regions index is available at: ${regionsPath}
This file contains text blocks with normalized bounding boxes for every page of the PDF.
Use this to assign \`pdfRegion\` fields to excerpts (see Stage 3 for details).`
    : '';

  return `You are a Paper Stories generator. Your job is to create a deep, technically rigorous walkthrough of an ML research paper, structured as an interactive story.

## Paper
- arXiv ID: ${arxivId}
- URL: ${arxivUrl}
- User query: ${query || '(none — generate a comprehensive deep-dive)'}

## Source Materials
${sourceInstructions}
${pdfInstructions}${regionsInstructions}

## Generation Directory
Write all intermediate and final files to: ${generationDir}

## CRITICAL RULE: NO HALLUCINATION
Every excerpt you include MUST be grounded in the paper's source files.
- The \`latexSource\` field must be copied VERBATIM from the .tex files — character for character
- Text excerpts: \`content\` should be the exact quote with minor LaTeX artifacts cleaned
- Equation excerpts: \`content\` should be KaTeX-renderable LaTeX, mathematically equivalent to the raw source (you may adapt syntax for KaTeX compatibility)
- You must NOT invent equations or claims not present in the paper
- Each excerpt MUST include the source file and a \`latexSource\` field showing the raw LaTeX

## Pipeline

Execute these stages in order, writing checkpoint files after each:

### Stage 1: Source Exploration
- Read all .tex files (start with main .tex, follow \\input{} / \\include{} references)
- Read the PDF for overview context
- Map the paper's structure: sections, key equations, theorems, algorithms, tables, figures
- Write findings to ${generationDir}/exploration.md
- End the file with the line: EXPLORATION_COMPLETE

### Stage 2: Chapter Outline
Design chapters that best serve the user's query and the paper's content.

**Chapter count**: Flexible based on query scope and paper length. Default to ~20 for
comprehensive deep-dives. Use fewer (8-15) for focused queries about a specific aspect.
Use more (20-25) for long or dense papers. The story should feel complete, not padded.

**Structure**: Adapt to what the query needs:

For a **comprehensive deep-dive** (no query, or broad query), cover the full paper arc:
- Overview → Problem → Related Work → Key Insight → Methodology (multiple chapters) →
  Theoretical Analysis → Experiments/Results → Ablations → Limitations → Summary

For a **focused query** (e.g., "How does the attention mechanism work?"), go deeper on
the relevant aspect:
- Brief overview for context → Deep coverage of the queried topic across multiple
  chapters → Connections to the rest of the paper → Summary
- Skip or condense sections not relevant to the query

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
- **text**: A key paragraph, definition, or claim from the paper
- **equation**: A mathematical equation or formula

For EACH excerpt you collect:
1. Read the source .tex file containing it
2. Copy the EXACT raw LaTeX into \`latexSource\` — character for character
3. Record which file it came from
4. Write a KaTeX-renderable version into \`content\` (see below)

**Text excerpts**: \`content\` should be readable text — remove \\cite{}, \\ref{}, \\label{} etc. Keep \`latexSource\` as the raw version.

**Equation excerpts**: \`content\` should be **clean KaTeX-compatible LaTeX** that renders correctly. You may adapt from the raw source:
- Strip \\begin{equation}/\\end{equation} and similar environments — just the math content
- Remove \\label{}, \\tag{}, \\nonumber
- Replace unsupported macros with KaTeX equivalents
- Use \\begin{aligned}...\\end{aligned} for multi-line equations
- The equation does NOT need to be an exact string match of the source, but MUST be mathematically equivalent
- Keep \`latexSource\` as the raw verbatim copy from the .tex file

**PDF Region mapping** (if regions index is available):
For each excerpt, find the matching text block(s) in the regions index and add a \`pdfRegion\` field:
1. Read the regions index JSON file
2. Search through the pages/blocks to find the block whose \`text\` best matches the excerpt's \`content\`
3. Use substring matching — the excerpt text should appear within (or closely match) the block text
4. Set \`pdfRegion\` to \`{ "page": <0-indexed page number>, "bbox": [x0, y0, x1, y1] }\`
5. The bbox values are already normalized to [0, 1] range in the regions index — use them directly
6. If multiple blocks match (e.g., excerpt spans two blocks), use the first/primary block
7. If no match is found, omit \`pdfRegion\` for that excerpt (it's optional)

Guidelines:
- 1-3 excerpts per chapter (first and last chapters have 0)
- Prefer excerpts that teach something concrete
- For text, include enough context to be meaningful (2-6 sentences)

Write excerpts to ${generationDir}/excerpts.md
End the file with: EXCERPTS_COMPLETE

### Stage 4: Verification
For EVERY excerpt collected in Stage 3:
1. Use Grep to search for a distinctive phrase from the \`latexSource\` in the source files
2. Confirm the raw LaTeX source exists verbatim in the .tex files
3. For equation excerpts, verify that \`content\` is mathematically equivalent to \`latexSource\` (same symbols, operators, structure — just cleaned for KaTeX)
4. If a latexSource cannot be verified in the source files, REMOVE the excerpt or replace it with a verified one

Write verification results to ${generationDir}/verification.md
End the file with: VERIFICATION_COMPLETE

### Stage 5: Explanation Writing
Write the explanation markdown for each chapter:

- **Tone**: Knowledgeable colleague explaining the paper — technical but accessible
- **Depth**: Assume reader has ML background but hasn't read this paper
- **Structure**: Start with WHY, then WHAT, then HOW
- **Math**: Use KaTeX-compatible LaTeX in explanations (inline: $...$ , display: $$...$$)
- **Length per chapter**:
  - Overview/Summary: 200-300 words
  - Methodology chapters: 150-250 words
  - Results/Ablations: 100-200 words
  - Others: 120-200 words
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
  "title": "<Paper title — concise, may be shortened>",
  "arxivId": "${arxivId}",
  "arxivUrl": "${arxivUrl}",
  "query": ${JSON.stringify(query || null)},
  "createdAt": "<ISO-8601 timestamp>",
  "chapters": [
    {
      "id": "chapter-0",
      "label": "<2-4 word sidebar label>",
      "excerpts": [
        {
          "content": "<KaTeX-renderable content: clean text for text excerpts, KaTeX-compatible LaTeX for equations>",
          "latexSource": "<Raw LaTeX source — exact verbatim copy from .tex file>",
          "type": "<text|equation>",
          "sourceFile": "<relative path to source .tex file>",
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
1. Every excerpt.latexSource exists verbatim in the source files
2. Every excerpt has a non-empty latexSource field
3. First chapter (Overview) and last chapter (Summary) have \`excerpts: []\`
4. Chapter labels are 2-4 words
5. Chapter IDs are sequential: chapter-0, chapter-1, ...
6. All KaTeX in explanations uses valid LaTeX syntax
7. No hallucinated claims — everything is grounded in the paper
8. Total chapters: 8-25 range (flexible based on query and paper length)
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
