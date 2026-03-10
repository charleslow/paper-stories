import { useState } from 'react';
import { Excerpt } from '../types';
import MathRenderer from './MathRenderer';

interface ExcerptPanelProps {
  excerpts: Excerpt[];
  chapterId?: string;
  regionsBaseUrl?: string;
  storyMeta?: {
    title: string;
    arxivId: string;
    arxivUrl: string;
    query: string | null;
  };
}

export default function ExcerptPanel({ excerpts, chapterId, regionsBaseUrl, storyMeta }: ExcerptPanelProps) {
  if (excerpts.length === 0) {
    // Overview/summary chapter — show metadata
    return (
      <div className="excerpt-panel excerpt-panel-empty">
        {storyMeta && (
          <div className="story-meta">
            <div className="meta-icon">📄</div>
            <h2>{storyMeta.title}</h2>
            <a
              href={storyMeta.arxivUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="meta-arxiv"
            >
              arXiv: {storyMeta.arxivId}
            </a>
            {storyMeta.query && (
              <div className="meta-query">
                <span className="meta-query-label">Focus:</span> {storyMeta.query}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Build region image URL: {regionsBaseUrl}{chapterId}.png
  const regionImageUrl = chapterId && regionsBaseUrl
    ? `${regionsBaseUrl}${chapterId}.png`
    : undefined;

  return (
    <div className="excerpt-panel">
      {excerpts.map((excerpt, i) => (
        <ExcerptCard key={i} excerpt={excerpt} regionImageUrl={regionImageUrl} />
      ))}
    </div>
  );
}

function ExcerptCard({ excerpt, regionImageUrl }: { excerpt: Excerpt; regionImageUrl?: string }) {
  const [showSource, setShowSource] = useState(false);
  const [imageError, setImageError] = useState(false);

  const showRegionImage = !!regionImageUrl && !!excerpt.pdfRegion && !imageError;

  return (
    <div className={`excerpt-card excerpt-type-${excerpt.type}`}>
      <div className="excerpt-header">
        <span className="excerpt-type-badge">
          {excerpt.type === 'equation' ? '∑ Equation' : '¶ Text'}
        </span>
        {excerpt.label && <span className="excerpt-label">{excerpt.label}</span>}
        {excerpt.sourceFile && (
          <span className="excerpt-source-file">{excerpt.sourceFile}</span>
        )}
        {excerpt.pdfRegion && (
          <span className="excerpt-pdf-badge" title={`PDF page ${excerpt.pdfRegion.page + 1}`}>
            p.{excerpt.pdfRegion.page + 1}
          </span>
        )}
      </div>

      <div className="excerpt-content">
        {excerpt.type === 'equation' ? (
          <MathRenderer math={excerpt.content} display={true} />
        ) : (
          <blockquote className="excerpt-text">{excerpt.content}</blockquote>
        )}
      </div>

      {showRegionImage && (
        <div className="excerpt-pdf-region">
          <div className="excerpt-pdf-region-label">
            PDF — page {excerpt.pdfRegion!.page + 1}
          </div>
          <img
            src={regionImageUrl}
            alt={`PDF region for ${excerpt.label || 'excerpt'}`}
            className="excerpt-pdf-region-img"
            loading="lazy"
            onError={() => setImageError(true)}
          />
        </div>
      )}

      <button
        className="excerpt-source-toggle"
        onClick={() => setShowSource(!showSource)}
      >
        {showSource ? '▾ Hide LaTeX Source' : '▸ Show LaTeX Source'}
      </button>

      {showSource && (
        <pre className="excerpt-latex-source">
          <code>{excerpt.latexSource}</code>
        </pre>
      )}
    </div>
  );
}
