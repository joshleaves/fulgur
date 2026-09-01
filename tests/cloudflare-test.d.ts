/**
 * Ambient declaration for the `cloudflare:test` module provided by
 * @cloudflare/vitest-pool-workers (its own published types do not reach the
 * test files under this project's tsconfig, so declare the parts we use).
 */
declare module 'cloudflare:test' {
  export const env: Env
  export const SELF: {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  }
}

// Vite `?raw` imports (schema.sql bundled as a string for the D1 setup).
declare module '*?raw' {
  const content: string
  export default content
}
