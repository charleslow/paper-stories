import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ExcerptPanel from './ExcerptPanel';
import { Excerpt } from '../types';

const baseExcerpt: Excerpt = {
  content: 'Attention is all you need.',
  latexSource: 'Attention is all you need.',
  type: 'text',
  sourceFile: 'main.tex',
  label: 'Section 1',
};

describe('ExcerptPanel', () => {
  it('renders excerpt content', () => {
    render(<ExcerptPanel excerpts={[baseExcerpt]} />);
    expect(screen.getByText('Attention is all you need.')).toBeInTheDocument();
  });

  it('renders label and source file', () => {
    render(<ExcerptPanel excerpts={[baseExcerpt]} />);
    expect(screen.getByText('Section 1')).toBeInTheDocument();
    expect(screen.getByText('main.tex')).toBeInTheDocument();
  });

  it('renders type badge for text excerpt', () => {
    render(<ExcerptPanel excerpts={[baseExcerpt]} />);
    expect(screen.getByText('¶ Text')).toBeInTheDocument();
  });

  it('renders type badge for equation excerpt', () => {
    const eqExcerpt: Excerpt = { ...baseExcerpt, type: 'equation', content: 'E=mc^2' };
    render(<ExcerptPanel excerpts={[eqExcerpt]} />);
    expect(screen.getByText('∑ Equation')).toBeInTheDocument();
  });

  it('shows pdf page badge when pdfRegion is present', () => {
    const excerpt: Excerpt = {
      ...baseExcerpt,
      pdfRegion: { page: 4, bbox: [0.1, 0.2, 0.9, 0.35] },
    };
    render(<ExcerptPanel excerpts={[excerpt]} />);
    const badge = screen.getByText('p.5');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute('title', 'PDF page 5');
    expect(badge).toHaveClass('excerpt-pdf-badge');
  });

  it('does not show pdf badge when pdfRegion is absent', () => {
    render(<ExcerptPanel excerpts={[baseExcerpt]} />);
    expect(screen.queryByText(/^p\.\d+$/)).not.toBeInTheDocument();
  });

  it('shows page 1 for page index 0', () => {
    const excerpt: Excerpt = {
      ...baseExcerpt,
      pdfRegion: { page: 0, bbox: [0, 0, 1, 1] },
    };
    render(<ExcerptPanel excerpts={[excerpt]} />);
    expect(screen.getByText('p.1')).toBeInTheDocument();
  });

  it('renders metadata panel when excerpts are empty', () => {
    const meta = {
      title: 'Test Paper',
      arxivId: '2401.12345',
      arxivUrl: 'https://arxiv.org/abs/2401.12345',
      query: 'attention',
    };
    render(<ExcerptPanel excerpts={[]} storyMeta={meta} />);
    expect(screen.getByText('Test Paper')).toBeInTheDocument();
    expect(screen.getByText('arXiv: 2401.12345')).toBeInTheDocument();
    expect(screen.getByText('attention')).toBeInTheDocument();
  });

  it('renders multiple excerpts with mixed pdfRegion presence', () => {
    const excerpts: Excerpt[] = [
      { ...baseExcerpt, label: 'Ex 1', pdfRegion: { page: 2, bbox: [0.1, 0.1, 0.9, 0.5] } },
      { ...baseExcerpt, label: 'Ex 2' },
      { ...baseExcerpt, label: 'Ex 3', pdfRegion: { page: 7, bbox: [0.0, 0.3, 1.0, 0.6] } },
    ];
    render(<ExcerptPanel excerpts={excerpts} />);
    expect(screen.getByText('p.3')).toBeInTheDocument();
    expect(screen.getByText('p.8')).toBeInTheDocument();
    // Only 2 pdf badges, not 3
    const badges = screen.getAllByText(/^p\.\d+$/);
    expect(badges).toHaveLength(2);
  });
});
