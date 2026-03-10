import { useState, useEffect } from 'react';
import { fetchLocalStories } from '../api';
import { LocalStoryEntry } from '../types';

interface RecentStory {
  url: string;
  title: string;
  arxivId?: string;
  accessedAt: string;
}

interface LandingPageProps {
  onLoadStory: (url: string) => void;
}

export default function LandingPage({ onLoadStory }: LandingPageProps) {
  const [input, setInput] = useState('');
  const [recent, setRecent] = useState<RecentStory[]>([]);
  const [localStories, setLocalStories] = useState<LocalStoryEntry[]>([]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('paper-stories-recent') || '[]');
      setRecent(stored);
    } catch { /* ignore */ }

    fetchLocalStories().then(setLocalStories);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const trimmed = input.trim();

    // Direct URL to JSON
    if (trimmed.startsWith('http') && trimmed.endsWith('.json')) {
      window.location.search = `?url=${encodeURIComponent(trimmed)}`;
      return;
    }

    // GitHub shorthand: user/repo/story-id
    const ghMatch = trimmed.match(/^([^/]+)\/([^/]+)\/(.+)$/);
    if (ghMatch) {
      const [, owner, repo, story] = ghMatch;
      window.location.search = `?repo=${owner}/${repo}&story=${story}`;
      return;
    }

    // Just a story ID — default to charleslow/code-stories-cache
    window.location.search = `?repo=charleslow/code-stories-cache&story=${trimmed}`;
  };

  return (
    <div className="landing-page">
      <div className="landing-container">
        <h1 className="landing-title">Paper Stories</h1>
        <p className="landing-subtitle">
          Interactive deep-dives into ML research papers
        </p>

        {localStories.length > 0 && (
          <div className="landing-local">
            <h3>Local Stories</h3>
            <ul>
              {localStories.map((s) => (
                <li key={s.id}>
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      onLoadStory(s.url);
                    }}
                  >
                    {s.title}
                    {s.arxivId && <span className="recent-arxiv"> ({s.arxivId})</span>}
                  </a>
                  {s.createdAt && (
                    <span className="recent-date">
                      {new Date(s.createdAt).toLocaleDateString()}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <form className="landing-form" onSubmit={handleSubmit}>
          <input
            type="text"
            className="landing-input"
            placeholder="Enter story ID, GitHub shorthand, or URL..."
            value={input}
            onChange={e => setInput(e.target.value)}
          />
          <button type="submit" className="landing-submit">Load Story</button>
        </form>

        <div className="landing-formats">
          <p><strong>Supported formats:</strong></p>
          <ul>
            <li><code>story-slug</code> — loads from charleslow/code-stories-cache</li>
            <li><code>user/repo/story-id</code> — loads from any GitHub repo</li>
            <li><code>https://...story.json</code> — direct URL</li>
          </ul>
        </div>

        {recent.length > 0 && (
          <div className="landing-recent">
            <h3>Recent Stories</h3>
            <ul>
              {recent.map((r, i) => (
                <li key={i}>
                  <a href={r.url}>
                    {r.title}
                    {r.arxivId && <span className="recent-arxiv"> ({r.arxivId})</span>}
                  </a>
                  <span className="recent-date">
                    {new Date(r.accessedAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
