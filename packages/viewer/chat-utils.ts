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
  excerpts: { latexSource: string; type: string }[]
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
}

export function buildChatPrompt(input: BuildChatPromptInput): string {
  const {
    message, title, arxivId,
    currentChapter, prevChapter, nextChapter, overviewChapter,
    totalChapters, history,
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
      lines.push(`[${e.type}] ${e.latexSource}`)
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

  lines.push(`Reader's question: ${message}`)
  lines.push(``)
  lines.push(`Respond concisely. Use $...$ for inline math and $$...$$ for display math.`)

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
