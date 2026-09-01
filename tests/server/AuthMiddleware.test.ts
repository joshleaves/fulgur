import { beforeAll, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { publishAuthMiddleware } from '#server/AuthMiddleware.ts'
import type { AppBindings } from '#server/app.ts'

beforeAll(() => {
  const subtle = crypto.subtle as unknown as {
    timingSafeEqual?: (a: ArrayBuffer, b: ArrayBuffer) => boolean;
  }

  if (!subtle.timingSafeEqual) {
    subtle.timingSafeEqual = (a, b) => {
      const x = new Uint8Array(a)
      const y = new Uint8Array(b)
      if (x.byteLength !== y.byteLength) return false

      let difference = 0
      for (let i = 0; i < x.byteLength; i++) difference |= x[i] ^ y[i]
      return difference === 0
    }
  }
})

const server = new Hono<AppBindings>()

server.use('/:app/*', publishAuthMiddleware)
server.get('/:app/resource', (c) => c.text('authorized'))

const request = (app: string, authorization?: string, secrets: Record<string, string> = {}) =>
  server.request(
    `/${app}/resource`,
    authorization ? { headers: { authorization } } : undefined,
    secrets,
  )

describe('publishAuthMiddleware', () => {
  it('accepts the configured Bearer token', async () => {
    const response = await request('foo', 'Bearer secret', { PUBLISH_TOKEN_FOO: 'secret' })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('authorized')
  })

  it('matches Bearer case-insensitively and maps the app slug to its secret', async () => {
    const response = await request('foo-stable', 'bearer stable-secret', {
      PUBLISH_TOKEN_FOO_STABLE: 'stable-secret',
    })

    expect(response.status).toBe(200)
  })

  it('ignores surrounding whitespace in the Authorization header', async () => {
    const response = await request('foo', '  Bearer secret  ', { PUBLISH_TOKEN_FOO: 'secret' })

    expect(response.status).toBe(200)
  })

  it.each([
    ['a missing Authorization header', undefined, { PUBLISH_TOKEN_FOO: 'secret' }],
    ['a non-Bearer Authorization header', 'Basic secret', { PUBLISH_TOKEN_FOO: 'secret' }],
    ['an invalid token', 'Bearer wrong', { PUBLISH_TOKEN_FOO: 'secret' }],
    ['a different-length token', 'Bearer no', { PUBLISH_TOKEN_FOO: 'much-longer-secret' }],
    ['a missing secret', 'Bearer secret', {}],
    ['an empty secret', 'Bearer secret', { PUBLISH_TOKEN_FOO: '' }],
  ])('rejects %s without revealing the reason', async (_, authorization, secrets) => {
    const response = await request('foo', authorization, secrets)

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'unauthorized' })
  })
})
