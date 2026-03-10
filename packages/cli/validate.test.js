import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateStory } from './validate.js';

/** Helper: builds a minimal valid story with N chapters */
function makeStory(overrides = {}, chapterOverrides = {}, excerptOverrides = {}) {
  const excerpt = {
    content: 'Some text content',
    latexSource: '\\text{Some text content}',
    type: 'text',
    sourceFile: 'main.tex',
    label: 'Section 1',
    ...excerptOverrides,
  };

  const chapter = {
    id: 'ch-1',
    label: 'Chapter 1',
    explanation: 'This chapter explains something.',
    excerpts: [excerpt],
    ...chapterOverrides,
  };

  return {
    id: 'test-story',
    title: 'Test Story',
    arxivId: '2401.12345',
    arxivUrl: 'https://arxiv.org/abs/2401.12345',
    query: null,
    createdAt: '2024-01-01T00:00:00Z',
    chapters: Array.from({ length: 5 }, (_, i) => ({
      ...chapter,
      id: `ch-${i + 1}`,
      label: `Chapter ${i + 1}`,
    })),
    ...overrides,
  };
}

describe('validateStory', () => {
  it('accepts a valid story without pdfRegion', () => {
    assert.doesNotThrow(() => validateStory(makeStory()));
  });

  it('rejects story with missing id', () => {
    assert.throws(() => validateStory(makeStory({ id: '' })), /Missing or invalid story\.id/);
  });

  it('rejects story with missing title', () => {
    assert.throws(() => validateStory(makeStory({ title: null })), /Missing or invalid story\.title/);
  });

  it('rejects story with fewer than 5 chapters', () => {
    const story = makeStory();
    story.chapters = story.chapters.slice(0, 3);
    assert.throws(() => validateStory(story), /Expected at least 5 chapters, got 3/);
  });

  it('rejects chapter with missing required fields', () => {
    const story = makeStory();
    story.chapters[0].explanation = '';
    assert.throws(() => validateStory(story), /missing required fields/);
  });

  it('rejects excerpt with invalid type', () => {
    const story = makeStory({}, {}, { type: 'figure' });
    assert.throws(() => validateStory(story), /invalid excerpt type/);
  });
});

describe('validateStory — pdfRegion', () => {
  it('accepts excerpt with valid pdfRegion', () => {
    const story = makeStory({}, {}, {
      pdfRegion: { page: 0, bbox: [0.1, 0.2, 0.9, 0.35] },
    });
    assert.doesNotThrow(() => validateStory(story));
  });

  it('accepts excerpt with pdfRegion at boundary values', () => {
    const story = makeStory({}, {}, {
      pdfRegion: { page: 0, bbox: [0, 0, 1, 1] },
    });
    assert.doesNotThrow(() => validateStory(story));
  });

  it('accepts excerpt without pdfRegion (optional)', () => {
    const story = makeStory({}, {}, {});
    delete story.chapters[0].excerpts[0].pdfRegion;
    assert.doesNotThrow(() => validateStory(story));
  });

  it('rejects pdfRegion with negative page', () => {
    const story = makeStory({}, {}, {
      pdfRegion: { page: -1, bbox: [0.1, 0.2, 0.9, 0.35] },
    });
    assert.throws(() => validateStory(story), /invalid pdfRegion\.page/);
  });

  it('rejects pdfRegion with non-numeric page', () => {
    const story = makeStory({}, {}, {
      pdfRegion: { page: '0', bbox: [0.1, 0.2, 0.9, 0.35] },
    });
    assert.throws(() => validateStory(story), /invalid pdfRegion\.page/);
  });

  it('rejects pdfRegion with bbox value > 1', () => {
    const story = makeStory({}, {}, {
      pdfRegion: { page: 0, bbox: [0.1, 0.2, 1.5, 0.35] },
    });
    assert.throws(() => validateStory(story), /invalid pdfRegion\.bbox/);
  });

  it('rejects pdfRegion with bbox value < 0', () => {
    const story = makeStory({}, {}, {
      pdfRegion: { page: 0, bbox: [-0.1, 0.2, 0.9, 0.35] },
    });
    assert.throws(() => validateStory(story), /invalid pdfRegion\.bbox/);
  });

  it('rejects pdfRegion with wrong number of bbox values', () => {
    const story = makeStory({}, {}, {
      pdfRegion: { page: 0, bbox: [0.1, 0.2, 0.9] },
    });
    assert.throws(() => validateStory(story), /invalid pdfRegion\.bbox/);
  });

  it('rejects pdfRegion with non-array bbox', () => {
    const story = makeStory({}, {}, {
      pdfRegion: { page: 0, bbox: 'invalid' },
    });
    assert.throws(() => validateStory(story), /invalid pdfRegion\.bbox/);
  });

  it('rejects pdfRegion with non-numeric bbox values', () => {
    const story = makeStory({}, {}, {
      pdfRegion: { page: 0, bbox: [0.1, '0.2', 0.9, 0.35] },
    });
    assert.throws(() => validateStory(story), /invalid pdfRegion\.bbox/);
  });
});
