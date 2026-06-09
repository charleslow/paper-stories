import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

interface ExplanationPanelProps {
  explanation: string;
  proofStepExplanation?: string | null;
  proofStepLabel?: string | null;
  onClearProofStep?: () => void;
}

export default function ExplanationPanel({
  explanation,
  proofStepExplanation,
  proofStepLabel,
  onClearProofStep,
}: ExplanationPanelProps) {
  const content = proofStepExplanation ?? explanation;

  return (
    <div className="explanation-panel">
      {proofStepExplanation && (
        <div className="proof-step-explanation-header">
          <span className="proof-step-explanation-label">
            {proofStepLabel ?? 'Step explanation'}
          </span>
          <button className="proof-step-explanation-back" onClick={onClearProofStep}>
            ← Chapter overview
          </button>
        </div>
      )}
      <div className="explanation-content">
        <ReactMarkdown
          remarkPlugins={[remarkMath]}
          rehypePlugins={[rehypeKatex]}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
