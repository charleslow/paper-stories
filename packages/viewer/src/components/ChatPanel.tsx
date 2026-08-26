import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { ChatMessage } from '../types';
import { sendChatMessage, fetchChatHistory, requestProof } from '../api';
import { normalizeMathDelimiters } from '../markdown';

interface ChatPanelProps {
  storyId: string;
  chapterId: string;
  chatProvider?: string | null;
  onProofAdded?: (chapterId: string) => void;
}

const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
};

function assistantLabel(provider?: string | null): string {
  return (provider && PROVIDER_LABELS[provider]) ?? 'Assistant';
}

export default function ChatPanel({
  storyId,
  chapterId,
  chatProvider,
  onProofAdded,
}: ChatPanelProps) {
  const modelLabel = assistantLabel(chatProvider);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState<string | null>(null);
  const [chatInView, setChatInView] = useState(false);
  const [proofOpen, setProofOpen] = useState(false);
  const [proofStatement, setProofStatement] = useState('');
  const [proofLoading, setProofLoading] = useState(false);
  const [proofError, setProofError] = useState<string | null>(null);
  const [proofResult, setProofResult] = useState<{ chapterId: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatPanelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const prevMessagesLenRef = useRef(0);

  // Track whether chat panel is in the viewport
  useEffect(() => {
    const el = chatPanelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setChatInView(entry.isIntersecting),
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Load chat history when chapter changes
  useEffect(() => {
    const key = `${storyId}:${chapterId}`;
    if (historyLoaded === key) return;

    // Abort any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Keep previous messages visible until new data arrives (avoids flash of empty state)
    fetchChatHistory(storyId, controller.signal).then(chatData => {
      if (!controller.signal.aborted) {
        setMessages(chatData.chapters[chapterId] || []);
        setHistoryLoaded(key);
      }
    });
    return () => { controller.abort(); };
  }, [storyId, chapterId, historyLoaded]);

  // Auto-scroll only when chat area is visible and messages were added (not on initial load / chapter switch)
  useEffect(() => {
    if (messages.length > prevMessagesLenRef.current && chatInView) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    prevMessagesLenRef.current = messages.length;
  }, [messages, chatInView]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    setInput('');
    setError(null);
    setLoading(true);

    const userMsg: ChatMessage = {
      role: 'user',
      content: trimmed,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);

    try {
      const reply = await sendChatMessage(storyId, chapterId, trimmed);
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: reply,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get response');
    } finally {
      setLoading(false);
    }
  }, [input, loading, storyId, chapterId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleRequestProof = useCallback(async () => {
    const trimmed = proofStatement.trim();
    if (!trimmed || proofLoading) return;
    setProofError(null);
    setProofResult(null);
    setProofLoading(true);
    try {
      const result = await requestProof(storyId, chapterId, trimmed);
      setProofResult(result);
      setProofStatement('');
    } catch (err) {
      setProofError(err instanceof Error ? err.message : 'Proof generation failed');
    } finally {
      setProofLoading(false);
    }
  }, [proofStatement, proofLoading, storyId, chapterId]);

  const handleProofKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleRequestProof();
    }
  };

  return (
    <div className="chat-panel" ref={chatPanelRef}>
      <div className="chat-header">
        <span className="chat-header-title">Ask about this chapter</span>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && !loading && (
          <div className="chat-empty">
            Ask a question about this chapter. {modelLabel} has context on the current, previous, and next chapters, plus the paper overview.
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`chat-message chat-message-${msg.role}`}>
            <div className="chat-message-role">{msg.role === 'user' ? 'You' : modelLabel}</div>
            <div className="chat-message-content">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                {normalizeMathDelimiters(msg.content)}
              </ReactMarkdown>
            </div>
          </div>
        ))}
        {loading && (
          <div className="chat-message chat-message-assistant">
            <div className="chat-message-role">{modelLabel}</div>
            <div className="chat-message-content chat-thinking">Thinking...</div>
          </div>
        )}
        {error && (
          <div className="chat-error">{error}</div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {chatInView && (
        <div className="chat-input-bar">
          <textarea
            ref={inputRef}
            className="chat-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question..."
            rows={1}
            disabled={loading}
          />
          <button
            className="chat-send-btn"
            onClick={handleSend}
            disabled={loading || !input.trim()}
          >
            Send
          </button>
        </div>
      )}

      {onProofAdded && (
        <div className="proof-request-section">
          <button
            className="proof-request-toggle"
            onClick={() => { setProofOpen(o => !o); setProofError(null); setProofResult(null); }}
          >
            {proofOpen ? '▾' : '▸'} Request proof walkthrough
          </button>
          {proofOpen && (
            <div className="proof-request-form">
              {proofResult ? (
                <div className="proof-request-success">
                  <span>Proof walkthrough added.</span>
                  <button
                    className="proof-goto-btn"
                    onClick={() => onProofAdded(proofResult.chapterId)}
                  >
                    Go to proof →
                  </button>
                </div>
              ) : (
                <>
                  <textarea
                    className="chat-input proof-request-input"
                    value={proofStatement}
                    onChange={e => setProofStatement(e.target.value)}
                    onKeyDown={handleProofKeyDown}
                    placeholder="Which statement do you want proved?"
                    rows={2}
                    disabled={proofLoading}
                  />
                  <button
                    className="chat-send-btn"
                    onClick={handleRequestProof}
                    disabled={proofLoading || !proofStatement.trim()}
                  >
                    {proofLoading ? 'Generating…' : 'Generate'}
                  </button>
                  {proofError && <div className="chat-error">{proofError}</div>}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
