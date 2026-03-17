import { Story, StoryChat } from './types';

/**
 * Parse URL parameters to determine where to fetch the story from.
 *
 * Supported URL formats:
 *   ?url=<direct-json-url>
 *   ?repo=user/repo&story=story-id
 *   ?repo=user/repo&branch=main&story=story-id
 */
export function parseStoryUrl(): { storyUrl: string | null } {
  const params = new URLSearchParams(window.location.search);

  // Direct URL
  const directUrl = params.get('url');
  if (directUrl) {
    return { storyUrl: directUrl };
  }

  // GitHub repo shorthand
  const repo = params.get('repo');
  const story = params.get('story');
  const branch = params.get('branch') || 'main';

  if (repo && story) {
    const [owner, repoName] = repo.split('/');
    const url = `https://raw.githubusercontent.com/${owner}/${repoName}/${branch}/stories/${story}.json`;
    return { storyUrl: url };
  }

  return { storyUrl: null };
}

/**
 * Fetch and validate a story JSON.
 */
export async function fetchStory(url: string): Promise<Story> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch story: ${response.status} ${response.statusText}`);
    }

    const story = await response.json();
    validateStory(story);
    return story as Story;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Check if a PDF exists alongside the story JSON (same path, .pdf extension).
 * Returns the PDF URL if it exists, or null.
 */
export async function resolvePdfUrl(storyUrl: string): Promise<string | null> {
  const pdfUrl = storyUrl.replace(/\.json$/, '.pdf');
  try {
    const response = await fetch(pdfUrl, { method: 'HEAD' });
    if (response.ok) {
      return pdfUrl;
    }
  } catch {
    // PDF not available
  }
  return null;
}

// Local story discovery
export interface LocalStory {
  id: string;
  title: string;
  arxivId: string | null;
  createdAt: string | null;
  modifiedAt: string | null;
  url: string;
}

export async function fetchLocalStories(): Promise<LocalStory[]> {
  try {
    const res = await fetch('/local-stories/_discover');
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

// Chat API — only works when running locally (Vite dev/preview server)

export async function checkChatAvailable(): Promise<boolean> {
  try {
    const res = await fetch('/local-stories/_chat/available');
    if (!res.ok) return false;
    const data = await res.json();
    return data.available === true;
  } catch {
    return false;
  }
}

export async function fetchChatHistory(storyId: string, signal?: AbortSignal): Promise<StoryChat> {
  try {
    const res = await fetch(`/local-stories/_chat/${encodeURIComponent(storyId)}`, { signal });
    if (!res.ok) return { storyId, chapters: {} };
    return await res.json();
  } catch {
    return { storyId, chapters: {} };
  }
}

export async function sendChatMessage(
  storyId: string,
  chapterId: string,
  message: string,
): Promise<string> {
  const res = await fetch(
    `/local-stories/_chat/${encodeURIComponent(storyId)}/${encodeURIComponent(chapterId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    },
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Chat request failed' }));
    throw new Error(err.error || 'Chat request failed');
  }

  const data = await res.json();
  return data.reply;
}

function validateStory(data: unknown): asserts data is Story {
  const story = data as Record<string, unknown>;

  if (!story.id || typeof story.id !== 'string') throw new Error('Invalid story: missing id');
  if (!story.title || typeof story.title !== 'string') throw new Error('Invalid story: missing title');
  if (!Array.isArray(story.chapters) || story.chapters.length === 0) {
    throw new Error('Invalid story: missing or empty chapters');
  }

  for (const ch of story.chapters as Record<string, unknown>[]) {
    if (!ch.id || !ch.label || !ch.explanation) {
      throw new Error(`Invalid chapter: missing required fields in ${ch.id}`);
    }
    if (!Array.isArray(ch.excerpts)) {
      throw new Error(`Invalid chapter: excerpts must be array in ${ch.id}`);
    }
  }
}

