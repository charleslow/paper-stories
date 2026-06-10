import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateStory, validateSources } from './validate.js';

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
  // First and last chapters must have 0 excerpts; middle chapters exactly 1
  const chapters = Array.from({ length: 5 }, (_, i) => {
    const isFirstOrLast = i === 0 || i === 4;
    return {
      ...chapter,
      id: `ch-${i + 1}`,
      excerpts: isFirstOrLast ? [] : [{ ...excerpt, ...excerptOverrides }],
    };
  });
  return {
    id: 'test-story',
    title: 'Test Story',
    chapters,
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
    assert.throws(() => validateStory(makeStory({}, {}, { type: 'video' })), /invalid excerpt type/);
  });

  it('accepts webpage metadata and visual figure URLs', () => {
    assert.doesNotThrow(() => validateStory(makeStory({
      sourceType: 'webpage',
      sourceUrl: 'https://example.com/post',
      arxivId: null,
      arxivUrl: null,
    }, {}, {
      type: 'figure',
      visualUrl: 'https://example.com/diagram.png',
      sourceUrl: 'https://example.com/post',
    })));
  });

  it('rejects invalid webpage extension fields', () => {
    assert.throws(() => validateStory(makeStory({ sourceType: 42 })), /sourceType/);
    assert.throws(() => validateStory(makeStory({ sourceUrl: 42 })), /sourceUrl/);
    assert.throws(() => validateStory(makeStory({}, {}, { visualUrl: 42 })), /visualUrl/);
    assert.throws(() => validateStory(makeStory({}, {}, { sourceUrl: 42 })), /sourceUrl/);
  });
});

describe('validateSources', () => {
  it('returns an empty set when sources is absent or null', () => {
    assert.equal(validateSources(undefined).size, 0);
    assert.equal(validateSources(null).size, 0);
  });

  it('returns the set of declared ids for a valid array', () => {
    const ids = validateSources([
      { id: 's1', type: 'arxiv', title: 'A' },
      { id: 's2', type: 'webpage', title: 'B' },
    ]);
    assert.deepEqual([...ids].sort(), ['s1', 's2']);
  });

  it('rejects bad shapes', () => {
    assert.throws(() => validateSources('nope'), /must be an array/);
    assert.throws(() => validateSources([{ type: 'arxiv', title: 'A' }]), /non-empty string id/);
    assert.throws(() => validateSources([{ id: 's1', type: 'arxiv' }]), /title/);
    assert.throws(() => validateSources([{ id: 's1', title: 'A' }]), /type/);
    assert.throws(() => validateSources([
      { id: 's1', type: 'arxiv', title: 'A' },
      { id: 's1', type: 'arxiv', title: 'B' },
    ]), /Duplicate source id/);
    assert.throws(() => validateSources([{ id: 's1', type: 'arxiv', title: 'A', pdfFile: 7 }]), /pdfFile/);
  });
});

describe('validateStory — multi-source', () => {
  const twoSources = [
    { id: 's1', type: 'arxiv', title: 'Source One' },
    { id: 's2', type: 'webpage', title: 'Source Two' },
  ];

  it('accepts a collection story whose excerpts reference known sources', () => {
    assert.doesNotThrow(() => validateStory(makeStory(
      { sourceType: 'collection', sources: twoSources, arxivId: null, arxivUrl: null },
      {},
      { sourceId: 's1' },
    )));
  });

  it('rejects an excerpt referencing an unknown sourceId', () => {
    assert.throws(() => validateStory(makeStory(
      { sourceType: 'collection', sources: twoSources },
      {},
      { sourceId: 's9' },
    )), /unknown sourceId/);
  });

  it('requires every excerpt to carry a sourceId when multi-source', () => {
    assert.throws(() => validateStory(makeStory(
      { sourceType: 'collection', sources: twoSources },
    )), /missing sourceId/);
  });

  it('does not require sourceId for a single declared source', () => {
    assert.doesNotThrow(() => validateStory(makeStory(
      { sources: [{ id: 's1', type: 'arxiv', title: 'Solo' }] },
    )));
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
