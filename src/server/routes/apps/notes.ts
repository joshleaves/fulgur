import type { Context } from 'hono'
import { Database } from '#database'
import { AppcastCache, IMMUTABLE_CACHE } from '#src/AppcastCache.ts'

import type { AppBindings } from '#server/app.ts'

/**
 * GET /apps/{app}/releases/{version}/notes.html — embedded release notes.
 * Releases are immutable, so the notes page caches forever.
 */
export const notesHandler = async (c: Context<AppBindings>): Promise<Response> => {
  const app = c.req.param('app')!.toLowerCase()
  const version = c.req.param('version')!

  const release = await new Database(c.env.DB).getRelease(app, version)
  if (!release || !release.release_notes) {
    return c.json({ error: 'not_found', message: 'no embedded release notes' }, 404)
  }

  const cache = new AppcastCache(c.req.url)
  const cached = await cache.match()
  if (cached) return cached

  const headers: Record<string, string> = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': IMMUTABLE_CACHE,
  }
  if (release.release_notes_signature) {
    // Sparkle's SURequireSignedFeed verifies the notes file signature.
    headers['x-sparkle-edsignature'] = release.release_notes_signature
    headers['x-sparkle-length'] = String(new TextEncoder().encode(release.release_notes).byteLength)
  }
  const response = new Response(release.release_notes, { status: 200, headers })
  c.executionCtx.waitUntil(cache.put(response))
  return response
}
