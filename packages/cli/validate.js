/**
 * Validates a single proof excerpt's shape. Throws if invalid.
 *
 * Shared so server-side proof generation can enforce the same shape the
 * viewer's ProofExcerptDisplay relies on (statement string + non-empty
 * steps array, each step with string content) before persisting a chapter.
 */
export function validateProofExcerpt(ex, chapterId) {
  if (!ex.statement || typeof ex.statement !== 'string') {
    throw new Error(`Chapter ${chapterId} has proof excerpt missing statement`);
  }
  if (!Array.isArray(ex.steps) || ex.steps.length === 0) {
    throw new Error(`Chapter ${chapterId} has proof excerpt with no steps`);
  }
  for (const step of ex.steps) {
    if (!step.content || typeof step.content !== 'string') {
      throw new Error(`Chapter ${chapterId} has proof step missing content`);
    }
  }
}

/**
 * Validates a story's optional `sources` array (multi-source / collection
 * stories). Returns the set of declared source ids (empty for single-source
 * stories with no `sources` array). Throws if the shape is invalid.
 */
export function validateSources(sources) {
  const ids = new Set();
  if (sources === undefined || sources === null) return ids;
  if (!Array.isArray(sources)) {
    throw new Error('story.sources must be an array when present');
  }
  for (const src of sources) {
    if (typeof src !== 'object' || src === null) {
      throw new Error('Each entry in story.sources must be an object');
    }
    if (!src.id || typeof src.id !== 'string') {
      throw new Error('Each source must have a non-empty string id');
    }
    if (ids.has(src.id)) {
      throw new Error(`Duplicate source id in story.sources: "${src.id}"`);
    }
    if (!src.title || typeof src.title !== 'string') {
      throw new Error(`Source "${src.id}" must have a non-empty string title`);
    }
    if (!src.type || typeof src.type !== 'string') {
      throw new Error(`Source "${src.id}" must have a string type`);
    }
    if (src.pdfFile !== undefined && src.pdfFile !== null && typeof src.pdfFile !== 'string') {
      throw new Error(`Source "${src.id}" has invalid pdfFile`);
    }
    ids.add(src.id);
  }
  return ids;
}

/**
 * Validates a story JSON object. Throws if invalid.
 *
 * arxivId and arxivUrl are optional (may be null for local sources).
 */
export function validateStory(story) {
  if (!story.id || typeof story.id !== 'string') throw new Error('Missing or invalid story.id');
  if (!story.title || typeof story.title !== 'string') throw new Error('Missing or invalid story.title');
  if (story.sourceType !== undefined && story.sourceType !== null && typeof story.sourceType !== 'string') {
    throw new Error('Invalid story.sourceType');
  }
  if (story.sourceUrl !== undefined && story.sourceUrl !== null && typeof story.sourceUrl !== 'string') {
    throw new Error('Invalid story.sourceUrl');
  }
  if (!Array.isArray(story.chapters) || story.chapters.length < 5) {
    throw new Error(`Expected at least 5 chapters, got ${story.chapters?.length || 0}`);
  }

  // Multi-source ("collection") stories carry a top-level `sources` array.
  // Each excerpt then references one of these via `sourceId`.
  const sourceIds = validateSources(story.sources);
  // Derive multi-source mode from the declared sourceType, not just from how
  // many sources the LLM happened to emit.  A collection story with a missing
  // or truncated sources array would otherwise slip through with isMultiSource
  // false, so sourceId validation on excerpts would never fire.
  const isCollection = story.sourceType === 'collection';
  if (isCollection && sourceIds.size < 2) {
    throw new Error(
      `Collection story must declare at least 2 entries in story.sources, got ${sourceIds.size}`,
    );
  }
  const isMultiSource = sourceIds.size > 1 || isCollection;

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
      if (!['text', 'equation', 'figure', 'proof'].includes(ex.type)) {
        throw new Error(`Chapter ${ch.id} has invalid excerpt type: ${ex.type}`);
      }
      if (ex.type === 'proof') {
        validateProofExcerpt(ex, ch.id);
        continue;
      }
      if (!ex.content || !ex.latexSource) {
        throw new Error(`Chapter ${ch.id} has excerpt missing content/latexSource`);
      }
      if (ex.visualUrl !== undefined && typeof ex.visualUrl !== 'string') {
        throw new Error(`Chapter ${ch.id} has excerpt with invalid visualUrl`);
      }
      if (ex.sourceUrl !== undefined && typeof ex.sourceUrl !== 'string') {
        throw new Error(`Chapter ${ch.id} has excerpt with invalid sourceUrl`);
      }
      if (ex.sourceId !== undefined) {
        if (typeof ex.sourceId !== 'string') {
          throw new Error(`Chapter ${ch.id} has excerpt with invalid sourceId`);
        }
        if (sourceIds.size > 0 && !sourceIds.has(ex.sourceId)) {
          throw new Error(`Chapter ${ch.id} has excerpt with unknown sourceId "${ex.sourceId}" (not in story.sources)`);
        }
      } else if (isMultiSource) {
        throw new Error(`Chapter ${ch.id} has excerpt missing sourceId (required for multi-source stories)`);
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
