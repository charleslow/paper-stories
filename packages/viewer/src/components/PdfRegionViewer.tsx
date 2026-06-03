import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import PdfWorker from '../pdf-worker-entry?worker';

// Use a pre-constructed classic Worker so pdfjs never calls
// new Worker(url, {type:"module"}) internally — module workers require Chrome 80+.
// With worker.format:'iife' in vite.config.ts the bundle is a classic script
// that works on Android 9 (Chrome ~69) WebView.
let workerInitError: string | null = null;
try {
  const pdfWorker = new PdfWorker();
  pdfWorker.onerror = (e) => {
    workerInitError = `Worker script error: ${(e as ErrorEvent).message || 'unknown'}`;
    console.error('PDF worker init error:', e);
  };
  pdfjsLib.GlobalWorkerOptions.workerPort = pdfWorker;
} catch (e) {
  workerInitError = `Worker constructor failed: ${e instanceof Error ? e.message : String(e)}`;
  console.error('PDF worker constructor failed:', e);
}

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

  cached = pdfjsLib.getDocument({
    url,
    disableRange: true,
    disableStream: true,
    disableAutoFetch: false,
    useWorkerFetch: false,
  }).promise;
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
  const [errorDetail, setErrorDetail] = useState<string>('');
  const [x0, y0, x1, y1] = bbox;

  // IMPORTANT: pdfjs-dist v5 render() pitfalls
  // 1. Pass `canvas` (the element), NOT `canvasContext`. The `canvasContext`
  //    parameter is deprecated — pdf.js ignores it when `canvas` is provided
  //    and obtains its own 2D context internally.
  // 2. Each render() registers the canvas in an internal #canvasInUse set.
  //    Starting a second render on the same canvas before the first completes
  //    throws "Cannot use the same canvas during multiple render() operations."
  //    Always cancel the previous RenderTask in the effect cleanup to avoid this
  //    (especially important with React StrictMode, which double-fires effects).
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const highlight = highlightRef.current;
    if (!canvas || !container || !highlight) return;

    let cancelled = false;
    setStatus('loading');

    if (workerInitError) {
      setErrorDetail(workerInitError);
      setStatus('error');
      return;
    }

    const task = (async () => {
      const doc = await getPdfDocument(pdfUrl);
      const pdfPage = await doc.getPage(page + 1); // pdf.js uses 1-indexed
      const viewport = pdfPage.getViewport({ scale });

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const renderTask = pdfPage.render({ canvas, viewport });
      try {
        await renderTask.promise;
      } catch (err) {
        // RenderingCancelledException is expected when we cancel
        if ((err as { name?: string }).name === 'RenderingCancelledException') return;
        throw err;
      }

      if (cancelled) return;

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
      return renderTask;
    })();

    task.catch((err) => {
      if (!cancelled) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('PdfRegionViewer: failed to render page', { pdfUrl, page, err });
        setErrorDetail(msg);
        setStatus('error');
      }
    });

    return () => {
      cancelled = true;
      // Cancel any in-flight pdf.js render so the canvas is released
      task.then((renderTask) => renderTask?.cancel()).catch(() => {});
    };
  }, [pdfUrl, page, scale, x0, y0, x1, y1]);

  const zoomIn = () => setScale(s => Math.min(MAX_SCALE, s + SCALE_STEP));
  const zoomOut = () => setScale(s => Math.max(MIN_SCALE, s - SCALE_STEP));
  const resetZoom = () => setScale(DEFAULT_SCALE);

  if (status === 'error') {
    return (
      <div className="pdf-region-viewer pdf-region-error">
        <span>Failed to load PDF page</span>
        {errorDetail && (
          <details style={{ marginTop: 4, fontSize: 12 }}>
            <summary>Details</summary>
            <code style={{ wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>{errorDetail}</code>
          </details>
        )}
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
