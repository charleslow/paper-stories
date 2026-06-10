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

/** HEAD-probe a URL; true if it resolves to an existing resource. */
async function pdfExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false; // PDF not available
  }
}

/**
 * Check if a PDF exists alongside the story JSON (same path, .pdf extension).
 * Returns the PDF URL if it exists, or null.
 */
export async function resolvePdfUrl(storyUrl: string): Promise<string | null> {
  const pdfUrl = storyUrl.replace(/\.json$/, '.pdf');
  return (await pdfExists(pdfUrl)) ? pdfUrl : null;
}

/**
 * For multi-source ("collection") stories, resolve each source's PDF URL.
 * Each `source.pdfFile` is a filename sitting next to the story JSON. Returns a
 * map of sourceId → URL for the PDFs that actually exist.
 */
export async function resolveSourcePdfUrls(
  storyUrl: string,
  story: Story,
): Promise<Record<string, string>> {
  const sources = story.sources;
  if (!sources || sources.length === 0) return {};
  const baseDir = storyUrl.replace(/[^/]*$/, ''); // strip filename, keep trailing slash
  const entries = await Promise.all(
    sources.map(async (s): Promise<[string, string] | null> => {
      if (!s.pdfFile) return null;
      const url = baseDir + s.pdfFile;
      return (await pdfExists(url)) ? [s.id, url] : null;
    }),
  );
  return Object.fromEntries(entries.filter((e): e is [string, string] => e !== null));
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

/** Derives the provider name from a model string. Mirrors the backend chatProvider() function. */
export function providerFromModel(model: string | null | undefined): 'claude' | 'codex' | null {
  if (model?.startsWith('claude-')) return 'claude';
  if (model) return 'codex';
  return null;
}

export async function checkChatAvailable(): Promise<{ available: boolean; model: string | null; provider: string | null }> {
  try {
    const res = await fetch('/local-stories/_chat/available');
    if (!res.ok) return { available: false, model: null, provider: null };
    const data = await res.json();
    return {
      available: data.available === true,
      model: typeof data.model === 'string' ? data.model : null,
      provider: typeof data.provider === 'string' ? data.provider : null,
    };
  } catch {
    return { available: false, model: null, provider: null };
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

export async function requestProof(
  storyId: string,
  chapterId: string,
  statement: string,
): Promise<{ chapterId: string }> {
  const res = await fetch(
    `/local-stories/_proof/${encodeURIComponent(storyId)}/${encodeURIComponent(chapterId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ statement }),
    },
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Proof request failed' }));
    throw new Error(err.error || 'Proof request failed');
  }

  const data = await res.json();
  return { chapterId: data.chapterId };
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
