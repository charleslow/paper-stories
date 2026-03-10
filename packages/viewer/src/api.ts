import { Story } from './types';

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
 * Derive the base URL for region images from the story URL.
 * e.g. "https://...stories/foo.json" -> "https://...stories/foo/regions/"
 */
export function regionsBaseUrl(storyUrl: string): string {
  return storyUrl.replace(/\.json$/, '/regions/');
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

