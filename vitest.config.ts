import { defineConfig } from 'vitest/config'
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: [
            'tests/coordinator/timeout.test.ts',
            'tests/AppcastCache.test.ts',
            'tests/Database.test.ts',
            'tests/AppcastGenerator.test.ts',
            'tests/server/helpers/validate.test.ts',
            'tests/server/AuthMiddleware.test.ts',
          ],
          environment: 'node',
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: {
              // Local secrets + vars used by the tests. In production these
              // are Worker secrets (PUBLISH_TOKEN_<APP>) and env vars.
              bindings: {
                PUBLISH_TOKEN_FOO: 'test-token-foo-0000000000000000',
                PUBLISH_TOKEN_BAR: 'test-token-bar-0000000000000000',
                PUBLISH_TIMEOUT: '2000',
              },
            },
          }),
        ],
        test: {
          name: 'integration',
          include: ['tests/integration.test.ts'],
        },
      },
    ],
  },
})
