import type { Context } from 'hono'
import { AppcastGenerator } from '#src/AppcastGenerator.ts'
import { Database } from '#database'
import { AppcastCache, APPCAST_S_MAXAGE } from '#src/AppcastCache.ts'
import type { AppBindings } from '#server/app.ts'

/** GET /apps/{app}/appcast.xml — Sparkle 2 appcast, cache-first. */
export const appcastHandler = async (c: Context<AppBindings>): Promise<Response> => {
  const app = c.req.param('app')!.toLowerCase()
  const url = new URL(c.req.url)
  const cache = new AppcastCache(c.req.url)

  // Cache-first: a published appcast is served straight from the Cache API.
  const cached = await cache.match()
  if (cached) return cached

  const releases = await new Database(c.env.DB).listReleases(app)
  if (releases.length === 0) {
    return c.json({ error: 'not_found', message: `no published releases for '${app}'` }, 404)
  }

  const xml = new AppcastGenerator(app, url.origin, releases).toXml()
  const response = new Response(xml, {
    status: 200,
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': `s-maxage=${APPCAST_S_MAXAGE}, stale-while-revalidate=60`,
    },
  })
  c.executionCtx.waitUntil(cache.put(response))
  return response
}
