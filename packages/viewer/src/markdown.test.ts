import { describe, it, expect } from 'vitest';
import { normalizeMathDelimiters } from './markdown';

describe('normalizeMathDelimiters', () => {
  it('converts bracket delimiters to dollar delimiters', () => {
    expect(normalizeMathDelimiters('\\[x^2\\]')).toBe('$$x^2$$');
    expect(normalizeMathDelimiters('\\(x^2\\)')).toBe('$x^2$');
  });

  it('converts multi-line display math', () => {
    const input = 'Before\n\\[\n\\Delta W = BA\n\\]\nAfter';
    expect(normalizeMathDelimiters(input)).toBe('Before\n$$\n\\Delta W = BA\n$$\nAfter');
  });

  it('handles multiple expressions in one message', () => {
    const input = 'Given \\(a\\) and \\(b\\), then \\[c = a + b\\].';
    expect(normalizeMathDelimiters(input)).toBe('Given $a$ and $b$, then $$c = a + b$$.');
  });

  it('wraps bare display environments in dollar delimiters', () => {
    const input = '\\begin{equation}\nx = y\n\\end{equation}';
    expect(normalizeMathDelimiters(input)).toBe('$$\\begin{equation}\nx = y\n\\end{equation}$$');
    const starred = '\\begin{align*}\nx &= y \\\\\n\\end{align*}';
    expect(normalizeMathDelimiters(starred)).toBe(`$$${starred}$$`);
  });

  it('does not rewrap environments already inside display math', () => {
    const input = '$$\\begin{align}\nx &= y\n\\end{align}$$';
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it('leaves dollar-delimited math untouched', () => {
    const input = 'Inline $h_t$ and display $$\nK(x, y)\n$$';
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it('leaves nested environments like aligned untouched', () => {
    const input = '$$\n\\begin{aligned}\nx &= 1 \\\\\n\\end{aligned}\n$$';
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it('does not touch code spans and fenced code blocks', () => {
    const input = 'run `\\(x\\)` then\n```latex\n\\[y\\]\n```\ndone';
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it('leaves escaped brackets alone', () => {
    const input = 'An array index \\\\[0\\\\] in prose';
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it('leaves unmatched delimiters alone', () => {
    const input = 'Unclosed \\(x and trailing \\[';
    expect(normalizeMathDelimiters(input)).toBe(input);
  });
});
