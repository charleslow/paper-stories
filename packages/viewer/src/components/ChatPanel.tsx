import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { ChatMessage } from '../types';
import { sendChatMessage, fetchChatHistory } from '../api';

interface ChatPanelProps {
  storyId: string;
  chapterId: string;
}

export default function ChatPanel({
  storyId,
  chapterId,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Reset messages when chapter changes while collapsed
  useEffect(() => {
    if (!expanded) {
      setMessages([]);
      setHistoryLoaded(null);
    }
  }, [chapterId, expanded]);

  // Load chat history only when expanded AND history not yet loaded for this chapter
  useEffect(() => {
    if (!expanded) return;
    const key = `${storyId}:${chapterId}`;
    if (historyLoaded === key) return;

    let cancelled = false;
    fetchChatHistory(storyId).then(chatData => {
      if (!cancelled) {
        setMessages(chatData.chapters[chapterId] || []);
        setHistoryLoaded(key);
      }
    });
    return () => { cancelled = true; };
  }, [storyId, chapterId, expanded, historyLoaded]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when expanded
  useEffect(() => {
    if (expanded) {
      inputRef.current?.focus();
    }
  }, [expanded]);

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

  if (!expanded) {
    return (
      <button className="chat-collapsed-bar" onClick={() => setExpanded(true)}>
        <span className="chat-collapsed-icon">?</span>
        Ask about this chapter
        {messages.length > 0 && (
          <span className="chat-message-count">{messages.length}</span>
        )}
      </button>
    );
  }

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <span className="chat-header-title">Ask about this chapter</span>
        <button className="chat-collapse-btn" onClick={() => setExpanded(false)}>
          Collapse
        </button>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && !loading && (
          <div className="chat-empty">
            Ask a question about this chapter. Claude has context on the current, previous, and next chapters, plus the paper overview.
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`chat-message chat-message-${msg.role}`}>
            <div className="chat-message-role">{msg.role === 'user' ? 'You' : 'Claude'}</div>
            <div className="chat-message-content">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                {msg.content}
              </ReactMarkdown>
            </div>
          </div>
        ))}
        {loading && (
          <div className="chat-message chat-message-assistant">
            <div className="chat-message-role">Claude</div>
            <div className="chat-message-content chat-thinking">Thinking...</div>
          </div>
        )}
        {error && (
          <div className="chat-error">{error}</div>
        )}
        <div ref={messagesEndRef} />
      </div>

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
    </div>
  );
}
