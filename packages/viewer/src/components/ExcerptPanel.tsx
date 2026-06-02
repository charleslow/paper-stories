import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Excerpt } from '../types';
import MathRenderer from './MathRenderer';
import PdfRegionViewer from './PdfRegionViewer';

interface ExcerptPanelProps {
  excerpts: Excerpt[];
  pdfUrl?: string;
  storyMeta?: {
    title: string;
    arxivId: string | null;
    arxivUrl: string | null;
    sourceType?: string | null;
    sourceUrl?: string | null;
    authors: string[] | null;
    publishedYear: number | null;
    publishedMonth: number | null;
    institutions: string[] | null;
    query: string | null;
  };
}

export default function ExcerptPanel({ excerpts, pdfUrl, storyMeta }: ExcerptPanelProps) {
  if (excerpts.length === 0) {
    // Overview/summary chapter — show metadata
    return (
      <div className="excerpt-panel excerpt-panel-empty">
        {storyMeta && (
          <div className="story-meta">
            <div className="meta-icon">📄</div>
            <h2>{storyMeta.title}</h2>
            {storyMeta.authors && storyMeta.authors.length > 0 && (
              <div className="meta-authors">{storyMeta.authors.join(', ')}</div>
            )}
            {(storyMeta.publishedYear || storyMeta.publishedMonth) && (
              <div className="meta-published">
                {storyMeta.publishedMonth && storyMeta.publishedYear
                  ? `${new Date(storyMeta.publishedYear, storyMeta.publishedMonth - 1).toLocaleString('en-US', { month: 'long' })} ${storyMeta.publishedYear}`
                  : storyMeta.publishedYear ?? ''}
              </div>
            )}
            {storyMeta.institutions && storyMeta.institutions.length > 0 && (
              <div className="meta-institutions">{storyMeta.institutions.join(' · ')}</div>
            )}
            {storyMeta.arxivUrl && storyMeta.arxivId ? (
              <a
                href={storyMeta.arxivUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="meta-arxiv"
              >
                arXiv: {storyMeta.arxivId}
              </a>
            ) : storyMeta.sourceUrl ? (
              <a
                href={storyMeta.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="meta-arxiv"
              >
                {storyMeta.sourceType === 'webpage' ? 'Open webpage' : 'Open source'}
              </a>
            ) : null}
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

  return (
    <div className="excerpt-panel">
      {excerpts.map((excerpt, i) => (
        <ExcerptCard key={i} excerpt={excerpt} pdfUrl={pdfUrl} />
      ))}
    </div>
  );
}

const excerptAllowedElements = ['p', 'span', 'div', 'em', 'strong', 'sub', 'sup', 'br'];

function ExcerptCard({ excerpt, pdfUrl }: { excerpt: Excerpt; pdfUrl?: string }) {
  const [showSource, setShowSource] = useState(false);

  return (
    <div className={`excerpt-card excerpt-type-${excerpt.type}`}>
      <div className="excerpt-header">
        <span className="excerpt-type-badge">
          {excerpt.type === 'equation' ? '∑ Equation' : excerpt.type === 'figure' ? '▭ Figure' : '¶ Text'}
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

      {excerpt.type === 'figure' && excerpt.visualUrl ? (
        <>
          <figure className="excerpt-visual">
            <img src={excerpt.visualUrl} alt={excerpt.visualAlt || excerpt.content || excerpt.label || 'Webpage figure'} />
            {excerpt.content && (
              <figcaption className="excerpt-content excerpt-caption">
                <ReactMarkdown
                  remarkPlugins={[remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                  allowedElements={excerptAllowedElements}
                  unwrapDisallowed={true}
                >
                  {excerpt.content}
                </ReactMarkdown>
              </figcaption>
            )}
          </figure>
        </>
      ) : excerpt.type === 'figure' && pdfUrl && excerpt.pdfRegion ? (
        <>
          <PdfRegionViewer
            pdfUrl={pdfUrl}
            page={excerpt.pdfRegion.page}
            bbox={excerpt.pdfRegion.bbox}
          />
          {excerpt.content && (
            <div className="excerpt-content excerpt-caption">
              <ReactMarkdown
                remarkPlugins={[remarkMath]}
                rehypePlugins={[rehypeKatex]}
                allowedElements={excerptAllowedElements}
                unwrapDisallowed={true}
              >
                {excerpt.content}
              </ReactMarkdown>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="excerpt-content">
            {excerpt.type === 'equation' ? (
              <MathRenderer math={excerpt.content} display={true} />
            ) : (
              <blockquote className="excerpt-text">
                <ReactMarkdown
                  remarkPlugins={[remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                  allowedElements={excerptAllowedElements}
                  unwrapDisallowed={true}
                >
                  {excerpt.content}
                </ReactMarkdown>
              </blockquote>
            )}
          </div>
          {pdfUrl && excerpt.pdfRegion && (
            <PdfRegionViewer
              pdfUrl={pdfUrl}
              page={excerpt.pdfRegion.page}
              bbox={excerpt.pdfRegion.bbox}
            />
          )}
        </>
      )}

      <button
        className="excerpt-source-toggle"
        onClick={() => setShowSource(!showSource)}
      >
        {showSource ? '▾ Hide Source' : '▸ Show Source'}
      </button>

      {showSource && (
        <pre className="excerpt-latex-source">
          <code>{excerpt.latexSource}</code>
        </pre>
      )}
    </div>
  );
}
