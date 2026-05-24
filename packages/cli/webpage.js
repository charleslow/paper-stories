/**
 * Webpage source adapter.
 *
 * Fetches a URL, extracts a readable Markdown-ish text file plus metadata, and
 * exposes it through the same SourceResult shape as the arXiv/local adapters.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { assertSourceResult } from './source-utils.js';

const USER_AGENT = 'paper-stories/0.2 (+https://github.com/charleslow/paper-stories)';

export async function prepareWebpage(url, workDir) {
  const pageUrl = normalizeWebpageUrl(url);
  const sourceDir = join(workDir, 'webpage');
  mkdirSync(sourceDir, { recursive: true });

  const response = await fetch(pageUrl, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
    },
  });

  if (!response.ok) {
    throw new Error(`Could not fetch webpage: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
    throw new Error(`Expected an HTML webpage, got content-type: ${contentType || '(unknown)'}`);
  }

  const html = await response.text();
  const metadata = extractMetadata(html, response.url || pageUrl);
  const readable = htmlToReadableMarkdown(html, metadata);

  writeFileSync(join(sourceDir, 'page.html'), html);
  writeFileSync(join(sourceDir, 'page.md'), readable);
  writeFileSync(join(sourceDir, 'page-metadata.json'), JSON.stringify(metadata, null, 2));

  console.log(`  ✓ Webpage fetched from ${metadata.url}`);
  console.log(`  ✓ Extracted ${metadata.wordCount} words and ${metadata.images.length} image candidates`);

  return {
    sourceResult: assertSourceResult({
      sourceDir,
      hasSource: true,
      texFiles: [],
      allFiles: ['page.md', 'page-metadata.json', 'page.html'],
    }),
    metadata,
  };
}

function normalizeWebpageUrl(input) {
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`Invalid webpage URL: ${input}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported webpage URL protocol: ${parsed.protocol}`);
  }
  return parsed.toString();
}

function extractMetadata(html, fetchedUrl) {
  const baseUrl = getBaseUrl(html, fetchedUrl);
  const title =
    getMetaContent(html, 'property', 'og:title') ||
    getMetaContent(html, 'name', 'twitter:title') ||
    firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i) ||
    fetchedUrl;
  const description =
    getMetaContent(html, 'name', 'description') ||
    getMetaContent(html, 'property', 'og:description') ||
    getMetaContent(html, 'name', 'twitter:description') ||
    null;
  const canonicalRaw =
    getLinkHref(html, 'canonical') ||
    getMetaContent(html, 'property', 'og:url') ||
    fetchedUrl;
  const canonical = absolutizeUrl(canonicalRaw, baseUrl) || fetchedUrl;
  const author =
    getMetaContent(html, 'name', 'author') ||
    getMetaContent(html, 'property', 'article:author') ||
    null;
  const publishedDate =
    getMetaContent(html, 'property', 'article:published_time') ||
    getMetaContent(html, 'name', 'date') ||
    getMetaContent(html, 'name', 'pubdate') ||
    null;
  const images = extractImages(html, baseUrl);
  const headings = extractHeadings(html);
  const text = stripTags(html);

  return {
    url: canonical,
    fetchedUrl,
    title: decodeEntities(cleanWhitespace(title)),
    description: description ? decodeEntities(cleanWhitespace(description)) : null,
    author: author ? decodeEntities(cleanWhitespace(author)) : null,
    publishedDate,
    headings,
    images,
    wordCount: text.split(/\s+/).filter(Boolean).length,
  };
}

function htmlToReadableMarkdown(html, metadata) {
  const mainHtml = selectMainContent(html);
  const blocks = [];

  if (metadata.title) blocks.push(`# ${metadata.title}`);
  if (metadata.description) blocks.push(metadata.description);
  if (metadata.url) blocks.push(`Source URL: ${metadata.url}`);
  if (metadata.author) blocks.push(`Author: ${metadata.author}`);
  if (metadata.publishedDate) blocks.push(`Published: ${metadata.publishedDate}`);

  for (const block of extractReadableBlocks(mainHtml)) {
    blocks.push(block);
  }

  if (metadata.images.length > 0) {
    blocks.push('## Image and Diagram Candidates');
    for (const image of metadata.images.slice(0, 80)) {
      const alt = image.alt ? ` — ${image.alt}` : '';
      blocks.push(`- ${image.url}${alt}`);
    }
  }

  return `${blocks.filter(Boolean).join('\n\n')}\n`;
}

function selectMainContent(html) {
  const main =
    firstMatch(html, /<main\b[^>]*>([\s\S]*?)<\/main>/i) ||
    firstMatch(html, /<article\b[^>]*>([\s\S]*?)<\/article>/i);
  return main || html;
}

function extractReadableBlocks(html) {
  const withoutNoise = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const blocks = [];
  const blockRegex = /<(h[1-6]|p|li|figcaption|blockquote|pre|table)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;

  while ((match = blockRegex.exec(withoutNoise))) {
    const tag = match[1].toLowerCase();
    const text = decodeEntities(cleanWhitespace(stripTags(match[2])));
    if (text.length < 20 && !tag.startsWith('h')) continue;
    if (tag.startsWith('h')) {
      const level = Number(tag.slice(1));
      blocks.push(`${'#'.repeat(Math.min(level + 1, 6))} ${text}`);
    } else if (tag === 'li') {
      blocks.push(`- ${text}`);
    } else {
      blocks.push(text);
    }
  }

  return dedupeConsecutive(blocks);
}

function extractHeadings(html) {
  const headings = [];
  const headingRegex = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let match;
  while ((match = headingRegex.exec(html))) {
    const text = decodeEntities(cleanWhitespace(stripTags(match[2])));
    if (text) headings.push({ level: Number(match[1]), text });
  }
  return headings.slice(0, 120);
}

function extractImages(html, baseUrl) {
  const images = [];
  for (const property of ['og:image', 'twitter:image']) {
    const rawUrl = getMetaContent(html, 'property', property) || getMetaContent(html, 'name', property);
    const url = rawUrl ? absolutizeUrl(rawUrl, baseUrl) : null;
    if (url && !url.startsWith('data:')) {
      images.push({ url, alt: '', title: property });
    }
  }

  const imageRegex = /<img\b([^>]*)>/gi;
  let match;
  while ((match = imageRegex.exec(html))) {
    const attrs = parseAttributes(match[1]);
    const rawUrl = attrs.src || attrs['data-src'] || attrs['data-original'] || srcFromSrcset(attrs.srcset);
    if (!rawUrl) continue;
    const url = absolutizeUrl(rawUrl, baseUrl);
    if (!url || url.startsWith('data:')) continue;
    images.push({
      url,
      alt: attrs.alt ? decodeEntities(cleanWhitespace(attrs.alt)) : '',
      title: attrs.title ? decodeEntities(cleanWhitespace(attrs.title)) : '',
    });
  }
  return uniqueBy(images, image => image.url).slice(0, 120);
}

function parseAttributes(attrText) {
  const attrs = {};
  const attrRegex = /([:@\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let match;
  while ((match = attrRegex.exec(attrText))) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attrs;
}

function srcFromSrcset(srcset) {
  if (!srcset) return null;
  const first = srcset.split(',').map(part => part.trim()).find(Boolean);
  return first ? first.split(/\s+/)[0] : null;
}

function getBaseUrl(html, fetchedUrl) {
  const href = firstMatch(html, /<base\b[^>]*href=["']([^"']+)["'][^>]*>/i);
  return href ? absolutizeUrl(href, fetchedUrl) : fetchedUrl;
}

function getMetaContent(html, attrName, attrValue) {
  const escaped = escapeRegExp(attrValue);
  const regex = new RegExp(`<meta\\b(?=[^>]*\\b${attrName}=["']${escaped}["'])(?=[^>]*\\bcontent=["']([^"']*)["'])[^>]*>`, 'i');
  return firstMatch(html, regex);
}

function getLinkHref(html, rel) {
  const escaped = escapeRegExp(rel);
  const regex = new RegExp(`<link\\b(?=[^>]*\\brel=["'][^"']*${escaped}[^"']*["'])(?=[^>]*\\bhref=["']([^"']*)["'])[^>]*>`, 'i');
  return firstMatch(html, regex);
}

function firstMatch(text, regex) {
  const match = text.match(regex);
  return match ? match[1] : null;
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ');
}

function cleanWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function absolutizeUrl(rawUrl, baseUrl) {
  try {
    return new URL(rawUrl, baseUrl).toString();
  } catch {
    return null;
  }
}

function dedupeConsecutive(items) {
  const deduped = [];
  for (const item of items) {
    if (deduped[deduped.length - 1] !== item) deduped.push(item);
  }
  return deduped;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
