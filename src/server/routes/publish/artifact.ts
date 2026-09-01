import type { Context } from 'hono'
import { AppcastCache } from '#src/AppcastCache.ts'
import { ZoneCache } from '#src/ZoneCache.ts'
import { RELEASE_ID_RE, DO_BASE } from '#src/PublishCoordinator.ts'
import type { AppBindings } from '#server/app.ts'

/**
 * PUT /publish/{app}/{release_id}/artifact — raw artifact bytes (step 2).
 * The request body is streamed straight into R2 by the coordinator DO —
 * never buffered (128 MB isolate memory limit). On a successful commit only
 * this app's appcast cache is invalidated.
 */
export const publishArtifactHandler = async (c: Context<AppBindings>): Promise<Response> => {
  const app = c.req.param('app')!.toLowerCase()
  const releaseId = c.req.param('release_id')!
  if (!RELEASE_ID_RE.test(releaseId)) {
    return c.json({ error: 'bad_request', errors: ['release_id must be 8-64 chars of [0-9A-Za-z-_]'] }, 400)
  }
  if (!c.req.raw.body) {
    return c.json({ error: 'bad_request', errors: ['artifact body required'] }, 400)
  }

  const stub = c.env.PUBLISH_COORDINATOR.getByName(app)
  const doResponse = await stub.fetch(`${DO_BASE}/artifact/${encodeURIComponent(releaseId)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream' },
    body: c.req.raw.body,
  })
  if (doResponse.status === 201) {
    const origin = new URL(c.req.url).origin
    const cache = new AppcastCache(`${origin}/apps/${app}/appcast.xml`)
    c.executionCtx.waitUntil(cache.purge())

    const zoneCache = new ZoneCache({
      zoneId: c.env.ZONE_CACHE_ZONE_ID,
      token: c.env.ZONE_CACHE_TOKEN,
      origin: c.env.ZONE_CACHE_ORIGIN,
    })
    c.executionCtx.waitUntil(zoneCache.purgeAppcast(app))
  }
  return doResponse
}
