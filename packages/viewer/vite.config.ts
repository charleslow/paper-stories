/// <reference types="vitest/config" />
import { defineConfig, type Connect, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import babel from '@babel/core'
import path from 'path'
import fs from 'fs/promises'
import { readFileSync } from 'fs'
import { spawn, spawnSync } from 'child_process'
import type { ServerResponse } from 'http'
import { isSafeId, readBody, buildChatPrompt, buildProofPrompt, withFileLock } from './chat-utils'
import { validateProofExcerpt } from '../cli/validate.js'
// eslint-disable-next-line @typescript-eslint/no-require-imports
import yaml from 'js-yaml'

function loadChatModel(): string | null {
  const configPaths = [
    path.resolve(__dirname, '../cli/config.yaml'),
    path.resolve(__dirname, '../../config.yaml'),
  ]
  for (const configPath of configPaths) {
    try {
      const raw = readFileSync(configPath, 'utf-8')
      const parsed = yaml.load(raw) as { models?: Record<string, string> }
      const chat = parsed?.models?.chat
      if (typeof chat === 'string' && chat) return chat
    } catch {
      // Try the next config path.
    }
  }
  return null
}

/** Maps a model string to the provider binary that runs it. */
function chatProvider(model: string | null | undefined): 'claude' | 'codex' | null {
  if (model?.startsWith('claude-')) return 'claude'
  if (model) return 'codex'
  return null
}

function isBinaryAvailable(binary: string): boolean {
  return spawnSync('which', [binary], { stdio: 'ignore' }).status === 0
}

const chatModel = loadChatModel()
const globalProvider = chatProvider(chatModel)
const chatBinaryAvailable = globalProvider !== null && isBinaryAvailable(globalProvider)

// Shared middleware for serving local stories (works in both dev and preview)
function localStoriesMiddleware(req: Connect.IncomingMessage, res: ServerResponse, next: Connect.NextFunction) {
  const storiesDir = path.resolve(__dirname, 'stories')

  handleRequest(req, res, next, storiesDir).catch(next)
}

function jsonResponse(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function runCodex(prompt: string, storiesDir: string, model?: string | null): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    const done = (err: Error | null, result?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (err) reject(err)
      else resolve(result!)
    }

    const args = ['exec']
    if (model) args.push('--model', model)
    // --full-auto was removed in codex 0.149; --sandbox workspace-write is the
    // documented replacement and keeps the same semantics (workspace edits
    // allowed, approvals auto). Chat reads story files via the Read tool,
    // which needs at least workspace-write to function.
    args.push('--sandbox', 'workspace-write', '--skip-git-repo-check', '-')

    const proc = spawn('codex', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: storiesDir,
    })
    console.log('[chat] codex process pid:', proc.pid)

    const maxBuffer = 1024 * 1024
    let stdout = ''
    let stderr = ''

    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      done(new Error('Codex timed out after 120 seconds'))
    }, 120000)

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
      if (stdout.length > maxBuffer) {
        proc.kill('SIGTERM')
        done(new Error('Codex output exceeded max buffer size'))
      }
    })

    proc.stderr.on('data', (data: Buffer) => {
      if (stderr.length < maxBuffer) stderr += data.toString()
    })

    proc.on('close', (code) => {
      if (code === 0) {
        console.log('[chat] codex responded, length:', stdout.length)
        done(null, stdout.trim())
      } else {
        console.error('[chat] codex spawn error:', { code, stderr })
        done(new Error(stderr || `Codex exited with code ${code}`))
      }
    })

    proc.on('error', (err) => {
      console.error('[chat] codex spawn error:', err.message)
      done(new Error(err.message))
    })

    proc.stdin.on('error', () => { /* process died before prompt was fully written; close handler will settle */ })
    proc.stdin.write(prompt)
    proc.stdin.end()
  })
}

