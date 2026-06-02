// Worker entry: polyfills must run before any pdfjs worker code.
import './pdf-polyfills';
// @ts-expect-error — pdfjs worker bundle has no separate .d.ts; skipLibCheck handles the rest
export * from 'pdfjs-dist/build/pdf.worker.min.mjs';
