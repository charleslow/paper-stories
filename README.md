# Paper Stories 📄

Interactive deep-dives into ML research papers. Like [Code Stories](https://charleslow.github.io/code-stories/), but for understanding papers instead of codebases.

## How it works

1. **CLI** takes an arXiv URL → downloads LaTeX source + PDF → uses Claude to generate a structured walkthrough
2. **Viewer** (React + Vite + KaTeX) renders the story with a two-panel layout:
   - **Left panel**: Verbatim paper excerpts (text + equations) with collapsible LaTeX source verification
   - **Right panel**: Expert explanations with inline math

## Quick start

### Generate a story

```bash
cd packages/cli
npm install
node index.js generate https://arxiv.org/abs/2401.12345 --query "attention mechanism"
```

Options:
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
│   ├── index.js   # Main entry point (Commander.js)
│   ├── arxiv.js   # arXiv source extraction
│   └── prompt.js  # 6-stage generation prompt
└── viewer/        # Static React viewer
    └── src/
        ├── App.tsx
        ├── api.ts               # Story fetching & validation
        ├── types.ts             # TypeScript types
        └── components/
            ├── Sidebar.tsx      # Chapter navigation
            ├── ChapterDisplay.tsx   # Two-panel layout with splitter
            ├── ExcerptPanel.tsx     # Paper excerpts with LaTeX source toggle
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
          "label": "Section 3.2"
        }
      ],
      "explanation": "Markdown with $inline$ and $$display$$ math"
    }
  ]
}
```

## No-hallucination guarantee

Every excerpt includes:
- `content` — cleaned text/equation for display
- `latexSource` — raw LaTeX from the paper source (click "Show LaTeX Source" to verify)
- A verification stage in the pipeline that greps each excerpt against the source files

## Deployment

GitHub Pages via `.github/workflows/deploy-viewer.yml`. Merging to `main` auto-deploys the viewer.

Stories are stored in [`code-stories-cache`](https://github.com/charleslow/code-stories-cache) and fetched at runtime.