function runClaude(prompt: string, storiesDir: string, model?: string | null): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    const done = (err: Error | null, result?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (err) reject(err)
      else resolve(result!)
    }

    const args = ['-p', '--allowedTools', 'Read', '--add-dir', storiesDir]
    if (model) args.push('--model', model)

    const proc = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    console.log('[chat] claude process pid:', proc.pid)

    const maxBuffer = 1024 * 1024
    let stdout = ''
    let stderr = ''

    // Timeout after 120 seconds
    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      done(new Error('Claude timed out after 120 seconds'))
    }, 120000)

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
      if (stdout.length > maxBuffer) {
        proc.kill('SIGTERM')
        done(new Error('Claude output exceeded max buffer size'))
      }
    })

    proc.stderr.on('data', (data: Buffer) => {
      if (stderr.length < maxBuffer) stderr += data.toString()
    })

    proc.on('close', (code) => {
      if (code === 0) {
        console.log('[chat] claude responded, length:', stdout.length)
        done(null, stdout.trim())
      } else {
        console.error('[chat] claude spawn error:', { code, stderr })
        done(new Error(stderr || `Claude exited with code ${code}`))
      }
    })

    proc.on('error', (err) => {
      console.error('[chat] claude spawn error:', err.message)
      done(new Error(err.message))
    })

    // Send prompt via stdin (avoids argument length limits and thinking-state hangs)
    proc.stdin.on('error', () => { /* process died before prompt was fully written; close handler will settle */ })
    proc.stdin.write(prompt)
    proc.stdin.end()
  })
}

function runChat(prompt: string, storiesDir: string, storyModel?: string | null): Promise<string> {
  const model = storyModel ?? chatModel
  if (chatProvider(model) === 'claude') {
    return runClaude(prompt, storiesDir, model)
  }
  return runCodex(prompt, storiesDir, model)
}

// Limit concurrent chat processes
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

type StoryChapterExcerpt =
  | { type: 'text' | 'equation' | 'figure'; latexSource: string }
  | { type: 'proof'; statement: string }

interface StoryFileData {
  title: string
  arxivId: string
  chatModel?: string | null
  chapters: { id: string; label: string; excerpts: StoryChapterExcerpt[]; explanation: string }[]
}

async function readStoryFile(storiesDir: string, storyId: string) {
  const filename = await resolveStoryFilename(storiesDir, storyId)
  const storyPath = path.join(storiesDir, `${filename}.json`)
  const data = JSON.parse(await fs.readFile(storyPath, 'utf-8'))
  return { filename, data: data as StoryFileData }
}

