import { useState, useEffect, useCallback } from 'react';
import { Story } from './types';
import { parseStoryUrl, fetchStory, resolvePdfUrl } from './api';
import Sidebar from './components/Sidebar';
import ChapterDisplay from './components/ChapterDisplay';
import LandingPage from './components/LandingPage';

type AppState =
  | { status: 'landing' }
  | { status: 'loading'; url: string }
  | { status: 'error'; message: string }
  | { status: 'ready'; story: Story; currentChapter: number; pdfUrl: string | null };

export default function App() {
  const [state, setState] = useState<AppState>({ status: 'landing' });

  useEffect(() => {
    const { storyUrl } = parseStoryUrl();
    if (storyUrl) {
      setState({ status: 'loading', url: storyUrl });
      Promise.all([fetchStory(storyUrl), resolvePdfUrl(storyUrl)])
        .then(([story, pdfUrl]) => {
          setState({ status: 'ready', story, currentChapter: 0, pdfUrl });
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
    return <LandingPage />;
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

  const { story, currentChapter, pdfUrl } = state;
  const chapter = story.chapters[currentChapter];

  return (
    <div className="app-layout">
      <Sidebar
        chapters={story.chapters}
        currentChapter={currentChapter}
        onSelect={navigateChapter}
        title={story.title}
        arxivUrl={story.arxivUrl}
      />
      <ChapterDisplay
        chapter={chapter}
        chapterIndex={currentChapter}
        totalChapters={story.chapters.length}
        onNavigate={navigateChapter}
        pdfUrl={pdfUrl ?? undefined}
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
