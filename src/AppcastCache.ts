/**
 * Appcast Cache API access. The Worker is the origin, so the per-colocated-POPs
 * Cache API (caches.default) is the cache we invalidate — no zone API token
 * required. The appcast is written into the cache on first miss; on publish
 * only that application's appcast URL is purged.
 */

export const APPCAST_S_MAXAGE = 60 // 1mn fallback TTL; successful publishes explicitly purge the appcast.
export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'

/** Canonical GET-only key shared by every appcast cache operation. */
export const appcastCacheKey = (app: string, origin: string): Request => {
  const base = new URL(origin)
  base.search = ''
  base.hash = ''
  base.pathname = `/apps/${encodeURIComponent(app.toLowerCase())}/appcast.xml`
  return new Request(base.toString(), { method: 'GET' })
}

export class AppcastCache {
  private readonly key: Request

  constructor(request: Request | string) {
    const url = new URL(typeof request === 'string' ? request : request.url)
    const appMatch = /^\/apps\/([^/]+)\/appcast\.xml$/.exec(url.pathname)
    this.key = appMatch ? appcastCacheKey(decodeURIComponent(appMatch[1]), url.origin) : new Request(url.origin + url.pathname)
  }

  static forApp(app: string, origin: string): AppcastCache {
    return new AppcastCache(appcastCacheKey(app, origin))
  }

  match(): Promise<Response | undefined> {
    return Promise.resolve(undefined)
    // TODO: Re-enable after beta-testing phase
    // return caches.default.match(this.key)
  }

  put(response: Response): Promise<void> {
    return caches.default.put(this.key, response.clone())
  }

  purge(): Promise<boolean> {
    return caches.default.delete(this.key)
  }
}
