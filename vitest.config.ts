import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = dirname(fileURLToPath(import.meta.url))

/**
 * Source files import each other with the emitted `.js` extension (NodeNext).
 * Tests point at `src/*.ts`, so rewrite those specifiers back to TypeScript.
 */
const resolveTsFromJs = {
  name: 'resolve-ts-from-js',
  enforce: 'pre' as const,
  async resolveId(source: string, importer: string | undefined) {
    if (!importer || !source.startsWith('.') || !source.endsWith('.js')) return null
    if (importer.includes('node_modules')) return null
    return resolvePath(dirname(importer), source.replace(/\.js$/, '.ts')).replace(/\\/g, '/')
  },
}

export default defineConfig({
  plugins: [resolveTsFromJs],
  resolve: {
    alias: {
      // The real package is injected by the DSH host; tests use the stub.
      '@deepseek-ai/dsh-tools': resolvePath(root, 'tests/support/dsh-tools.ts'),
    },
  },
  test: {
    include: ['tests/**/*.spec.ts'],
  },
})
