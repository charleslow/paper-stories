export interface PdfRegion {
  page: number;           // 0-indexed page number
  bbox: [number, number, number, number]; // Normalized [x0, y0, x1, y1] in range [0, 1]
}

export interface Excerpt {
  content: string;
  latexSource: string;
  type: 'text' | 'equation';
  sourceFile: string;
  label: string;
  pdfRegion?: PdfRegion;  // Optional PDF bounding box for the excerpt
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
