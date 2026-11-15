// The part of Vite's `import.meta.glob` that plugins/index.ts uses. The bundler (vp pack) and the
// test runner (vp test) both replace the call at build time.
interface ImportMeta {
  glob<M>(
    patterns: string | ReadonlyArray<string>,
    options: { readonly eager: true },
  ): Record<string, M>;
}
