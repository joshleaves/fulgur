export interface ZoneCacheConfig {
  zoneId?: string
  token?: string
  origin?: string
}

export class ZoneCache {
  private readonly zoneId: string
  private readonly token: string
  private readonly origin: string
  readonly configurationError: string | undefined

  constructor(config: ZoneCacheConfig) {
    this.zoneId = config.zoneId?.trim() ?? ''
    this.token = config.token?.trim() ?? ''
    this.origin = config.origin?.trim().replace(/\/$/, '') ?? ''
    const configured = [this.zoneId, this.token, this.origin].filter(Boolean).length
    this.configurationError = configured === 0 || configured === 3 ? undefined : 'zone cache requires zone ID, token, and origin'
  }

  get enabled(): boolean {
    return !this.configurationError && Boolean(this.zoneId && this.token && this.origin)
  }

  async purgeAppcast(app: string): Promise<boolean> {
    if (this.configurationError) {
      console.warn('zone appcast purge configuration error')
      return false
    }
    if (!this.enabled) return false

    let response: Response
    try {
      response = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(this.zoneId)}/purge_cache`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ files: [`${this.origin}/apps/${encodeURIComponent(app)}/appcast.xml`] }),
        },
      )

    } catch {
      console.warn('zone appcast purge request failed')
      return false
    }

    if (!response.ok) {
      console.warn('zone appcast purge failed', response.status)
      return false
    }

    try {
      const result = (await response.json()) as { success?: boolean }
      return result.success === true
    } catch {
      console.warn('zone appcast purge response invalid')
      return false
    }
  }
}
