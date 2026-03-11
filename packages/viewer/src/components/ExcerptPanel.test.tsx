import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ExcerptPanel from './ExcerptPanel';
import { Excerpt } from '../types';

vi.mock('./PdfRegionViewer', () => ({
  default: () => <div data-testid="pdf-region-viewer" />,
}));

const baseExcerpt: Excerpt = {
  content: 'Attention is all you need.',
  latexSource: 'Attention is all you need.',
  type: 'text',
  sourceFile: 'main.tex',
  label: 'Section 1',
};

describe('ExcerptPanel', () => {
  it('renders excerpt with content and metadata', () => {
    render(<ExcerptPanel excerpts={[baseExcerpt]} />);
    expect(screen.getByText('Attention is all you need.')).toBeInTheDocument();
    expect(screen.getByText('Section 1')).toBeInTheDocument();
    expect(screen.getByText('¶ Text')).toBeInTheDocument();
  });

  it('shows pdf page badge only when pdfRegion is present', () => {
    const withRegion: Excerpt = {
      ...baseExcerpt,
      pdfRegion: { page: 4, bbox: [0.1, 0.2, 0.9, 0.35] },
    };
    const { unmount } = render(<ExcerptPanel excerpts={[withRegion]} />);
    const badge = screen.getByText('p.5');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute('title', 'PDF page 5');
    unmount();

    render(<ExcerptPanel excerpts={[baseExcerpt]} />);
    expect(screen.queryByText(/^p\.\d+$/)).not.toBeInTheDocument();
  });

  it('renders inline math in text excerpts', () => {
    const mathExcerpt: Excerpt = {
      content: 'The parameter $\\lambda$ controls the balance.',
      latexSource: 'The parameter $\\lambda$ controls the balance.',
      type: 'text',
      sourceFile: 'main.tex',
      label: 'Section 2',
    };
    const { container } = render(<ExcerptPanel excerpts={[mathExcerpt]} />);
    const katexElements = container.querySelectorAll('.katex');
    expect(katexElements.length).toBeGreaterThan(0);
  });

  it('renders empty state with story metadata', () => {
    render(<ExcerptPanel excerpts={[]} storyMeta={{
      title: 'Test Paper', arxivId: '2401.12345',
      arxivUrl: 'https://arxiv.org/abs/2401.12345', query: null,
    }} />);
    expect(screen.getByText('Test Paper')).toBeInTheDocument();
  });
});
