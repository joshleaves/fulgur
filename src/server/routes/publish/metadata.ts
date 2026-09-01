import type { Context } from 'hono'
import { validateMetadata } from '#server/helpers/validate.ts'
import { RELEASE_ID_RE, DO_BASE } from '#src/PublishCoordinator.ts'
import type { AppBindings } from '#server/app.ts'

/**
 * POST /publish/{app}/{release_id} — publish metadata only (step 1).
 * Creates (or idempotently re-acknowledges) a pending publish session in the
 * app's PublishCoordinator Durable Object.
 */
export const publishMetadataHandler = async (c: Context<AppBindings>): Promise<Response> => {
  const app = c.req.param('app')!.toLowerCase()
  const releaseId = c.req.param('release_id')!
  if (!RELEASE_ID_RE.test(releaseId)) {
    return c.json({ error: 'bad_request', errors: ['release_id must be 8-64 chars of [0-9A-Za-z-_]'] }, 400)
  }
  let metadataRaw: unknown
  try {
    metadataRaw = await c.req.json()
  } catch {
    return c.json({ error: 'bad_request', errors: ['body must be valid JSON'] }, 400)
  }
  const validation = validateMetadata(metadataRaw)
  if (!validation.ok || !validation.value) {
    return c.json({ error: 'bad_request', errors: validation.errors }, 400)
  }

  const stub = c.env.PUBLISH_COORDINATOR.getByName(app)
  return await stub.fetch(`${DO_BASE}/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      release_id: releaseId,
      metadata: validation.value,
    }),
  })
}
