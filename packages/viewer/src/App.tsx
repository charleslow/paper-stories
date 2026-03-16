import { useState, useEffect, useCallback } from 'react';
import { Story } from './types';
import { parseStoryUrl, fetchStory, resolvePdfUrl, checkChatAvailable } from './api';
import Sidebar from './components/Sidebar';
import ChapterDisplay from './components/ChapterDisplay';
import LandingPage from './components/LandingPage';
import ThemeToggle from './components/ThemeToggle';

type AppState =
  | { status: 'landing' }
  | { status: 'loading'; url: string }
  | { status: 'error'; message: string }
  | { status: 'ready'; story: Story; currentChapter: number; pdfUrl: string | null; chatAvailable: boolean };

function useTheme() {
  const [theme, setTheme] = useState(() =>
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('paper-stories-theme') || 'dark'
      : 'dark'
  );

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
    try { localStorage.setItem('paper-stories-theme', theme); } catch {}
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme(t => t === 'dark' ? 'grayscale' : 'dark');
  }, []);

  return { theme, toggle };
}

export default function App() {
  const [state, setState] = useState<AppState>({ status: 'landing' });
  const { theme, toggle: toggleTheme } = useTheme();

  useEffect(() => {
    const { storyUrl } = parseStoryUrl();
    if (storyUrl) {
      setState({ status: 'loading', url: storyUrl });
      Promise.all([fetchStory(storyUrl), resolvePdfUrl(storyUrl), checkChatAvailable()])
        .then(([story, pdfUrl, chatAvailable]) => {
          setState({ status: 'ready', story, currentChapter: 0, pdfUrl, chatAvailable });
          saveRecent(story);
        })
        .catch(err => {
          setState({ status: 'error', message: err.message });
        });
    }
  }, []);

  const navigateChapter = useCallback((index: number) => {
    setState(prev => {
      if (prev.status !== 'ready') return prev;
      const clamped = Math.max(0, Math.min(index, prev.story.chapters.length - 1));
      return { ...prev, currentChapter: clamped };
    });
  }, []);

  // Keyboard navigation
  useEffect(() => {
    if (state.status !== 'ready') return;

    const handler = (e: KeyboardEvent) => {
      // Don't capture when typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case 'ArrowLeft':
        case 'h':
          navigateChapter(state.currentChapter - 1);
          break;
        case 'ArrowRight':
        case 'l':
          navigateChapter(state.currentChapter + 1);
          break;
        case 'Home':
          navigateChapter(0);
          break;
        case 'End':
          navigateChapter(state.story.chapters.length - 1);
          break;
        default:
          if (e.key >= '1' && e.key <= '9') {
            navigateChapter(parseInt(e.key) - 1);
          }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [state, navigateChapter]);

  if (state.status === 'landing') {
    return <LandingPage theme={theme} onToggleTheme={toggleTheme} />;
  }

  if (state.status === 'loading') {
    return (
      <div className="loading-view">
        <div className="loading-spinner" />
        <p>Loading paper story...</p>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="error-view">
        <h2>Failed to load story</h2>
        <p>{state.message}</p>
        <a href="?" className="back-link">← Back to home</a>
      </div>
    );
  }

  const { story, currentChapter, pdfUrl, chatAvailable } = state;
  const chapter = story.chapters[currentChapter];

  return (
    <div className="app-layout">
      <Sidebar
        chapters={story.chapters}
        currentChapter={currentChapter}
        onSelect={navigateChapter}
        title={story.title}
        arxivUrl={story.arxivUrl}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      <ChapterDisplay
        chapter={chapter}
        chapters={story.chapters}
        chapterIndex={currentChapter}
        totalChapters={story.chapters.length}
        onNavigate={navigateChapter}
        pdfUrl={pdfUrl ?? undefined}
        chatAvailable={chatAvailable}
        storyId={story.id}
        storyMeta={{
          title: story.title,
          arxivId: story.arxivId,
          arxivUrl: story.arxivUrl,
          query: story.query,
        }}
      />
    </div>
  );
}

function saveRecent(story: Story) {
  try {
    const key = 'paper-stories-recent';
    const existing = JSON.parse(localStorage.getItem(key) || '[]');
    const entry = {
      url: window.location.href,
      title: story.title,
      arxivId: story.arxivId,
      accessedAt: new Date().toISOString(),
    };
    const filtered = existing.filter((e: { url: string }) => e.url !== entry.url);
    filtered.unshift(entry);
    localStorage.setItem(key, JSON.stringify(filtered.slice(0, 10)));
  } catch {
    // localStorage might be unavailable
  }
}