async function handleRequest(req: Connect.IncomingMessage, res: ServerResponse, next: Connect.NextFunction, storiesDir: string) {
  // Chat availability check
  if (req.url === '/_chat/available') {
    return jsonResponse(res, { available: chatBinaryAvailable, model: chatModel ?? null, provider: globalProvider })
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

      const chatDataForPrompt = await readChatFile(chatPath, storyId)
      const history = chatDataForPrompt.chapters[chapterId] || []

      const storyFile = path.join(storiesDir, `${filename}.json`)
      const pdfCandidate = path.join(storiesDir, `${filename}.pdf`)
      let pdfFile: string | null = null
      try { await fs.access(pdfCandidate); pdfFile = pdfCandidate } catch {}

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
        storyFile,
        pdfFile,
      })

      const aiReply = await runChat(prompt, storiesDir, story.chatModel)

      // Use file lock to prevent concurrent writes to the same chat file.
      await withFileLock(chatPath, async () => {
        const chatData = await readChatFile(chatPath, storyId)
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
      })

      return jsonResponse(res, { reply: aiReply })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Chat failed'
      return jsonResponse(res, { error: message }, 500)
    } finally {
      activeChatRequests--
    }
  }

  // Proof generation: POST /_proof/:storyId/:chapterId
  const proofPostMatch = req.url?.match(/^\/_proof\/([^/]+)\/([^/]+)$/)
  if (proofPostMatch && req.method === 'POST') {
    const storyId = decodeURIComponent(proofPostMatch[1])
    const chapterId = decodeURIComponent(proofPostMatch[2])
    if (!isSafeId(storyId) || !isSafeId(chapterId)) {
      return jsonResponse(res, { error: 'Invalid story or chapter ID' }, 400)
    }

    if (activeChatRequests >= MAX_CONCURRENT_CHATS) {
      return jsonResponse(res, { error: 'Too many concurrent requests. Please wait.' }, 429)
    }

    activeChatRequests++
    try {
      const body = JSON.parse(await readBody(req))
      if (!body.statement || typeof body.statement !== 'string' || body.statement.length > 2000) {
        return jsonResponse(res, { error: 'Invalid or missing statement' }, 400)
      }

      const { filename, data: story } = await readStoryFile(storiesDir, storyId)
      const storyPath = path.join(storiesDir, `${filename}.json`)
      const chapterIdx = story.chapters.findIndex(c => c.id === chapterId)
      if (chapterIdx === -1) {
        return jsonResponse(res, { error: 'Chapter not found' }, 404)
      }

      const currentChapter = story.chapters[chapterIdx]
      const pdfCandidate = path.join(storiesDir, `${filename}.pdf`)
      let pdfFile: string | null = null
      try { await fs.access(pdfCandidate); pdfFile = pdfCandidate } catch {}

      const prompt = buildProofPrompt({
        statement: body.statement,
        title: story.title,
        currentChapter: { label: currentChapter.label, explanation: currentChapter.explanation },
        storyFile: storyPath,
        pdfFile,
      })

      const aiResponse = await runChat(prompt, storiesDir, story.chatModel)

      const jsonMatch = aiResponse.match(/```json\s*([\s\S]*?)\s*```/)
      if (!jsonMatch) {
        console.error('[proof] AI response did not contain a JSON block:', aiResponse.slice(0, 200))
        return jsonResponse(res, { error: 'Failed to generate proof: unexpected AI response format' }, 500)
      }

      let proofChapter: Record<string, unknown>
      try {
        proofChapter = JSON.parse(jsonMatch[1])
      } catch {
        return jsonResponse(res, { error: 'Failed to parse generated proof JSON' }, 500)
      }

      if (!proofChapter.id || !proofChapter.label || !proofChapter.explanation || !Array.isArray(proofChapter.excerpts)) {
        return jsonResponse(res, { error: 'Generated proof chapter has invalid structure' }, 500)
      }

      // Validate each excerpt against the same proof shape validateStory enforces,
      // so a malformed AI response never persists a chapter the viewer crashes on.
      try {
        for (const ex of proofChapter.excerpts as { type?: unknown }[]) {
          if (ex.type !== 'proof') {
            throw new Error('proof chapter excerpt is not type "proof"')
          }
          validateProofExcerpt(ex, String(proofChapter.id))
        }
      } catch (e) {
        const detail = e instanceof Error ? e.message : 'malformed proof'
        return jsonResponse(res, { error: `Generated proof is malformed: ${detail}` }, 500)
      }

      let chaptId = String(proofChapter.id)
      await withFileLock(storyPath, async () => {
        const freshStory = JSON.parse(await fs.readFile(storyPath, 'utf-8'))
        // Recheck for id collisions against the freshly-read chapters: a concurrent
        // request may have appended this same generated id since the pre-lock read.
        if (freshStory.chapters.some((c: { id: string }) => c.id === chaptId)) {
          chaptId = `${chaptId}-${Date.now()}`
          proofChapter.id = chaptId
        }
        freshStory.chapters.push(proofChapter)
        const tmpPath = storyPath + '.tmp'
        await fs.writeFile(tmpPath, JSON.stringify(freshStory, null, 2))
        await fs.rename(tmpPath, storyPath)
      })

      console.log('[proof] appended chapter', chaptId, 'to', filename)
      return jsonResponse(res, { type: 'proof_added', chapterId: chaptId })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Proof generation failed'
      console.error('[proof] error:', message)
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
    host: '0.0.0.0',
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 5174,
    allowedHosts: true,
  },
  // Lower ES2020+ syntax (optional chaining, nullish coalescing, private fields,
  // using declarations) to Chrome 69-compatible code. Covers both the main
  // bundle and pre-bundled dependencies (pdfjs-dist v5 uses all of the above).
  esbuild: {
    target: 'chrome69',
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'chrome69',
    },
  },
  build: {
    target: 'chrome69',
  },
  // Build workers as classic IIFE scripts so the browser creates them with
  // new Worker(url) — no {type:"module"} option — which Chrome 69 supports.
  worker: {
    format: 'iife',
  },
  plugins: [
    // Expand the single `import 'core-js'` in pdf-polyfills.ts into exactly the
    // granular polyfills Chrome 69 lacks (incl. TC39 proposals pdfjs v5 uses,
    // e.g. Uint8Array.toHex / Map.prototype.getOrInsertComputed). esbuild lowers
    // syntax but never polyfills built-in methods; @babel/preset-env entry mode
    // does. Scoped to that one file so we don't run Babel over the whole tree.
    {
      name: 'corejs-entry-polyfills',
      enforce: 'pre',
      async transform(code: string, id: string) {
        if (!id.endsWith('/src/pdf-polyfills.ts')) return null
        const result = await babel.transformAsync(code, {
          filename: id,
          babelrc: false,
          configFile: false,
          sourceMaps: true,
          presets: [
            ['@babel/preset-env', {
              targets: { chrome: '69' },
              useBuiltIns: 'entry',
              corejs: { version: '3.49', proposals: true },
              modules: false,
              bugfixes: true,
            }],
          ],
        })
        if (!result?.code) return null
        return { code: result.code, map: result.map }
      },
    } satisfies Plugin,
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
