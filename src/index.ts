/**
 * Fulgur — Cloudflare-native Sparkle update server.
 *
 * The HTTP surface lives in src/server/app.ts, composed from apps and publish
 * sub-apps with one handler file per route. The per-app publish coordinator
 * lives in the PublishCoordinator Durable Object. This module is the Worker
 * entry point: it mounts the server and exports the DO class so Wrangler /
 * `worker-configuration.d.ts` can type the binding.
 */

import server from '#server/app.ts'

export { PublishCoordinator } from '#src/PublishCoordinator.ts'

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return server.fetch(request, env, ctx)
  },
} satisfies ExportedHandler<Env>
