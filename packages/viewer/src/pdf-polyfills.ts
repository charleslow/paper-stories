// Runtime polyfills required by pdfjs-dist v5 on Android 9 (Chrome ~69).
// Must be imported before any pdfjs code runs — in both the main thread and
// the worker (via pdf-worker-entry.ts).

// Promise.withResolvers — Chrome 119+
if (!('withResolvers' in Promise)) {
  (Promise as { withResolvers?: unknown }).withResolvers = function <T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}

// Array.prototype.at — Chrome 92+
if (!(Array.prototype as { at?: unknown }).at) {
  Object.defineProperty(Array.prototype, 'at', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: function (this: any[], index: number) {
      const i = index >= 0 ? index : this.length + index;
      return i >= 0 && i < this.length ? this[i] : undefined;
    },
    configurable: true, writable: true,
  });
}

// structuredClone — Chrome 98+
// pdfjs uses this for internal data copying; JSON round-trip is sufficient.
if (!('structuredClone' in globalThis)) {
  (globalThis as { structuredClone?: unknown }).structuredClone =
    (val: unknown) => JSON.parse(JSON.stringify(val));
}

// Uint8Array.prototype.toHex — Chrome 123+
// pdfjs v5 uses this for colour/binary data encoding.
if (!('toHex' in Uint8Array.prototype)) {
  Object.defineProperty(Uint8Array.prototype, 'toHex', {
    value: function (this: Uint8Array): string {
      return Array.from(this, (b) => b.toString(16).padStart(2, '0')).join('');
    },
    configurable: true, writable: true,
  });
}
