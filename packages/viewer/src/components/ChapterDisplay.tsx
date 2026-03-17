import { useState, useCallback, useEffect } from 'react';
import { Chapter, Theme } from '../types';
import ExcerptPanel from './ExcerptPanel';
import ExplanationPanel from './ExplanationPanel';
import ChatPanel from './ChatPanel';
import ThemeToggle from './ThemeToggle';

interface ChapterDisplayProps {
  chapter: Chapter;
  chapters: Chapter[];
  chapterIndex: number;
  totalChapters: number;
  onNavigate: (index: number) => void;
  pdfUrl?: string;
  chatAvailable: boolean;
  storyId: string;
  storyMeta: {
    title: string;
    arxivId: string;
    arxivUrl: string;
    query: string | null;
  };
  theme: Theme;
  onToggleTheme: () => void;
}

export default function ChapterDisplay({
  chapter,
  chapters,
  chapterIndex,
  totalChapters,
  onNavigate,
  pdfUrl,
  chatAvailable,
  storyId,
  storyMeta,
  theme,
  onToggleTheme,
}: ChapterDisplayProps) {
  const [splitPercent, setSplitPercent] = useState(40);
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState<'excerpts' | 'explanation' | 'chat'>('explanation');
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Draggable splitter
  const handleMouseDown = useCallback(() => setIsDragging(true), []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const container = document.querySelector('.chapter-panels') as HTMLElement;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const percent = ((e.clientX - rect.left) / rect.width) * 100;
      setSplitPercent(Math.max(20, Math.min(80, percent)));
    };

    const handleMouseUp = () => setIsDragging(false);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const isFirst = chapterIndex === 0;
  const isLast = chapterIndex === totalChapters - 1;

  return (
    <main className="chapter-display">
      <header className="chapter-header">
        <div className="chapter-nav">
          <button
            className="nav-btn"
            onClick={() => onNavigate(chapterIndex - 1)}
            disabled={isFirst}
          >
            ← Prev
          </button>
          <span className="chapter-counter">
            Chapter {chapterIndex + 1} of {totalChapters}
          </span>
          <button
            className="nav-btn"
            onClick={() => onNavigate(chapterIndex + 1)}
            disabled={isLast}
          >
            Next →
          </button>
        </div>
      </header>

      {/* Mobile tabs — includes theme toggle since sidebar is hidden at this breakpoint */}
      {isMobile && (
        <div className="mobile-tabs">
          <button
            className={`tab ${activeTab === 'excerpts' ? 'active' : ''}`}
            onClick={() => setActiveTab('excerpts')}
          >
            Paper Excerpts
          </button>
          <button
            className={`tab ${activeTab === 'explanation' ? 'active' : ''}`}
            onClick={() => setActiveTab('explanation')}
          >
            Explanation
          </button>
          {chatAvailable && (
            <button
              className={`tab ${activeTab === 'chat' ? 'active' : ''}`}
              onClick={() => setActiveTab('chat')}
            >
              Chat
            </button>
          )}
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </div>
      )}

      {isMobile ? (
        <div className="chapter-panels-mobile">
          {activeTab === 'excerpts' ? (
            <ExcerptPanel excerpts={chapter.excerpts} pdfUrl={pdfUrl} storyMeta={storyMeta} />
          ) : activeTab === 'chat' && chatAvailable ? (
            <div className="chat-panel-fullscreen">
              <ChatPanel
                storyId={storyId}
                chapterId={chapter.id}
              />
            </div>
          ) : (
            <ExplanationPanel explanation={chapter.explanation} />
          )}
        </div>
      ) : (
        <div className={`chapter-panels ${isDragging ? 'dragging' : ''}`}>
          <div className="panel-left" style={{ width: `${splitPercent}%` }}>
            <ExcerptPanel excerpts={chapter.excerpts} pdfUrl={pdfUrl} storyMeta={storyMeta} />
          </div>
          <div
            className="panel-splitter"
            onMouseDown={handleMouseDown}
          />
          <div className="panel-right" style={{ width: `${100 - splitPercent}%` }}>
            <div className="panel-right-scroll">
              <ExplanationPanel explanation={chapter.explanation} />
              {chatAvailable && (
                <ChatPanel
                  storyId={storyId}
                  chapterId={chapter.id}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
