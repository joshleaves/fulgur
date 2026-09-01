/**
 * Publish-timeout resolution.
 *
 * Fallback chain (exact per spec):
 *   PUBLISH_TIMEOUT_<APP>  ->  PUBLISH_TIMEOUT  ->  10_000 ms
 *
 * The timeout bounds the publish lock/session (the critical section),
 * not the HTTP duration of the artifact upload itself.
 */
export const DEFAULT_PUBLISH_TIMEOUT_MS = 10_000

/** "foo-stable" -> "PUBLISH_TIMEOUT_FOO_STABLE" */
export const appTimeoutVarName = (app: string): string => {
  return 'PUBLISH_TIMEOUT_' + app.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
}

export const resolvePublishTimeoutMs = (env: Record<string, string | undefined>, app: string): number => {
  const candidates = [appTimeoutVarName(app), 'PUBLISH_TIMEOUT']
  for (const name of candidates) {
    const raw = env[name]
    if (raw !== undefined && raw.trim() !== '') {
      const parsed = Number(raw)
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed
      }
    }
  }
  return DEFAULT_PUBLISH_TIMEOUT_MS
}
