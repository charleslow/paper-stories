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

export interface Chapter {
  id: string;
  label: string;
  excerpts: Excerpt[];
  explanation: string;
}

export interface Story {
  id: string;
  title: string;
  arxivId: string | null;
  arxivUrl: string | null;
  sourceType?: 'arxiv' | 'local' | 'webpage' | string | null;
  sourceUrl?: string | null;
  authors: string[] | null;
  publishedYear: number | null;
  publishedMonth: number | null;
  institutions: string[] | null;
  query: string | null;
  createdAt: string;
  chapters: Chapter[];
  chatModel?: string | null;
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
