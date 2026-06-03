import { describe, it, expect } from 'vitest';
import './pdf-polyfills';

// Regression guard for the Onyx Boox (Chrome ~69) PDF viewer.
//
// esbuild (vite.config.ts target:'chrome69') lowers modern syntax but does NOT
// polyfill missing built-in methods, so the newer built-ins pdfjs v5 calls must
// come from the core-js entry import in pdf-polyfills.ts (expanded at build time
// by @babel/preset-env). The correctness of that wiring silently depends on
// importing the full `core-js` entry and on the core-js version supplying these
// modules — exactly the kind of thing that regresses quietly. These assertions
// fail loudly if any newer built-in pdfjs depends on stops being polyfilled.
//
// The test runtime (Node) does not ship Map.prototype.getOrInsertComputed or
// Uint8Array.prototype.toHex natively, so a passing assertion proves the
// polyfill — not the host — supplied the method.

type GetOrInsertComputed = <K, V>(this: Map<K, V>, key: K, cb: (key: K) => V) => V;

describe('pdf-polyfills (core-js entry)', () => {
  it('polyfills Map.prototype.getOrInsertComputed (pdfjs v5 cache path)', () => {
    const method = (Map.prototype as { getOrInsertComputed?: unknown }).getOrInsertComputed;
    expect(typeof method).toBe('function');

    const map = new Map<string, number>();
    const getOrInsertComputed = method as GetOrInsertComputed;
    expect(getOrInsertComputed.call(map, 'k', () => 42)).toBe(42);
    expect(map.get('k')).toBe(42);
    // Cached: the callback must not run again for an existing key.
    expect(getOrInsertComputed.call(map, 'k', () => 99)).toBe(42);
  });

  it('polyfills Uint8Array.prototype.toHex (pdfjs v5 binary encoding)', () => {
    const method = (Uint8Array.prototype as { toHex?: unknown }).toHex;
    expect(typeof method).toBe('function');
    const toHex = method as (this: Uint8Array) => string;
    expect(toHex.call(new Uint8Array([255, 16, 0]))).toBe('ff1000');
  });

  it('polyfills Promise.withResolvers', () => {
    expect(typeof (Promise as { withResolvers?: unknown }).withResolvers).toBe('function');
  });
});
