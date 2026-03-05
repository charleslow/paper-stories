import { useMemo } from 'react';
import katex from 'katex';

interface MathRendererProps {
  math: string;
  display?: boolean;
}

/**
 * Renders LaTeX math using KaTeX.
 * Falls back to raw LaTeX on errors.
 */
export default function MathRenderer({ math, display = false }: MathRendererProps) {
  const html = useMemo(() => {
    try {
      // Clean up common LaTeX environments that KaTeX handles
      let cleaned = math.trim();

      // Strip outer equation/align environments — KaTeX handles the math inside
      cleaned = cleaned
        .replace(/\\begin\{(?:equation|align|gather|multline)\*?\}/g, '')
        .replace(/\\end\{(?:equation|align|gather|multline)\*?\}/g, '')
        .replace(/\\label\{[^}]*\}/g, '')
        .replace(/\\tag\{[^}]*\}/g, '')
        .trim();

      // If there are \\ newlines, wrap in aligned environment
      if (cleaned.includes('\\\\') && !cleaned.includes('\\begin{')) {
        cleaned = `\\begin{aligned}${cleaned}\\end{aligned}`;
      }

      return katex.renderToString(cleaned, {
        displayMode: display,
        throwOnError: false,
        trust: true,
        strict: false,
      });
    } catch {
      return null;
    }
  }, [math, display]);

  if (html) {
    return <span dangerouslySetInnerHTML={{ __html: html }} />;
  }

  // Fallback: show raw LaTeX in a code block
  return <code className="math-fallback">{math}</code>;
}
