/// <reference types="vitest/config" />
import { defineConfig, type Connect } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs/promises'
import { execFile } from 'child_process'
import type { ServerResponse } from 'http'
import { isSafeId, readBody, buildChatPrompt, withFileLock } from './chat-utils'

// Shared middleware for serving local stories (works in both dev and preview)
function localStoriesMiddleware(req: Connect.IncomingMessage, res: ServerResponse, next: Connect.NextFunction) {
  const storiesDir = path.resolve(__dirname, 'stories')

  handleRequest(req, res, next, storiesDir).catch(next)
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

// Limit concurrent Claude processes
let activeChatRequests = 0
const MAX_CONCURRENT_CHATS = 2

async function readChatFile(chatPath: string, storyId: string) {
  try {
    return JSON.parse(await fs.readFile(chatPath, 'utf-8'))
  } catch {
    return { storyId, chapters: {} }
  }
}

/**
 * Resolve a storyId to its actual filename on disk.
 * First tries `${storyId}.json` directly. If not found, scans the stories
 * directory for a file whose internal `id` field matches storyId.
 * Returns the base filename (without .json) used on disk.
 */
async function resolveStoryFilename(storiesDir: string, storyId: string): Promise<string> {
  // Fast path: filename matches storyId
  const directPath = path.join(storiesDir, `${storyId}.json`)
  try {
    await fs.access(directPath)
    return storyId
  } catch {
    // File not found by name — scan for matching internal id
  }

  const allFiles = await fs.readdir(storiesDir)
  const storyFiles = allFiles.filter(f => f.endsWith('.json') && f !== 'manifest.json' && !f.endsWith('.chat.json'))

  for (const f of storyFiles) {
    try {
      const data = JSON.parse(await fs.readFile(path.join(storiesDir, f), 'utf-8'))
      if (data.id === storyId) {
        return f.replace(/\.json$/, '')
      }
    } catch {
      // Skip unreadable files
    }
  }

  throw new Error(`Story not found: ${storyId}`)
}

async function readStoryFile(storiesDir: string, storyId: string) {
  const filename = await resolveStoryFilename(storiesDir, storyId)
  const storyPath = path.join(storiesDir, `${filename}.json`)
  const data = JSON.parse(await fs.readFile(storyPath, 'utf-8'))
  return { filename, data: data as {
    title: string
    arxivId: string
    chapters: { id: string; label: string; excerpts: { latexSource: string; type: string }[]; explanation: string }[]
  }}
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
    if (!isSafeId(storyId)) {
      return jsonResponse(res, { error: 'Invalid story ID' }, 400)
    }
    let filename: string
    try {
      filename = await resolveStoryFilename(storiesDir, storyId)
    } catch {
      return jsonResponse(res, { error: 'Story not found' }, 404)
    }
    const chatPath = path.join(storiesDir, `${filename}.chat.json`)
    const chatData = await readChatFile(chatPath, storyId)
    return jsonResponse(res, chatData)
  }

  // Chat send: POST /_chat/:storyId/:chapterId
  const chatPostMatch = req.url?.match(/^\/_chat\/([^/]+)\/([^/]+)$/)
  if (chatPostMatch && req.method === 'POST') {
    const storyId = decodeURIComponent(chatPostMatch[1])
    const chapterId = decodeURIComponent(chatPostMatch[2])
    if (!isSafeId(storyId) || !isSafeId(chapterId)) {
      return jsonResponse(res, { error: 'Invalid story or chapter ID' }, 400)
    }

    if (activeChatRequests >= MAX_CONCURRENT_CHATS) {
      return jsonResponse(res, { error: 'Too many concurrent chat requests. Please wait.' }, 429)
    }

    activeChatRequests++
    try {
      const body = JSON.parse(await readBody(req))
      if (!body.message || typeof body.message !== 'string' || body.message.length > 10000) {
        return jsonResponse(res, { error: 'Invalid or too-long message' }, 400)
      }

      // Load story data from disk instead of trusting client-sent context
      const { filename, data: story } = await readStoryFile(storiesDir, storyId)
      const chatPath = path.join(storiesDir, `${filename}.chat.json`)
      const chapterIdx = story.chapters.findIndex(c => c.id === chapterId)
      if (chapterIdx === -1) {
        return jsonResponse(res, { error: 'Chapter not found' }, 404)
      }

      const currentChapter = story.chapters[chapterIdx]
      const prevChapter = chapterIdx > 0
        ? { label: story.chapters[chapterIdx - 1].label, explanation: story.chapters[chapterIdx - 1].explanation }
        : null
      const nextChapter = chapterIdx < story.chapters.length - 1
        ? { label: story.chapters[chapterIdx + 1].label, explanation: story.chapters[chapterIdx + 1].explanation }
        : null

      // Include overview (first chapter) if it's not already current, prev, or next
      const firstChapter = story.chapters[0]
      const overviewChapter = chapterIdx > 1
        ? { label: firstChapter.label, explanation: firstChapter.explanation }
        : null

      // Use file lock to prevent concurrent writes to the same chat file
      const reply = await withFileLock(chatPath, async () => {
        const chatData = await readChatFile(chatPath, storyId)
        const history = chatData.chapters[chapterId] || []

        const prompt = buildChatPrompt({
          message: body.message,
          title: story.title,
          arxivId: story.arxivId,
          currentChapter,
          prevChapter,
          nextChapter,
          overviewChapter,
          totalChapters: story.chapters.length,
          history,
        })

        const aiReply = await runClaude(prompt)

        const now = new Date().toISOString()
        if (!chatData.chapters[chapterId]) {
          chatData.chapters[chapterId] = []
        }
        chatData.chapters[chapterId].push(
          { role: 'user', content: body.message, timestamp: now },
          { role: 'assistant', content: aiReply, timestamp: now }
        )

        // Atomic write
        const tmpPath = chatPath + '.tmp'
        await fs.writeFile(tmpPath, JSON.stringify(chatData, null, 2))
        await fs.rename(tmpPath, chatPath)

        return aiReply
      })

      return jsonResponse(res, { reply })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Chat failed'
      return jsonResponse(res, { error: message }, 500)
    } finally {
      activeChatRequests--
    }
  }

  // Discovery endpoint: list all stories
  if (req.url === '/_discover') {
    try {
      const allFiles = await fs.readdir(storiesDir)
      const files = allFiles.filter(f => f.endsWith('.json') && f !== 'manifest.json' && !f.endsWith('.chat.json'))
      const stories = (await Promise.all(files.map(async (f) => {
        try {
          const filePath = path.join(storiesDir, f)
          const [data, stat] = await Promise.all([
            fs.readFile(filePath, 'utf-8').then(JSON.parse),
            fs.stat(filePath),
          ])
          return {
            id: data.id || f.replace('.json', ''),
            title: data.title || f.replace('.json', ''),
            arxivId: data.arxivId || null,
            createdAt: data.createdAt || null,
            modifiedAt: stat.mtime.toISOString(),
            url: `local-stories/${f}`,
          }
        } catch { return null }
      }))).filter(Boolean)
      // Sort by most recently modified first
      stories.sort((a: any, b: any) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())
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
    environmentMatchGlobs: [
      ['chat-utils.test.ts', 'node'],
    ],
  },
})
