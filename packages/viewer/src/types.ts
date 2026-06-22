export interface PdfRegion {
  page: number;           // 0-indexed page number
  bbox: [number, number, number, number]; // Normalized [x0, y0, x1, y1] in range [0, 1]
}

export interface StandardExcerpt {
  content: string;
  latexSource: string;
  type: 'text' | 'equation' | 'figure';
  sourceFile: string;
  label: string;
  pdfRegion?: PdfRegion;
  visualUrl?: string;
  visualAlt?: string;
  sourceUrl?: string;
  /**
   * For multi-source ("collection") stories: which entry in `Story.sources`
   * this excerpt was drawn from. `pdfRegion.page` is relative to that source's
   * PDF (`Source.pdfFile`). Absent for single-source stories.
   */
  sourceId?: string;
}

export interface ProofStep {
  content: string;       // Markdown + KaTeX (prose, math, or both)
  explanation?: string;  // Shown in right panel when step is selected
}

export interface ProofExcerpt {
  type: 'proof';
  statement: string;     // The theorem/claim being proved (Markdown + KaTeX)
  label: string;         // e.g. "Theorem 3.1"
  steps: ProofStep[];
}

export type Excerpt = StandardExcerpt | ProofExcerpt;

/**
 * A single source in a multi-source ("collection") story. The `sources` array
 * is summarized at the front of the story and each excerpt references one of
 * these by `id`.
 */
export interface Source {
  id: string;                       // stable within the story, e.g. "s1"
  type: 'arxiv' | 'local' | 'webpage' | string;
  title: string;
  authors?: string[] | null;
  url?: string | null;              // arXiv abstract URL or webpage URL
  arxivId?: string | null;
  pdfFile?: string | null;          // filename of the stored PDF, relative to the story JSON
  publishedYear?: number | null;
  publishedMonth?: number | null;
  institutions?: string[] | null;
}

export interface Chapter {
  id: string;
  label: string;
  excerpts: Excerpt[];
  explanation: string;
}

/**
 * Token usage for one generation stage (index, exploration, outline, excerpts,
 * verification, explanations, assemble). Any field may be null when the stage's
 * runner did not report it.
 */
export interface StageUsage {
  key: string;
  model: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadInputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
  totalTokens?: number | null;
  costUsd?: number | null;
}

export interface GenerationTotals {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadInputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
  totalTokens?: number | null;
  costUsd?: number | null;
}

/**
 * How a story was generated — per-stage model + token usage, surfaced on the
 * overview (first) page of the viewer. Optional: older stories won't have it.
 */
export interface GenerationStats {
  generatedAt?: string;
  stages: StageUsage[];
  totals?: GenerationTotals | null;
}

export interface Story {
  id: string;
  title: string;
  arxivId: string | null;
  arxivUrl: string | null;
  sourceType?: 'arxiv' | 'local' | 'webpage' | 'collection' | string | null;
  sourceUrl?: string | null;
  /** Present for multi-source stories; absent (or length 1) for single-source. */
  sources?: Source[] | null;
  authors: string[] | null;
  publishedYear: number | null;
  publishedMonth: number | null;
  institutions: string[] | null;
  query: string | null;
  createdAt: string;
  chapters: Chapter[];
  chatModel?: string | null;
  /** Per-stage model + token usage (CLI telemetry); shown on the overview page. */
  generation?: GenerationStats | null;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface StoryChat {
  storyId: string;
  chapters: Record<string, ChatMessage[]>;
}

export type Theme = 'dark' | 'eink';
