import { Chapter, Theme } from '../types';
import ThemeToggle from './ThemeToggle';

interface SidebarProps {
  chapters: Chapter[];
  currentChapter: number;
  onSelect: (index: number) => void;
  title: string;
  arxivUrl: string | null;
  sourceUrl?: string | null;
  sourceType?: string | null;
  theme: Theme;
  onToggleTheme: () => void;
}

export default function Sidebar({
  chapters,
  currentChapter,
  onSelect,
  title,
  arxivUrl,
  sourceUrl,
  sourceType,
  theme,
  onToggleTheme,
}: SidebarProps) {
  const sourceHref = arxivUrl || sourceUrl;
  const sourceLabel = arxivUrl ? '📄 arXiv' : sourceType === 'webpage' ? '↗ Webpage' : '↗ Source';

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1 className="sidebar-title">{title}</h1>
        {sourceHref && (
          <a href={sourceHref} target="_blank" rel="noopener noreferrer" className="sidebar-arxiv-link">
            {sourceLabel}
          </a>
        )}
      </div>
      <nav className="sidebar-chapters">
        {chapters.map((ch, i) => (
          <button
            key={ch.id}
            className={`sidebar-chapter ${i === currentChapter ? 'active' : ''} ${i < currentChapter ? 'visited' : ''}`}
            onClick={() => onSelect(i)}
          >
            <span className="chapter-indicator">
              {i < currentChapter ? '✓' : i === currentChapter ? '●' : '○'}
            </span>
            <span className="chapter-label" title={ch.label}>{ch.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <a href="?" className="back-link">← All Stories</a>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>
    </aside>
  );
}
