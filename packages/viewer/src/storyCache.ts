const STORAGE_KEY = 'paper-stories-recent';
const MAX_ENTRIES = 20;

export interface RecentStory {
  url: string;
  title: string;
  authors: string[] | null;
  arxivId: string | null;
  cachedAt: string;
}

export function recordStoryView(
  url: string,
  story: { title: string; authors?: string[] | null; arxivId?: string | null },
): void {
  try {
    const existing = getRecentStories().filter((s) => s.url !== url);
    const updated: RecentStory[] = [
      {
        url,
        title: story.title,
        authors: story.authors ?? null,
        arxivId: story.arxivId ?? null,
        cachedAt: new Date().toISOString(),
      },
      ...existing,
    ].slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {}
}

export function getRecentStories(): RecentStory[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RecentStory[];
  } catch {
    return [];
  }
}
