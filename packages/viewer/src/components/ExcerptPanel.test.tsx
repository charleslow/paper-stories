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

  it('renders text excerpt with no math as plain text', () => {
    const noMathExcerpt: Excerpt = {
      content: 'This excerpt has no math at all.',
      latexSource: 'This excerpt has no math at all.',
      type: 'text',
      sourceFile: 'main.tex',
      label: 'Section 3',
    };
    const { container } = render(<ExcerptPanel excerpts={[noMathExcerpt]} />);
    expect(screen.getByText('This excerpt has no math at all.')).toBeInTheDocument();
    expect(container.querySelectorAll('.katex').length).toBe(0);
  });

  it('renders escaped dollar signs as literal text', () => {
    const escapedExcerpt: Excerpt = {
      content: 'The cost is \\$5 per unit.',
      latexSource: 'The cost is \\$5 per unit.',
      type: 'text',
      sourceFile: 'main.tex',
      label: 'Section 4',
    };
    const { container } = render(<ExcerptPanel excerpts={[escapedExcerpt]} />);
    expect(container.querySelectorAll('.katex').length).toBe(0);
  });

  it('renders display math ($$...$$) in text excerpts', () => {
    const displayMathExcerpt: Excerpt = {
      content: 'The loss function is defined as:\n\n$$L = -\\sum_{i} y_i \\log(p_i)$$',
      latexSource: 'The loss function is defined as:\n\n$$L = -\\sum_{i} y_i \\log(p_i)$$',
      type: 'text',
      sourceFile: 'main.tex',
      label: 'Section 5',
    };
    const { container } = render(<ExcerptPanel excerpts={[displayMathExcerpt]} />);
    const katexElements = container.querySelectorAll('.katex');
    expect(katexElements.length).toBeGreaterThan(0);
  });

  it('renders inline math in figure captions', () => {
    const figureExcerpt: Excerpt = {
      content: 'Performance of $\\alpha$-tuning across datasets.',
      latexSource: 'Performance of $\\alpha$-tuning across datasets.',
      type: 'figure',
      sourceFile: 'main.tex',
      label: 'Figure 1',
      pdfRegion: { page: 2, bbox: [0.1, 0.1, 0.9, 0.5] },
    };
    const { container } = render(<ExcerptPanel excerpts={[figureExcerpt]} pdfUrl="/test.pdf" />);
    const katexElements = container.querySelectorAll('.katex');
    expect(katexElements.length).toBeGreaterThan(0);
  });

  it('does not render disallowed markdown elements in excerpts', () => {
    const markdownExcerpt: Excerpt = {
      content: '# Heading\n\nSome text with $x^2$ math.',
      latexSource: '# Heading\n\nSome text with $x^2$ math.',
      type: 'text',
      sourceFile: 'main.tex',
      label: 'Section 6',
    };
    const { container } = render(<ExcerptPanel excerpts={[markdownExcerpt]} />);
    expect(container.querySelectorAll('h1').length).toBe(0);
    expect(container.querySelectorAll('.katex').length).toBeGreaterThan(0);
    expect(screen.getByText(/Heading/)).toBeInTheDocument();
  });
});
