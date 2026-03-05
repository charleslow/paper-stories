import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

interface ExplanationPanelProps {
  explanation: string;
}

/**
 * Renders chapter explanations as Markdown with KaTeX math support.
 * Supports $...$ for inline math and $$...$$ for display math.
 */
export default function ExplanationPanel({ explanation }: ExplanationPanelProps) {
  return (
    <div className="explanation-panel">
      <div className="explanation-content">
        <ReactMarkdown
          remarkPlugins={[remarkMath]}
          rehypePlugins={[rehypeKatex]}
        >
          {explanation}
        </ReactMarkdown>
      </div>
    </div>
  );
}
