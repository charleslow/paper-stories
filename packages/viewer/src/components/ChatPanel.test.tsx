import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import ChatPanel from './ChatPanel';
import { ChatMessage } from '../types';

const historyMessages: Record<string, ChatMessage[]> = {
  'chapter-1': [
    {
      role: 'assistant',
      content:
        'The update \\(\\Delta W = BA\\) is low-rank. In full:\n\n\\[\nB \\in \\mathbb{R}^{m \\times r}\n\\]\n\nAnd standard dollar math $h_t$ still works.',
      timestamp: '2026-08-26T10:00:00.000Z',
    },
  ],
};

vi.mock('../api', () => ({
  sendChatMessage: vi.fn(),
  fetchChatHistory: vi.fn(async () => ({
    storyId: 'test-story',
    chapters: historyMessages,
  })),
  requestProof: vi.fn(),
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe('ChatPanel', () => {
  it('renders assistant math from both dollar and paren/bracket delimiters', async () => {
    const { container } = render(
      <ChatPanel storyId="test-story" chapterId="chapter-1" />,
    );

    await waitFor(() => {
      const katex = container.querySelectorAll('.chat-message-content .katex');
      expect(katex.length).toBeGreaterThanOrEqual(3);
    });
    expect(container.querySelectorAll('.katex-display').length).toBe(1);
    // KaTeX keeps the LaTeX source in MathML annotations; assert the raw
    // delimiters never leak into the rendered text instead.
    expect(container.textContent).not.toContain('\\(');
    expect(container.textContent).not.toContain('\\)');
  });
});
