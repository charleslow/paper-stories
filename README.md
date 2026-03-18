# Paper Stories 📄

Interactive deep-dives into ML research papers and textbook chapters. Like [Code Stories](https://charleslow.github.io/code-stories/), but for understanding papers and textbooks instead of codebases.

## How it works

1. **CLI** takes an arXiv URL or a local PDF → downloads/reads the source → extracts text regions with bounding boxes → uses Claude to generate a structured walkthrough with PDF locations
2. **Viewer** (React + Vite + KaTeX) renders the story with a two-panel layout:
   - **Left panel**: Verbatim excerpts (text + equations) with collapsible LaTeX source verification and PDF page badges
   - **Right panel**: Expert explanations with inline math

The CLI auto-detects whether the source is a **research paper** or a **textbook chapter** and adapts accordingly:

| | Research Paper | Textbook Chapter |
|---|---|---|
| **Input** | arXiv URL | Local PDF (`--pdf`) |
| **Chapters** | ~20 (8–15 with `--query`) | 30–40 |
| **Excerpts/chapter** | 1 | 1–3 (e.g. definition + example) |
| **Tone** | Knowledgeable colleague | Patient teacher |
| **Structure** | Problem → Method → Experiments → Results | Motivation → Definitions → Theorems → Examples |

## Quick start

### Generate a story from an arXiv paper

```bash
cd packages/cli
npm install
node index.js generate https://arxiv.org/abs/1706.03762 --query "attention mechanism"
```

### Generate a story from a textbook chapter (local PDF)

```bash
node index.js generate --pdf ./linear-algebra-ch3.pdf --query "eigenvalues" --slug "eigenvalues"
```

Options:
- `--pdf <path>` — Use a local PDF instead of an arXiv URL (e.g. a textbook chapter)
- `-q, --query <query>` — Focus the story on a specific aspect
- `-c, --cache-repo <path>` — Publish directly to code-stories-cache repo
- `-s, --slug <slug>` — Custom story slug

### View stories

The viewer is deployed at: **https://charleslow.github.io/paper-stories/**

```
?repo=charleslow/code-stories-cache&story=<slug>
?url=<direct-json-url>
```

### Local development

```bash
cd packages/viewer
npm install
npm run dev
```

## Architecture

```
packages/
├── cli/           # Story generation CLI
│   ├── index.js              # Main entry point (Commander.js)
│   ├── arxiv.js              # arXiv source extraction
│   ├── prompt.js             # 6-stage generation prompt
│   ├── validate.js           # Story JSON validation (incl. pdfRegion)
│   └── extract_regions.py    # PDF text block extraction with bounding boxes
└── viewer/        # Static React viewer
    └── src/
        ├── App.tsx
        ├── api.ts               # Story fetching & validation
        ├── types.ts             # TypeScript types
        └── components/
            ├── Sidebar.tsx          # Chapter navigation
            ├── ChapterDisplay.tsx   # Two-panel layout with splitter
            ├── ExcerptPanel.tsx     # Paper excerpts with LaTeX source toggle + PDF page badges
            ├── ExplanationPanel.tsx  # Markdown + KaTeX rendering
            ├── MathRenderer.tsx     # KaTeX equation rendering
            └── LandingPage.tsx      # Home / story loader
```

## Story JSON schema

```json
{
  "id": "slug",
  "title": "Paper Title",
  "arxivId": "2401.12345",
  "arxivUrl": "https://arxiv.org/abs/2401.12345",
  "query": "optional focus query",
  "createdAt": "2026-03-05T00:00:00.000Z",
  "chapters": [
    {
      "id": "chapter-0",
      "label": "Overview",
      "excerpts": [
        {
          "content": "Clean display text",
          "latexSource": "Raw \\LaTeX{} from source",
          "type": "text|equation",
          "sourceFile": "main.tex",
          "label": "Section 3.2",
          "pdfRegion": { "page": 0, "bbox": [0.1, 0.2, 0.9, 0.35] }  // optional; bbox values from region extraction
        }
      ],
      "explanation": "Markdown with $inline$ and $$display$$ math"
    }
  ]
}
```

## PDF region grounding

During story generation, the CLI automatically extracts text blocks with bounding boxes from the paper's PDF using PyMuPDF. Claude then matches each excerpt to its source location, adding an optional `pdfRegion` field with the 0-indexed page number and normalized `[x0, y0, x1, y1]` coordinates. The viewer displays these as page badges (e.g. "p.3") next to each excerpt. If PDF extraction fails, story generation continues gracefully without regions.

## No-hallucination guarantee

Every excerpt includes:
- `content` — cleaned text/equation for display
- `latexSource` — raw LaTeX from the paper source (click "Show LaTeX Source" to verify)
- `pdfRegion` — (optional) bounding box linking back to the exact PDF location
- A verification stage in the pipeline that greps each excerpt against the source files

## Deployment

GitHub Pages via `.github/workflows/deploy-viewer.yml`. Merging to `main` auto-deploys the viewer.

Stories are stored in [`code-stories-cache`](https://github.com/charleslow/code-stories-cache) and fetched at runtime.
