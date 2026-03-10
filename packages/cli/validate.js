/**
 * Validates a story JSON object. Throws if invalid.
 */
export function validateStory(story) {
  if (!story.id || typeof story.id !== 'string') throw new Error('Missing or invalid story.id');
  if (!story.title || typeof story.title !== 'string') throw new Error('Missing or invalid story.title');
  if (!Array.isArray(story.chapters) || story.chapters.length < 5) {
    throw new Error(`Expected at least 5 chapters, got ${story.chapters?.length || 0}`);
  }

  for (const ch of story.chapters) {
    if (!ch.id || !ch.label || !ch.explanation) {
      throw new Error(`Chapter ${ch.id} missing required fields`);
    }
    if (!Array.isArray(ch.excerpts)) {
      throw new Error(`Chapter ${ch.id} excerpts must be an array`);
    }
    for (const ex of ch.excerpts) {
      if (!ex.content || !ex.type || !ex.latexSource) {
        throw new Error(`Chapter ${ch.id} has excerpt missing content/type/latexSource`);
      }
      if (!['text', 'equation'].includes(ex.type)) {
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
      }
    }
  }
}
