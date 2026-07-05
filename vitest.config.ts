import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Smoke-test config. `@/lib/supabase/server` is stubbed BEFORE the generic `@`
// alias so pure logic modules that happen to import it (lib/ai/rag.ts) can be
// imported outside a Next.js request context (next/headers is unavailable there).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: [
      { find: '@/lib/supabase/server', replacement: path.resolve(__dirname, 'tests/stubs/supabase-server.ts') },
      { find: '@', replacement: path.resolve(__dirname, '.') },
    ],
  },
})
