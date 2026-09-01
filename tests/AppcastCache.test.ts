import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppcastCache, appcastCacheKey } from '#src/AppcastCache.ts'
import { ZoneCache } from '#src/ZoneCache.ts'

const match = vi.fn(async (_request: Request): Promise<Response | undefined> => undefined)
const put = vi.fn(async (_request: Request, _response: Response): Promise<void> => {})
const remove = vi.fn(async (_request: Request): Promise<boolean> => false)

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('caches', {
    default: {
      match,
      put,
      delete: remove,
    },
  })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AppcastCache', () => {
  it.each([
    ['a URL string', 'https://updates.example.com/apps/foo/appcast.xml?channel=stable'],
    ['a Request', new Request('https://updates.example.com/apps/foo/appcast.xml?channel=beta')],
  ])('uses the canonical query-free key from %s', async (_, request) => {
    await new AppcastCache(request).match()

    const key = match.mock.calls[0][0]
    expect(key).toBeInstanceOf(Request)
    expect(key.url).toBe('https://updates.example.com/apps/foo/appcast.xml')
  })

  it('uses one canonical GET key for read, write, and purge', async () => {
    const origin = 'https://updates.example.com/'
    await AppcastCache.forApp('Foo', origin).match()
    await AppcastCache.forApp('foo', origin).put(new Response('new'))
    await AppcastCache.forApp('foo', origin).purge()

    expect(match.mock.calls[0][0].url).toBe(appcastCacheKey('foo', origin).url)
    expect(put.mock.calls[0][0].url).toBe(appcastCacheKey('foo', origin).url)
    expect(remove.mock.calls[0][0].url).toBe(appcastCacheKey('foo', origin).url)
    expect(match.mock.calls[0][0].method).toBe('GET')
  })

  it('encodes app slugs and strips query and hash from the key', () => {
    expect(appcastCacheKey('foo/bar', 'http://updates.example.com/?x=1#hash').url).toBe(
      'http://updates.example.com/apps/foo%2Fbar/appcast.xml',
    )
  })

  it('returns the response matched by the Cache API', async () => {
    const cached = new Response('<rss />')
    match.mockResolvedValueOnce(cached)

    await expect(new AppcastCache('https://updates.example.com/appcast.xml').match()).resolves.toBe(cached)
  })

  it('stores a clone so the caller response remains readable', async () => {
    const response = new Response('<rss />', {
      headers: { 'content-type': 'application/xml' },
    })

    await new AppcastCache('https://updates.example.com/appcast.xml?ignored=true').put(response)

    const [key, storedResponse] = put.mock.calls[0]
    expect(key.url).toBe('https://updates.example.com/appcast.xml')
    expect(storedResponse).not.toBe(response)
    expect(storedResponse.headers.get('content-type')).toBe('application/xml')
    await expect(storedResponse.text()).resolves.toBe('<rss />')
    await expect(response.text()).resolves.toBe('<rss />')
  })

  it('reports partial zone-cache configuration as an error', () => {
    expect(new ZoneCache({ zoneId: 'zone-id' }).configurationError).toBeTruthy()
    expect(new ZoneCache({ zoneId: 'zone-id' }).enabled).toBe(false)
  })

  it('does not call Cloudflare when zone caching is not configured', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(new ZoneCache({}).purgeAppcast('foo')).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('purges one appcast URL through the zone API when configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      new ZoneCache({ zoneId: 'zone-id', token: 'token', origin: 'https://updates.example.com/' }).purgeAppcast('foo/bar'),
    ).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/zones/zone-id/purge_cache',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer token' }),
        body: JSON.stringify({ files: ['https://updates.example.com/apps/foo%2Fbar/appcast.xml'] }),
      }),
    )
  })

  it('does not expose the zone token when the purge API fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network failure'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(new ZoneCache({ zoneId: 'zone-id', token: 'secret-token', origin: 'https://updates.example.com' }).purgeAppcast('foo')).resolves.toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns false when the zone purge API fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(new ZoneCache({ zoneId: 'zone-id', token: 'token', origin: 'https://updates.example.com' }).purgeAppcast('foo')).resolves.toBe(false)
  })

  it('does not use request headers as part of the cache key', async () => {
    const request = new Request('https://updates.example.com/apps/foo/appcast.xml?channel=beta', {
      method: 'GET',
      headers: { 'if-none-match': 'old', range: 'bytes=0-10' },
    })
    await new AppcastCache(request).match()
    expect(match.mock.calls[0][0].headers).toEqual(new Headers())
  })

  it('returns whether the canonical cache entry was purged', async () => {
    remove.mockResolvedValueOnce(true)

    const purged = await new AppcastCache('https://updates.example.com/appcast.xml?ignored=true').purge()

    expect(purged).toBe(true)
    expect(remove.mock.calls[0][0].url).toBe('https://updates.example.com/appcast.xml')
  })
})
