import { Theme } from '../types';

export default function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  return (
    <button className="theme-toggle" onClick={onToggle}>
      {theme === 'eink' ? 'Color mode' : 'E-ink mode'}
    </button>
  );
}
