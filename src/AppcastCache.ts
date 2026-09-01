/**
 * Appcast Cache API access. The Worker is the origin, so the per-colocated-POPs
 * Cache API (caches.default) is the cache we invalidate — no zone API token
 * required. The appcast is written into the cache on first miss; on publish
 * only that application's appcast URL is purged.
 */

export const APPCAST_S_MAXAGE = 86_400 // 24h fallback TTL; successful publishes explicitly purge the appcast.
export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'

export class AppcastCache {
  private readonly key: Request

  constructor(request: Request | string) {
    const url = new URL(typeof request === 'string' ? request : request.url)

    url.search = ''

    this.key = new Request(url.toString())
  }

  match(): Promise<Response | undefined> {
    return caches.default.match(this.key)
  }

  put(response: Response): Promise<void> {
    return caches.default.put(this.key, response.clone())
  }

  purge(): Promise<boolean> {
    return caches.default.delete(this.key)
  }
}
