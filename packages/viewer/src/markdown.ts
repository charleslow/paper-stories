// Fenced blocks, inline code spans, and their separators (capture group) come
// back from split() at odd indices; even indices are prose.
const CODE_SEGMENT_RE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/

// Top-level LaTeX environments that need display-math wrapping. Nested envs
// like `aligned` or `cases` are intentionally excluded.
const DISPLAY_ENV_RE =
  /(?<![\\$])\\begin\{(equation|align|alignat|flalign|gather|multline|eqnarray)(\*?)\}([\s\S]*?)\\end\{\1\2\}/g

/**
 * Normalize LaTeX math delimiters remark-math can't parse.
 *
 * The chat backend asks models to use $...$ / $$...$$, but they sometimes emit
 * \(...\), \[...\], or bare \begin{equation} blocks instead, which render as
 * raw LaTeX. This rewrites those forms at render time; code spans/fences are
 * left untouched.
 */
export function normalizeMathDelimiters(markdown: string): string {
  return markdown
    .split(CODE_SEGMENT_RE)
    .map((segment, i) => (i % 2 === 1 ? segment : normalizeSegment(segment)))
    .join('')
}

function normalizeSegment(text: string): string {
  return text
    .replace(/(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\]/g, (_, math: string) => `$$${math}$$`)
    .replace(/(?<!\\)\\\(([\s\S]*?)(?<!\\)\\\)/g, (_, math: string) => `$${math}$`)
    .replace(DISPLAY_ENV_RE, (m) => `$$${m}$$`)
}
