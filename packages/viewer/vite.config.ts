import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import type { Plugin } from 'vite';

const STORIES_DIR = resolve(__dirname, '..', '..', 'stories');

function serveLocalStories(): Plugin {
  return {
    name: 'serve-local-stories',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/local-stories')) return next();

        // Discovery endpoint
        if (req.url === '/local-stories/_discover') {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');

          if (!existsSync(STORIES_DIR)) {
            res.end(JSON.stringify([]));
            return;
          }

          const stories = readdirSync(STORIES_DIR)
            .filter(f => f.endsWith('.json'))
            .map(f => {
              try {
                const data = JSON.parse(readFileSync(join(STORIES_DIR, f), 'utf8'));
                return {
                  id: data.id || f.replace('.json', ''),
                  title: data.title || f.replace('.json', ''),
                  arxivId: data.arxivId || null,
                  createdAt: data.createdAt || null,
                  url: `/local-stories/${f}`,
                };
              } catch {
                return null;
              }
            })
            .filter(Boolean);

          res.end(JSON.stringify(stories));
          return;
        }

        // Serve individual story files
        const filename = req.url.replace('/local-stories/', '');
        if (!filename.endsWith('.json') || filename.includes('..')) {
          res.statusCode = 400;
          res.end('Bad request');
          return;
        }

        const filePath = join(STORIES_DIR, filename);
        if (!existsSync(filePath)) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(readFileSync(filePath, 'utf8'));
      });
    },
  };
}

export default defineConfig({
  base: '/paper-stories/',
  plugins: [react(), serveLocalStories()],
});
