export default function ThemeToggle({ theme, onToggle }: { theme: string; onToggle: () => void }) {
  return (
    <button className="theme-toggle" onClick={onToggle}>
      {theme === 'grayscale' ? 'Color mode' : 'E-ink mode'}
    </button>
  );
}
