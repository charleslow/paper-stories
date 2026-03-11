import { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

// Cache loaded PDF documents by URL (LRU, capped at MAX_CACHED_DOCS)
const MAX_CACHED_DOCS = 5;
const docCache = new Map<string, Promise<pdfjsLib.PDFDocumentProxy>>();

function getPdfDocument(url: string): Promise<pdfjsLib.PDFDocumentProxy> {
  let cached = docCache.get(url);
  if (cached) {
    // Move to end so the most-recently-used entry is last (LRU order)
    docCache.delete(url);
    docCache.set(url, cached);
    return cached;
  }

  cached = pdfjsLib.getDocument(url).promise;
  cached.catch(() => {
    // Remove rejected promises so subsequent calls can retry
    docCache.delete(url);
  });
  docCache.set(url, cached);

  // Evict oldest entries when cache exceeds the cap
  while (docCache.size > MAX_CACHED_DOCS) {
    const oldest = docCache.keys().next().value!;
    const evicted = docCache.get(oldest)!;
    docCache.delete(oldest);
    evicted.then(doc => doc.destroy()).catch(() => {});
  }

  return cached;
}

interface PdfRegionViewerProps {
  pdfUrl: string;
  page: number;         // 0-indexed
  bbox: [number, number, number, number]; // Normalized [x0, y0, x1, y1]
}

const DEFAULT_SCALE = 1.5;
const MIN_SCALE = 0.5;
const MAX_SCALE = 4;
const SCALE_STEP = 0.25;

export default function PdfRegionViewer({ pdfUrl, page, bbox }: PdfRegionViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [x0, y0, x1, y1] = bbox;

  const renderPage = useCallback(async (currentScale: number) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const highlight = highlightRef.current;
    if (!canvas || !container || !highlight) return;

    try {
      setStatus('loading');
      const doc = await getPdfDocument(pdfUrl);
      const pdfPage = await doc.getPage(page + 1); // pdf.js uses 1-indexed
      const viewport = pdfPage.getViewport({ scale: currentScale });

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Cannot get 2d context from canvas');

      await pdfPage.render({
        canvasContext: ctx,
        viewport,
      }).promise;

      // Position highlight overlay
      highlight.style.left = `${x0 * viewport.width}px`;
      highlight.style.top = `${y0 * viewport.height}px`;
      highlight.style.width = `${(x1 - x0) * viewport.width}px`;
      highlight.style.height = `${(y1 - y0) * viewport.height}px`;

      // Scroll to center the bbox region
      const bboxCenterY = ((y0 + y1) / 2) * viewport.height;
      const containerHeight = container.clientHeight;
      container.scrollTop = Math.max(0, bboxCenterY - containerHeight / 2);

      const bboxCenterX = ((x0 + x1) / 2) * viewport.width;
      const containerWidth = container.clientWidth;
      if (viewport.width > containerWidth) {
        container.scrollLeft = Math.max(0, bboxCenterX - containerWidth / 2);
      }

      setStatus('ready');
    } catch (err) {
      console.error('PdfRegionViewer: failed to render page', { pdfUrl, page, err });
      setStatus('error');
    }
  }, [pdfUrl, page, x0, y0, x1, y1]);

  useEffect(() => {
    renderPage(scale);
  }, [scale, renderPage]);

  const zoomIn = () => setScale(s => Math.min(MAX_SCALE, s + SCALE_STEP));
  const zoomOut = () => setScale(s => Math.max(MIN_SCALE, s - SCALE_STEP));
  const resetZoom = () => setScale(DEFAULT_SCALE);

  if (status === 'error') {
    return (
      <div className="pdf-region-viewer pdf-region-error">
        <span>Failed to load PDF page</span>
      </div>
    );
  }

  return (
    <div className="pdf-region-viewer">
      <div className="pdf-region-toolbar">
        <span className="pdf-region-label">PDF — page {page + 1}</span>
        <div className="pdf-region-zoom">
          <button onClick={zoomOut} disabled={scale <= MIN_SCALE} title="Zoom out">−</button>
          <button onClick={resetZoom} className="pdf-region-zoom-level" title="Reset zoom">
            {Math.round(scale * 100)}%
          </button>
          <button onClick={zoomIn} disabled={scale >= MAX_SCALE} title="Zoom in">+</button>
        </div>
      </div>
      <div className="pdf-region-scroll" ref={containerRef}>
        {status === 'loading' && (
          <div className="pdf-region-loading">
            <div className="loading-spinner" />
          </div>
        )}
        <div className="pdf-region-canvas-wrapper">
          <canvas ref={canvasRef} />
          <div ref={highlightRef} className="pdf-region-highlight" />
        </div>
      </div>
    </div>
  );
}
