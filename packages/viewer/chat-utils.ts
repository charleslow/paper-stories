import type { Connect } from 'vite'

// Only allow safe characters in IDs — no path traversal possible
const SAFE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

export function isSafeId(id: string): boolean {
  return SAFE_ID_RE.test(id) && !id.includes('..')
}

export const MAX_BODY_SIZE = 512 * 1024 // 512KB limit for request bodies

export function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_SIZE) {
        req.destroy()
        reject(new Error('Request body too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
    req.on('error', reject)
  })
}

// Truncate history to the last N messages to avoid blowing past context limits
const MAX_HISTORY_MESSAGES = 20

export interface ChatChapter {
  label: string
  excerpts: Array<
    { type: 'text' | 'equation' | 'figure'; latexSource: string } |
    { type: 'proof'; statement: string }
  >
  explanation: string
}

export interface BuildChatPromptInput {
  message: string
  title: string
  arxivId: string
  currentChapter: ChatChapter
  prevChapter: { label: string; explanation: string } | null
  nextChapter: { label: string; explanation: string } | null
  overviewChapter: { label: string; explanation: string } | null
  totalChapters: number
  history: { role: string; content: string }[]
  storyFile: string
  pdfFile: string | null
}

export function buildChatPrompt(input: BuildChatPromptInput): string {
  const {
    message, title, arxivId,
    currentChapter, prevChapter, nextChapter, overviewChapter,
    totalChapters, history, storyFile, pdfFile,
  } = input

  const lines: string[] = []

  lines.push(`You are an expert assistant helping a reader understand a research paper.`)
  lines.push(`Paper: "${title}" (arXiv: ${arxivId})`)
  lines.push(``)

  // Include overview if it's not the current chapter
  if (overviewChapter) {
    lines.push(`== Paper Overview: "${overviewChapter.label}" ==`)
    lines.push(overviewChapter.explanation)
    lines.push(``)
  }

  lines.push(`== Current Chapter: "${currentChapter.label}" ==`)

  if (currentChapter.excerpts.length > 0) {
    lines.push(`Excerpts from the paper:`)
    for (const e of currentChapter.excerpts) {
      if (e.type === 'proof') {
        lines.push(`[proof] ${e.statement}`)
      } else {
        lines.push(`[${e.type}] ${e.latexSource}`)
      }
    }
    lines.push(``)
  }

  lines.push(`Explanation:`)
  lines.push(currentChapter.explanation)
  lines.push(``)

  if (prevChapter) {
    lines.push(`== Previous Chapter: "${prevChapter.label}" ==`)
    lines.push(prevChapter.explanation)
    lines.push(``)
  }

  if (nextChapter) {
    lines.push(`== Next Chapter: "${nextChapter.label}" ==`)
    lines.push(nextChapter.explanation)
    lines.push(``)
  }

  lines.push(`The paper has ${totalChapters} chapters total. If the reader's question relates to content in other chapters, you may reference it.`)
  lines.push(``)

  // Truncate history to last N messages
  const truncatedHistory = history.slice(-MAX_HISTORY_MESSAGES)
  if (truncatedHistory.length > 0) {
    if (truncatedHistory.length < history.length) {
      lines.push(`Prior conversation (last ${truncatedHistory.length} of ${history.length} messages):`)
    } else {
      lines.push(`Prior conversation:`)
    }
    for (const m of truncatedHistory) {
      lines.push(`${m.role}: ${m.content}`)
    }
    lines.push(``)
  }

  lines.push(`You have access to the Read tool. If you need more context to answer the question:`)
  lines.push(`- Full story JSON (all chapters): ${storyFile}`)
  if (pdfFile) {
    lines.push(`- Original paper PDF: ${pdfFile}`)
  }
  lines.push(`Only read these files if the provided context above is insufficient.`)
  lines.push(``)
  lines.push(`Reader's question: ${message}`)
  lines.push(``)
  lines.push(`Respond concisely. Use $...$ for inline math and $$...$$ for display math.`)
  lines.push(`Never use \\( \\) or \\[ \\] math delimiters — the reader only renders $ and $$ delimiters.`)

  return lines.join('\n')
}

