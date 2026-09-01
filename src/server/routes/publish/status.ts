import type { Context } from 'hono'
import { DO_BASE, RELEASE_ID_RE } from '#src/PublishCoordinator.ts'
import type { AppBindings } from '#server/app.ts'

/** GET /publish/{app}/{release_id} — session status (observability). */
export const sessionStatusHandler = async (c: Context<AppBindings>): Promise<Response> => {
  const app = c.req.param('app')!.toLowerCase()
  const releaseId = c.req.param('release_id')!
  if (!RELEASE_ID_RE.test(releaseId)) {
    return c.json({ error: 'bad_request', errors: ['release_id must be 8-64 chars of [0-9A-Za-z-_]'] }, 400)
  }
  const stub = c.env.PUBLISH_COORDINATOR.getByName(app)
  return await stub.fetch(`${DO_BASE}/status/${encodeURIComponent(releaseId)}`)
}
