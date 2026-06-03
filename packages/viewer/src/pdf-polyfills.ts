// Runtime polyfills required by pdfjs-dist v5 on Android 9 (Chrome ~69).
// Must be imported before any pdfjs code runs — it is the first import in both
// the main thread (main.tsx) and the worker (pdf-worker-entry.ts).
//
// We do NOT hand-write polyfills here anymore. esbuild (vite.config.ts
// target:'chrome69') lowers modern *syntax*, but it does not polyfill missing
// *built-in methods* — so every new method pdfjs v5 reaches for
// (Promise.withResolvers, Array.at, structuredClone, Uint8Array.toHex,
// Map.prototype.getOrInsertComputed, …) used to need a manual shim, which was
// unbounded whack-a-mole.
//
// Instead, this single core-js entry import is rewritten at build time by
// @babel/preset-env (useBuiltIns:'entry', corejs proposals, targets chrome69 —
// see vite.config.ts) into exactly the granular polyfills Chrome 69 lacks,
// including not-yet-shipped TC39 proposals. Adding a newer pdfjs is now just a
// dependency bump; no shim maintenance.
import 'core-js';
