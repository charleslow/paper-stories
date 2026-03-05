import { useMemo } from 'react';
import katex from 'katex';

interface MathRendererProps {
  math: string;
  display?: boolean;
}

/**
 * Renders KaTeX-compatible LaTeX math.
 * The content is pre-cleaned by the generation pipeline, so minimal processing needed.
 * Falls back to raw LaTeX on errors.
 */
export default function MathRenderer({ math, display = false }: MathRendererProps) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(math.trim(), {
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
