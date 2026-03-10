import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateStory } from './validate.js';

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
    explanation: 'Explains something.',
    excerpts: [excerpt],
    ...chapterOverrides,
  };
  return {
    id: 'test-story',
    title: 'Test Story',
    chapters: Array.from({ length: 5 }, (_, i) => ({ ...chapter, id: `ch-${i + 1}` })),
    ...overrides,
  };
}

describe('validateStory', () => {
  it('accepts a valid story', () => {
    assert.doesNotThrow(() => validateStory(makeStory()));
  });

  it('rejects missing id, title, or too few chapters', () => {
    assert.throws(() => validateStory(makeStory({ id: '' })), /story\.id/);
    assert.throws(() => validateStory(makeStory({ title: null })), /story\.title/);
    const story = makeStory();
    story.chapters = story.chapters.slice(0, 3);
    assert.throws(() => validateStory(story), /at least 5 chapters/);
  });

  it('rejects invalid excerpt type', () => {
    assert.throws(() => validateStory(makeStory({}, {}, { type: 'figure' })), /invalid excerpt type/);
  });
});

describe('validateStory — pdfRegion', () => {
  it('accepts valid pdfRegion and treats it as optional', () => {
    assert.doesNotThrow(() => validateStory(makeStory({}, {}, {
      pdfRegion: { page: 0, bbox: [0, 0, 1, 1] },
    })));
    assert.doesNotThrow(() => validateStory(makeStory()));
  });

  it('rejects invalid page', () => {
    assert.throws(() => validateStory(makeStory({}, {}, {
      pdfRegion: { page: -1, bbox: [0.1, 0.2, 0.9, 0.35] },
    })), /pdfRegion\.page/);
    assert.throws(() => validateStory(makeStory({}, {}, {
      pdfRegion: { page: '0', bbox: [0.1, 0.2, 0.9, 0.35] },
    })), /pdfRegion\.page/);
  });

  it('rejects inverted bbox (x0 >= x1 or y0 >= y1)', () => {
    assert.throws(() => validateStory(makeStory({}, {}, {
      pdfRegion: { page: 0, bbox: [0.9, 0.2, 0.1, 0.35] },
    })), /inverted pdfRegion\.bbox/);
    assert.throws(() => validateStory(makeStory({}, {}, {
      pdfRegion: { page: 0, bbox: [0.1, 0.8, 0.9, 0.35] },
    })), /inverted pdfRegion\.bbox/);
    assert.throws(() => validateStory(makeStory({}, {}, {
      pdfRegion: { page: 0, bbox: [0.5, 0.2, 0.5, 0.35] },
    })), /inverted pdfRegion\.bbox/);
  });

  it('rejects invalid bbox', () => {
    assert.throws(() => validateStory(makeStory({}, {}, {
      pdfRegion: { page: 0, bbox: [0.1, 0.2, 1.5, 0.35] },
    })), /pdfRegion\.bbox/);
    assert.throws(() => validateStory(makeStory({}, {}, {
      pdfRegion: { page: 0, bbox: [0.1, 0.2, 0.9] },
    })), /pdfRegion\.bbox/);
    assert.throws(() => validateStory(makeStory({}, {}, {
      pdfRegion: { page: 0, bbox: 'invalid' },
    })), /pdfRegion\.bbox/);
  });
});
