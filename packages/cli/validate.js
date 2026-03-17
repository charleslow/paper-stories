/**
 * Validates a story JSON object. Throws if invalid.
 *
 * Supports both paper mode (1 excerpt per chapter) and textbook mode (1-3 excerpts per chapter).
 * arxivId and arxivUrl are optional (may be null for local sources).
 */
export function validateStory(story) {
  if (!story.id || typeof story.id !== 'string') throw new Error('Missing or invalid story.id');
  if (!story.title || typeof story.title !== 'string') throw new Error('Missing or invalid story.title');
  if (!Array.isArray(story.chapters) || story.chapters.length < 5) {
    throw new Error(`Expected at least 5 chapters, got ${story.chapters?.length || 0}`);
  }

  const totalChapters = story.chapters.length;
  for (let ci = 0; ci < totalChapters; ci++) {
    const ch = story.chapters[ci];
    if (!ch.id || !ch.label || !ch.explanation) {
      throw new Error(`Chapter ${ch.id} missing required fields`);
    }
    if (!Array.isArray(ch.excerpts)) {
      throw new Error(`Chapter ${ch.id} excerpts must be an array`);
    }
    const isFirstOrLast = ci === 0 || ci === totalChapters - 1;
    if (isFirstOrLast) {
      if (ch.excerpts.length !== 0) {
        throw new Error(`Chapter ${ch.id} (first/last) must have 0 excerpts, got ${ch.excerpts.length}`);
      }
    } else {
      // Allow 1-3 excerpts per chapter (textbook mode uses multiple, paper mode uses 1)
      if (ch.excerpts.length < 1 || ch.excerpts.length > 3) {
        throw new Error(`Chapter ${ch.id} must have 1-3 excerpts, got ${ch.excerpts.length}`);
      }
    }
    for (const ex of ch.excerpts) {
      if (!ex.content || !ex.type || !ex.latexSource) {
        throw new Error(`Chapter ${ch.id} has excerpt missing content/type/latexSource`);
      }
      if (!['text', 'equation', 'figure'].includes(ex.type)) {
        throw new Error(`Chapter ${ch.id} has invalid excerpt type: ${ex.type}`);
      }
      if (ex.pdfRegion) {
        const { page, bbox } = ex.pdfRegion;
        if (typeof page !== 'number' || page < 0) {
          throw new Error(`Chapter ${ch.id} has excerpt with invalid pdfRegion.page`);
        }
        if (!Array.isArray(bbox) || bbox.length !== 4 || bbox.some(v => typeof v !== 'number' || v < 0 || v > 1)) {
          throw new Error(`Chapter ${ch.id} has excerpt with invalid pdfRegion.bbox (must be 4 numbers in [0,1])`);
        }
        const [x0, y0, x1, y1] = bbox;
        if (x0 >= x1 || y0 >= y1) {
          throw new Error(`Chapter ${ch.id} has excerpt with inverted pdfRegion.bbox (need x0 < x1 and y0 < y1)`);
        }
      }
    }
  }
}
