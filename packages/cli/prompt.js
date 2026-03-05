/**
 * Paper Stories generation prompt.
 *
 * Sent to Claude to generate a story.json from arXiv paper sources.
 * The prompt enforces source fidelity — all excerpts must be verbatim from the paper.
 */

export function buildPrompt({ arxivId, arxivUrl, query, sourceDir, pdfPath, generationDir }) {
  const hasSource = !!sourceDir;
  const hasPdf = !!pdfPath;

  const sourceInstructions = hasSource
    ? `The paper's LaTeX source files are available at: ${sourceDir}
Use Glob and Read tools to explore and read them. These are your PRIMARY source of truth.`
    : `No LaTeX source is available for this paper.`;

  const pdfInstructions = hasPdf
    ? `The paper's PDF is available at: ${pdfPath}
Use Read tool to read it. ${hasSource ? 'Use this as a SECONDARY source for figures/tables context.' : 'This is your PRIMARY source.'}`
    : '';

  return `You are a Paper Stories generator. Your job is to create a deep, technically rigorous walkthrough of an ML research paper, structured as an interactive story with ~20 chapters.

## Paper
- arXiv ID: ${arxivId}
- URL: ${arxivUrl}
- User query: ${query || '(none — generate a comprehensive deep-dive)'}

## Source Materials
${sourceInstructions}
${pdfInstructions}

## Generation Directory
Write all intermediate and final files to: ${generationDir}

## CRITICAL RULE: NO HALLUCINATION
Every excerpt you include MUST be copied VERBATIM from the paper's source files.
- Text excerpts: exact quotes from the paper
- Equations: exact LaTeX from the source .tex files
- You must NOT paraphrase, reword, or reconstruct any excerpt
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
Design ~20 chapters covering (adjust based on paper content):

1. **Overview** — What problem does this paper solve? Why does it matter? (no excerpts)
2. **Problem Statement** — Formal problem definition
3. **Related Work / Close Competitors** — How does this compare to prior work?
4. **Key Insight / Novel Angle** — What's the core new idea?
5-12. **Methodology** — Architecture, algorithm, training procedure, loss functions (multiple chapters)
13-14. **Theoretical Analysis** — If applicable (proofs, bounds, complexity)
15. **Datasets & Benchmarks** — What data is used? How is evaluation done?
16-17. **Results** — Main results tables, comparisons
18. **Ablations** — What components matter most?
19. **Limitations & Future Work** — What are the weaknesses?
20. **Summary** — Key takeaways and impact (no excerpts)

If the user provided a query, STEER the story toward that topic:
- Allocate more chapters to the queried aspect
- Still cover the full paper but with emphasis on the query
- Mention the query focus in the overview chapter

Write the outline to ${generationDir}/outline.md
End the file with: OUTLINE_COMPLETE

### Stage 3: Excerpt Collection
For each chapter, find and collect VERBATIM excerpts from the source:

Each excerpt should be one of:
- **text**: A key paragraph, definition, or claim from the paper
- **equation**: A mathematical equation or formula (raw LaTeX)

For EACH excerpt you collect:
1. Read the source .tex file containing it
2. Copy the EXACT text or LaTeX — character for character
3. Record which file it came from
4. Record the surrounding LaTeX context in \`latexSource\`

Guidelines:
- 1-3 excerpts per chapter (first and last chapters have 0)
- Prefer excerpts that teach something concrete
- For equations, include the full equation environment (\\begin{equation}...\\end{equation} or $...$)
- For text, include enough context to be meaningful (2-6 sentences)
- Clean up minor LaTeX artifacts (\\cite{}, \\ref{}, \\label{}) in the display content but keep them in latexSource

Write excerpts to ${generationDir}/excerpts.md
End the file with: EXCERPTS_COMPLETE

### Stage 4: Verification
For EVERY excerpt collected in Stage 3:
1. Use Grep to search for a distinctive phrase from the excerpt in the source files
2. Confirm the excerpt exists verbatim in the source
3. If an excerpt cannot be verified, REMOVE it or replace it with a verified one

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
          "content": "<Cleaned display text (LaTeX artifacts removed, readable)>",
          "latexSource": "<Raw LaTeX source — exact copy from .tex file>",
          "type": "<text|equation>",
          "sourceFile": "<relative path to source .tex file>",
          "label": "<e.g. 'Section 3.2' or 'Equation 5' or 'Definition 1'>"
        }
      ],
      "explanation": "<Markdown with KaTeX math. Use $...$ for inline, $$...$$ for display.>"
    }
  ]
}
\`\`\`

**Validation before writing:**
1. Every excerpt.content appears (or closely matches) in the source files
2. Every excerpt has a non-empty latexSource field
3. First chapter (Overview) and last chapter (Summary) have \`excerpts: []\`
4. Chapter labels are 2-4 words
5. Chapter IDs are sequential: chapter-0, chapter-1, ...
6. All KaTeX in explanations uses valid LaTeX syntax
7. No hallucinated claims — everything is grounded in the paper
8. Total chapters: 15-25 range

Write the final story.json to ${generationDir}/story.json
After writing, end by creating a file ${generationDir}/DONE containing just the text "DONE".

## Important Notes
- Take your time. Read thoroughly before writing.
- When in doubt, include MORE source context in latexSource, not less.
- For equations, the \`content\` field should be clean LaTeX that KaTeX can render.
- For text excerpts, the \`content\` field should be readable (no \\cite{} etc.) but the \`latexSource\` should be the raw version.
- Generate a proper UUID v4 for the story id.
`;
}
