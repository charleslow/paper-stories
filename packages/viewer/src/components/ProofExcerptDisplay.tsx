import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { ProofExcerpt } from '../types';

interface ProofExcerptDisplayProps {
  excerpt: ProofExcerpt;
  selectedStepIndex: number | null;
  onSelectStep: (index: number | null) => void;
}

function ProofMd({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
      {children}
    </ReactMarkdown>
  );
}

export default function ProofExcerptDisplay({
  excerpt,
  selectedStepIndex,
  onSelectStep,
}: ProofExcerptDisplayProps) {
  const [expanded, setExpanded] = useState(false);

  const handleStepClick = (index: number) => {
    if (!excerpt.steps[index].explanation) return;
    onSelectStep(selectedStepIndex === index ? null : index);
  };

  return (
    <div className="excerpt-card excerpt-type-proof">
      <div className="excerpt-header">
        <span className="excerpt-type-badge">∴ Proof</span>
        {excerpt.label && <span className="excerpt-label">{excerpt.label}</span>}
      </div>

      <div className="proof-statement">
        <ProofMd>{excerpt.statement}</ProofMd>
      </div>

      <button
        className="proof-expand-toggle"
        onClick={() => setExpanded(e => !e)}
      >
        {expanded ? '▾ Collapse proof' : '▸ Walk through proof'}
      </button>

      {expanded && (
        <ol className="proof-steps">
          {excerpt.steps.map((step, i) => {
            const isSelected = selectedStepIndex === i;
            const hasExplanation = !!step.explanation;
            return (
              <li
                key={i}
                className={`proof-step${isSelected ? ' proof-step-selected' : ''}${hasExplanation ? ' proof-step-clickable' : ''}`}
                onClick={() => handleStepClick(i)}
                title={hasExplanation ? 'Click to see explanation' : undefined}
              >
                <span className="proof-step-number">{i + 1}</span>
                <div className="proof-step-content">
                  <ProofMd>{step.content}</ProofMd>
                </div>
                {hasExplanation && (
                  <span className="proof-step-indicator" aria-hidden="true">
                    {isSelected ? '◉' : '○'}
                  </span>
                )}
              </li>
            );
          })}
          <li className="proof-step proof-qed">
            <span className="proof-step-number" />
            <div className="proof-step-content proof-qed-mark">∎</div>
          </li>
        </ol>
      )}
    </div>
  );
}
