import type { Context } from 'hono'
import { Database } from '#database'
import { IMMUTABLE_CACHE } from '#src/AppcastCache.ts'

import type { AppBindings } from '#server/app.ts'

/** GET /apps/{app}/releases/{version}/{file} — immutable artifact download. */
export const downloadHandler = async (c: Context<AppBindings>): Promise<Response> => {
  const app = c.req.param('app')!.toLowerCase()
  const version = c.req.param('version')!
  const file = c.req.param('file')!

  const release = await new Database(c.env.DB).getRelease(app, version)
  if (!release || release.filename !== file) {
    return c.json({ error: 'not_found', message: 'release not found' }, 404)
  }
  const rangeHeader = c.req.header('range')
  const ifRange = c.req.header('if-range')
  const rangeAllowed = !ifRange
  const range = rangeAllowed ? rangeHeader?.match(/^bytes=(\d*)-(\d*)$/) : undefined
  const start = range?.[1] ? Number(range[1]) : undefined
  const end = range?.[2] ? Number(range[2]) : undefined
  const validRange = Boolean(
    range &&
      (range[1] !== '' || range[2] !== '') &&
      (start === undefined || (Number.isSafeInteger(start) && start >= 0)) &&
      (end === undefined || (Number.isSafeInteger(end) && end >= 0)) &&
      (start === undefined || end === undefined || end >= start),
  )
  const r2Range = validRange
    ? start !== undefined
      ? { offset: start, length: end === undefined ? undefined : end - start + 1 }
      : { suffix: end! }
    : undefined
  if (rangeHeader && !validRange) {
    return new Response(null, { status: 416, headers: { 'content-range': 'bytes */*' } })
  }
  const obj = await c.env.ARTIFACTS.get(release.r2_key, r2Range ? { range: r2Range } : undefined)
  if (!obj || !obj.body) {
    if (validRange) {
      return new Response(null, {
        status: 416,
        headers: { 'content-range': `bytes */${obj?.size ?? '*'}` },
      })
    }
    return c.json({ error: 'not_found', message: 'artifact missing' }, 404)
  }

  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('content-type', headers.get('content-type') ?? 'application/octet-stream')
  headers.set('cache-control', IMMUTABLE_CACHE)
  headers.set('accept-ranges', 'bytes')
  headers.set('content-length', String(obj.size))
  if (obj.httpEtag) headers.set('etag', obj.httpEtag)

  const ifNoneMatch = c.req.header('if-none-match')
  if (ifNoneMatch && obj.httpEtag && ifNoneMatch.split(',').some((tag) => tag.trim() === obj.httpEtag || tag.trim() === '*')) {
    return new Response(null, { status: 304, headers })
  }

  if (!ifRange && validRange && obj.range && 'offset' in obj.range && 'length' in obj.range && obj.range.offset !== undefined && obj.range.length !== undefined) {
    headers.set('content-range', `bytes ${obj.range.offset}-${obj.range.offset + obj.range.length - 1}/${obj.size}`)
    headers.set('content-length', String(obj.range.length))
    return new Response(obj.body, { status: 206, headers })
  }

  return new Response(obj.body, { status: 200, headers })
}
