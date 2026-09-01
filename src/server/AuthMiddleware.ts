import { createMiddleware } from 'hono/factory'
import type { AppBindings } from '#server/app.ts'

/**
 * Publishing authentication.
 *
 * Missing secrets and invalid tokens produce the same response. A token with
 * a different length is compared against itself and negated so secret length
 * is not leaked by an early return.
 */

const encoder = new TextEncoder()

const timingSafeEqual = (token: string, secret: string): boolean => {
  const tokenBytes = encoder.encode(token)
  const secretBytes = encoder.encode(secret)
  const lengthsMatch = tokenBytes.byteLength === secretBytes.byteLength

  return lengthsMatch
    ? crypto.subtle.timingSafeEqual(tokenBytes, secretBytes)
    : !crypto.subtle.timingSafeEqual(tokenBytes, tokenBytes)
}

export const publishAuthMiddleware = createMiddleware<AppBindings>(async (c, next) => {
  const app = c.req.param('app')!.toLowerCase()
  const authorization = c.req.header('authorization')?.trim()
  const token = authorization ? /^Bearer\s+(.+)$/i.exec(authorization)?.[1] : undefined
  const secretName = 'PUBLISH_TOKEN_' + app.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  const secrets = c.env as unknown as Record<string, string | undefined>
  const secret = secrets[secretName]

  if (!token || !secret || !timingSafeEqual(token, secret)) {
    return c.json({ error: 'unauthorized' }, 401)
  }

  await next()
})
