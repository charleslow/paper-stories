/// <reference types="vitest/config" />
import { defineConfig, type Connect } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs/promises'
import type { ServerResponse } from 'http'

// Shared middleware for serving local stories (works in both dev and preview)
function localStoriesMiddleware(req: Connect.IncomingMessage, res: ServerResponse, next: Connect.NextFunction) {
  const storiesDir = path.resolve(__dirname, 'dist/stories')

  handleRequest(req, res, next, storiesDir).catch(next)
}

async function handleRequest(req: Connect.IncomingMessage, res: ServerResponse, next: Connect.NextFunction, storiesDir: string) {
  // Discovery endpoint: list all stories
  if (req.url === '/_discover') {
    try {
      const allFiles = await fs.readdir(storiesDir)
      const files = allFiles.filter(f => f.endsWith('.json') && f !== 'manifest.json')
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
  base: '/paper-stories/',  // Absolute paths for browser; Tailscale strips prefix before backend sees it
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
