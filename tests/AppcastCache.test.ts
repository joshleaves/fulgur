import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppcastCache } from '#src/AppcastCache.ts'

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
})

afterEach(() => {
  vi.unstubAllGlobals()
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

  it('uses the same canonical cache behavior for notes', async () => {
    await new AppcastCache('https://updates.example.com/apps/foo/releases/1.0.0/notes.html?ignored=true').match()

    expect(match.mock.calls[0][0].url).toBe('https://updates.example.com/apps/foo/releases/1.0.0/notes.html')
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

  it('returns whether the canonical cache entry was purged', async () => {
    remove.mockResolvedValueOnce(true)

    const purged = await new AppcastCache('https://updates.example.com/appcast.xml?ignored=true').purge()

    expect(purged).toBe(true)
    expect(remove.mock.calls[0][0].url).toBe('https://updates.example.com/appcast.xml')
  })
})
