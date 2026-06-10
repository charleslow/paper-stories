import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Excerpt, Source, StandardExcerpt } from '../types';
import MathRenderer from './MathRenderer';
import PdfRegionViewer from './PdfRegionViewer';
import ProofExcerptDisplay from './ProofExcerptDisplay';

// Stable palette for distinguishing sources in a collection story. Sources are
// colored by their order in `story.sources`.
const SOURCE_COLORS = ['#4f9dde', '#e0833b', '#5cb87a', '#b87ad6', '#d65c7a', '#c9a93b'];

function sourceColor(index: number): string {
  return SOURCE_COLORS[index % SOURCE_COLORS.length];
}

// "March 2026" / "Mar 2026" / "2026" / "" depending on what is known.
function formatMonthYear(
  year: number | null | undefined,
  month: number | null | undefined,
  monthStyle: 'long' | 'short',
): string {
  if (!year) return '';
  if (!month) return `${year}`;
  const name = new Date(year, month - 1).toLocaleString('en-US', { month: monthStyle });
  return `${name} ${year}`;
}

interface ExcerptPanelProps {
  excerpts: Excerpt[];
  pdfUrl?: string;
  sourcePdfUrls?: Record<string, string>;
  sources?: Source[] | null;
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
  selectedProofStep?: { excerptIndex: number; stepIndex: number } | null;
  onSelectProofStep?: (info: { excerptIndex: number; stepIndex: number } | null) => void;
}

export default function ExcerptPanel({ excerpts, pdfUrl, sourcePdfUrls, sources, storyMeta, selectedProofStep = null, onSelectProofStep = () => {} }: ExcerptPanelProps) {
  const isCollection = !!sources && sources.length > 1;
  // sourceId -> { source, index } for badges and colors.
  const sourceInfo = new Map<string, { source: Source; index: number }>();
  (sources ?? []).forEach((source, index) => sourceInfo.set(source.id, { source, index }));

  if (excerpts.length === 0) {
    // Overview/summary chapter — show metadata (and, for collections, the source list)
    return (
      <div className="excerpt-panel excerpt-panel-empty">
        {isCollection && <SourcesSummary sources={sources!} />}
        {!isCollection && storyMeta && (
          <div className="story-meta">
            <div className="meta-icon">📄</div>
            <h2>{storyMeta.title}</h2>
            {storyMeta.authors && storyMeta.authors.length > 0 && (
              <div className="meta-authors">{storyMeta.authors.join(', ')}</div>
            )}
            {(storyMeta.publishedYear || storyMeta.publishedMonth) && (
              <div className="meta-published">
                {formatMonthYear(storyMeta.publishedYear, storyMeta.publishedMonth, 'long')}
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
      {excerpts.map((excerpt, i) => {
        if (excerpt.type === 'proof') {
          return (
            <ProofExcerptDisplay
              key={i}
              excerpt={excerpt}
              selectedStepIndex={selectedProofStep?.excerptIndex === i ? selectedProofStep.stepIndex : null}
              onSelectStep={(stepIndex) => {
                if (stepIndex === null) {
                  onSelectProofStep(null);
                } else {
                  onSelectProofStep({ excerptIndex: i, stepIndex });
                }
              }}
            />
          );
        }
        // Source attribution (badge + border color) only applies to collections.
        const info = isCollection && excerpt.sourceId ? sourceInfo.get(excerpt.sourceId) : undefined;
        const effectivePdfUrl =
          (excerpt.sourceId && sourcePdfUrls?.[excerpt.sourceId]) || pdfUrl;
        return (
          <ExcerptCard
            key={i}
            excerpt={excerpt}
            pdfUrl={effectivePdfUrl}
            source={info?.source}
            sourceColor={info && sourceColor(info.index)}
          />
        );
      })}
    </div>
  );
}

/** Front-of-story summary of every source in a collection story. */
function SourcesSummary({ sources }: { sources: Source[] }) {
  return (
    <div className="sources-summary">
      <h2 className="sources-summary-title">Sources</h2>
      <p className="sources-summary-sub">This story draws on {sources.length} sources:</p>
      <ol className="sources-summary-list">
        {sources.map((source, index) => {
          const date = formatMonthYear(source.publishedYear, source.publishedMonth, 'short');
          return (
            <li key={source.id} className="sources-summary-item">
              <span className="source-dot" style={{ background: sourceColor(index) }} />
              <div className="sources-summary-body">
                <div className="sources-summary-name">{source.title}</div>
                {source.authors && source.authors.length > 0 && (
                  <div className="sources-summary-authors">{source.authors.join(', ')}{date ? ` · ${date}` : ''}</div>
                )}
                {source.url && (
                  <a href={source.url} target="_blank" rel="noopener noreferrer" className="sources-summary-link">
                    {source.arxivId ? `arXiv: ${source.arxivId}` : source.type === 'webpage' ? 'Open webpage' : 'Open source'}
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const excerptAllowedElements = ['p', 'span', 'div', 'em', 'strong', 'sub', 'sup', 'br'];

function ExcerptCard({ excerpt, pdfUrl, source, sourceColor }: { excerpt: StandardExcerpt; pdfUrl?: string; source?: Source; sourceColor?: string }) {
  const [showSource, setShowSource] = useState(false);

  return (
    <div className={`excerpt-card excerpt-type-${excerpt.type}`} style={sourceColor ? { borderLeft: `3px solid ${sourceColor}` } : undefined}>
      <div className="excerpt-header">
        <span className="excerpt-type-badge">
          {excerpt.type === 'equation' ? '∑ Equation' : excerpt.type === 'figure' ? '▭ Figure' : '¶ Text'}
        </span>
        {source && (
          <span className="excerpt-source-badge" style={{ background: sourceColor }} title={source.title}>
            {source.title}
          </span>
        )}
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
