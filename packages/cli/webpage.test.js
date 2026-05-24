import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareWebpage } from './webpage.js';

describe('prepareWebpage', () => {
  it('fetches HTML and writes a readable source bundle', async () => {
    const server = createServer((_, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(`<!doctype html>
        <html>
          <head>
            <title>Routing Workflow</title>
            <meta name="description" content="How requests route through model tiers.">
            <meta name="author" content="Example Author">
            <link rel="canonical" href="/article">
          </head>
          <body>
            <main>
              <h1>Routing Workflow</h1>
              <p>The router first classifies the task, then chooses a model tier.</p>
              <figure>
                <img src="/diagram.png" alt="Router diagram">
                <figcaption>The routing diagram shows fallback tiers.</figcaption>
              </figure>
            </main>
          </body>
        </html>`);
    });

    const baseUrl = await listen(server);
    const workDir = mkdtempSync(join(tmpdir(), 'paper-stories-webpage-'));

    try {
      const { sourceResult, metadata } = await prepareWebpage(`${baseUrl}/article`, workDir);
      assert.equal(sourceResult.hasSource, true);
      assert.equal(metadata.title, 'Routing Workflow');
      assert.equal(metadata.author, 'Example Author');
      assert.equal(metadata.images[0].url, `${baseUrl}/diagram.png`);

      const page = readFileSync(join(sourceResult.sourceDir, 'page.md'), 'utf8');
      assert.match(page, /The router first classifies the task/);
      assert.match(page, /Image and Diagram Candidates/);
    } finally {
      server.close();
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('rejects non-http URLs', async () => {
    await assert.rejects(() => prepareWebpage('file:///tmp/page.html', tmpdir()), /Unsupported webpage URL protocol/);
  });
});

function listen(server) {
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}
