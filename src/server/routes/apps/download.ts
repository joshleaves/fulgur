import type { Context } from 'hono'
import { Database } from '#database'
import { IMMUTABLE_CACHE } from '#src/AppcastCache.ts'
import type { AppBindings } from '#server/app.ts'

const parseRange = (header: string | undefined): { offset: number; length?: number } | { suffix: number } | null => {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/)
  if (!match || (match[1] === '' && match[2] === '')) return header ? null : null

  const start = match[1] ? Number(match[1]) : undefined
  const end = match[2] ? Number(match[2]) : undefined
  if (
    (start !== undefined && (!Number.isSafeInteger(start) || start < 0)) ||
    (end !== undefined && (!Number.isSafeInteger(end) || end < 0)) ||
    (start !== undefined && end !== undefined && end < start)
  ) return null

  return start !== undefined
    ? { offset: start, length: end === undefined ? undefined : end - start + 1 }
    : { suffix: end! }
}

const rangeHeaders = (headers: Headers, obj: R2ObjectBody): Headers => {
  if (obj.range && 'offset' in obj.range && 'length' in obj.range && obj.range.offset !== undefined && obj.range.length !== undefined) {
    headers.set('content-range', `bytes ${obj.range.offset}-${obj.range.offset + obj.range.length - 1}/${obj.size}`)
    headers.set('content-length', String(obj.range.length))
  }
  return headers
}

/** GET /apps/{app}/releases/{version}/{file} — immutable artifact download. */
export const downloadHandler = async (c: Context<AppBindings>): Promise<Response> => {
  const app = c.req.param('app')!.toLowerCase()
  const version = c.req.param('version')!
  const file = c.req.param('file')!
  const release = await new Database(c.env.DB).getRelease(app, version)
  if (!release || release.filename !== file) return c.json({ error: 'not_found', message: 'release not found' }, 404)

  const rangeHeader = c.req.header('range')
  const requestedRange = parseRange(rangeHeader)
  if (rangeHeader && !requestedRange) return new Response(null, { status: 416, headers: { 'content-range': 'bytes */*' } })

  const ifRange = c.req.header('if-range')?.trim()
  const obj = await c.env.ARTIFACTS.get(release.r2_key, requestedRange && !ifRange ? { range: requestedRange } : undefined)
  if (!obj || !obj.body) return c.json({ error: 'not_found', message: 'artifact missing' }, 404)

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

  if (requestedRange && ifRange === obj.httpEtag) {
    const ranged = await c.env.ARTIFACTS.get(release.r2_key, { range: requestedRange })
    if (ranged?.body) return new Response(ranged.body, { status: 206, headers: rangeHeaders(headers, ranged) })
    return new Response(null, { status: 416, headers: { 'content-range': `bytes */${obj.size}` } })
  }
  if (requestedRange && !ifRange) return new Response(obj.body, { status: 206, headers: rangeHeaders(headers, obj) })
  return new Response(obj.body, { status: 200, headers })
}
