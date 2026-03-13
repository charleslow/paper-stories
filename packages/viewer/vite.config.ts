/// <reference types="vitest/config" />
import { defineConfig, type Connect } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs/promises'
import { execFile } from 'child_process'
import type { ServerResponse } from 'http'

// Shared middleware for serving local stories (works in both dev and preview)
function localStoriesMiddleware(req: Connect.IncomingMessage, res: ServerResponse, next: Connect.NextFunction) {
  const storiesDir = path.resolve(__dirname, 'stories')

  handleRequest(req, res, next, storiesDir).catch(next)
}

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
    req.on('error', reject)
  })
}

function jsonResponse(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function runClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('claude', ['-p', prompt, '--no-input'], {
      timeout: 120000,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message))
      } else {
        resolve(stdout.trim())
      }
    })
  })
}

function buildChatPrompt(body: {
  message: string
  context: {
    title: string
    arxivId: string
    currentChapter: { label: string; excerpts: { latexSource: string; type: string }[]; explanation: string }
    prevChapter?: { label: string; explanation: string } | null
    nextChapter?: { label: string; explanation: string } | null
    totalChapters: number
  }
  history: { role: string; content: string }[]
}): string {
  const { message, context, history } = body
  const lines: string[] = []

  lines.push(`You are an expert assistant helping a reader understand a research paper.`)
  lines.push(`Paper: "${context.title}" (arXiv: ${context.arxivId})`)
  lines.push(``)
  lines.push(`== Current Chapter: "${context.currentChapter.label}" ==`)

  if (context.currentChapter.excerpts.length > 0) {
    lines.push(`Excerpts from the paper:`)
    for (const e of context.currentChapter.excerpts) {
      lines.push(`[${e.type}] ${e.latexSource}`)
    }
    lines.push(``)
  }

  lines.push(`Explanation:`)
  lines.push(context.currentChapter.explanation)
  lines.push(``)

  if (context.prevChapter) {
    lines.push(`== Previous Chapter: "${context.prevChapter.label}" ==`)
    lines.push(context.prevChapter.explanation)
    lines.push(``)
  }

  if (context.nextChapter) {
    lines.push(`== Next Chapter: "${context.nextChapter.label}" ==`)
    lines.push(context.nextChapter.explanation)
    lines.push(``)
  }

  lines.push(`The paper has ${context.totalChapters} chapters total. If the reader's question relates to content in other chapters, you may reference it.`)
  lines.push(``)

  if (history.length > 0) {
    lines.push(`Prior conversation:`)
    for (const m of history) {
      lines.push(`${m.role}: ${m.content}`)
    }
    lines.push(``)
  }

  lines.push(`Reader's question: ${message}`)
  lines.push(``)
  lines.push(`Respond concisely. Use $...$ for inline math and $$...$$ for display math.`)

  return lines.join('\n')
}

async function readChatFile(chatPath: string, storyId: string) {
  try {
    return JSON.parse(await fs.readFile(chatPath, 'utf-8'))
  } catch {
    return { storyId, chapters: {} }
  }
}

async function handleRequest(req: Connect.IncomingMessage, res: ServerResponse, next: Connect.NextFunction, storiesDir: string) {
  // Chat availability check
  if (req.url === '/_chat/available') {
    return jsonResponse(res, { available: true })
  }

  // Chat history: GET /_chat/:storyId
  const chatGetMatch = req.url?.match(/^\/_chat\/([^/]+)$/)
  if (chatGetMatch && req.method === 'GET') {
    const storyId = decodeURIComponent(chatGetMatch[1])
    const chatPath = path.join(storiesDir, `${storyId}.chat.json`)
    const chatData = await readChatFile(chatPath, storyId)
    return jsonResponse(res, chatData)
  }

  // Chat send: POST /_chat/:storyId/:chapterId
  const chatPostMatch = req.url?.match(/^\/_chat\/([^/]+)\/([^/]+)$/)
  if (chatPostMatch && req.method === 'POST') {
    const storyId = decodeURIComponent(chatPostMatch[1])
    const chapterId = decodeURIComponent(chatPostMatch[2])
    const chatPath = path.join(storiesDir, `${storyId}.chat.json`)

    // Security: ensure chat file stays within stories dir
    if (!chatPath.startsWith(storiesDir)) {
      return jsonResponse(res, { error: 'Invalid story ID' }, 400)
    }

    try {
      const body = JSON.parse(await readBody(req))
      const chatData = await readChatFile(chatPath, storyId)

      const history = chatData.chapters[chapterId] || []
      const prompt = buildChatPrompt({ ...body, history })

      const reply = await runClaude(prompt)

      const now = new Date().toISOString()
      if (!chatData.chapters[chapterId]) {
        chatData.chapters[chapterId] = []
      }
      chatData.chapters[chapterId].push(
        { role: 'user', content: body.message, timestamp: now },
        { role: 'assistant', content: reply, timestamp: now }
      )

      // Atomic write
      const tmpPath = chatPath + '.tmp'
      await fs.writeFile(tmpPath, JSON.stringify(chatData, null, 2))
      await fs.rename(tmpPath, chatPath)

      return jsonResponse(res, { reply })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Chat failed'
      return jsonResponse(res, { error: message }, 500)
    }
  }

  // Discovery endpoint: list all stories
  if (req.url === '/_discover') {
    try {
      const allFiles = await fs.readdir(storiesDir)
      const files = allFiles.filter(f => f.endsWith('.json') && f !== 'manifest.json' && !f.endsWith('.chat.json'))
      const stories = (await Promise.all(files.map(async (f) => {
        try {
          const data = JSON.parse(await fs.readFile(path.join(storiesDir, f), 'utf-8'))
          return {
            id: data.id || f.replace('.json', ''),
            title: data.title || f.replace('.json', ''),
            arxivId: data.arxivId || null,
            createdAt: data.createdAt || null,
            url: `local-stories/${f}`,
          }
        } catch { return null }
      }))).filter(Boolean)
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(stories))
    } catch {
      res.setHeader('Content-Type', 'application/json')
      res.end('[]')
    }
    return
  }

  const filePath = path.join(storiesDir, req.url || '')

  // Security: ensure we're still within stories dir
  if (!filePath.startsWith(storiesDir)) {
    return next()
  }

  try {
    const content = await fs.readFile(filePath)
    const ext = path.extname(filePath).toLowerCase()
    const contentType = ext === '.pdf' ? 'application/pdf' : 'application/json'
    res.setHeader('Content-Type', contentType)
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.end(content)
  } catch {
    next()
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  server: {
    host: '127.0.0.1',
    allowedHosts: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 5174,
    allowedHosts: true,
  },
  plugins: [
    react(),
    {
      name: 'serve-local-stories',
      configureServer(server) {
        server.middlewares.use('/local-stories', localStoriesMiddleware)
      },
      configurePreviewServer(server) {
        server.middlewares.use('/local-stories', localStoriesMiddleware)
      },
    }
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
})
