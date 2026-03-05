export interface Excerpt {
  content: string;
  latexSource: string;
  type: 'text' | 'equation';
  sourceFile: string;
  label: string;
}

export interface Chapter {
  id: string;
  label: string;
  excerpts: Excerpt[];
  explanation: string;
}

export interface Story {
  id: string;
  title: string;
  arxivId: string;
  arxivUrl: string;
  query: string | null;
  createdAt: string;
  chapters: Chapter[];
}