export interface BuildProofPromptInput {
  statement: string
  title: string
  currentChapter: { label: string; explanation: string }
  storyFile: string
  pdfFile: string | null
}

export function buildProofPrompt(input: BuildProofPromptInput): string {
  const { statement, title, currentChapter, storyFile, pdfFile } = input
  const lines: string[] = []

  lines.push(`You are generating a proof walkthrough chapter for a Paper Stories interactive reader.`)
  lines.push(``)
  lines.push(`== Story Context ==`)
  lines.push(`Paper: "${title}"`)
  lines.push(`Current chapter: "${currentChapter.label}"`)
  lines.push(`Chapter explanation:`)
  lines.push(currentChapter.explanation)
  lines.push(``)
  lines.push(`Statement to prove: ${statement}`)
  lines.push(``)
  lines.push(`You have access to the Read tool to consult the source material:`)
  lines.push(`- Full story JSON: ${storyFile}`)
  if (pdfFile) {
    lines.push(`- Original paper PDF: ${pdfFile}`)
  }
  lines.push(`Read these files as needed to find and faithfully reconstruct the proof.`)
  lines.push(``)
  lines.push(`== Instructions ==`)
  lines.push(`Generate a proof walkthrough chapter. Return ONLY a JSON object wrapped in a \`\`\`json code block — no surrounding text.`)
  lines.push(``)
  lines.push(`The proof should:`)
  lines.push(`- Walk through the proof step by step with 4-10 logical steps`)
  lines.push(`- Be mathematically rigorous yet pedagogically clear`)
  lines.push(`- Use KaTeX-compatible LaTeX: $...$ for inline math, $$...$$ for display math`)
  lines.push(`- Each step is ONE logical move (definition expansion, inequality application, algebraic manipulation, etc.)`)
  lines.push(`- The \`content\` field of each step: write as a mathematician would — clean, formal, concise`)
  lines.push(`- The \`explanation\` field of each step: write for a student — WHY this step works, what makes it clever or non-obvious`)
  lines.push(`- Not every step needs an explanation, but aim to explain at least half the steps`)
  lines.push(``)
  lines.push(`== Required JSON format ==`)
  lines.push(`\`\`\`json`)
  lines.push(`{`)
  lines.push(`  "id": "proof-<short-slug>",`)
  lines.push(`  "label": "Proof: <2-3 word label>",`)
  lines.push(`  "excerpts": [`)
  lines.push(`    {`)
  lines.push(`      "type": "proof",`)
  lines.push(`      "statement": "<Full theorem/claim being proved, Markdown+KaTeX>",`)
  lines.push(`      "label": "<e.g. Theorem 3.1 or Lemma 2>",`)
  lines.push(`      "steps": [`)
  lines.push(`        {`)
  lines.push(`          "content": "<One logical step, Markdown+KaTeX>",`)
  lines.push(`          "explanation": "<Why this step is valid — optional but preferred>"`)
  lines.push(`        }`)
  lines.push(`      ]`)
  lines.push(`    }`)
  lines.push(`  ],`)
  lines.push(`  "explanation": "<2-4 sentence overview of proof strategy. What is the key idea? What tools does it use? Markdown+KaTeX.>"`)
  lines.push(`}`)
  lines.push(`\`\`\``)

  return lines.join('\n')
}

// Simple per-file lock to prevent concurrent writes to the same chat file
const fileLocks = new Map<string, Promise<void>>()

export async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  // Wait for any existing lock on this file
  while (fileLocks.has(filePath)) {
    await fileLocks.get(filePath)
  }

  let releaseLock: () => void
  const lockPromise = new Promise<void>(resolve => { releaseLock = resolve })
  fileLocks.set(filePath, lockPromise)

  try {
    return await fn()
  } finally {
    fileLocks.delete(filePath)
    releaseLock!()
  }
}
