import { describe, expect, it } from 'vitest'
import { appTimeoutVarName, DEFAULT_PUBLISH_TIMEOUT_MS, resolvePublishTimeoutMs } from '#coordinator/timeout.ts'

const emptyEnv = (): Record<string, string | undefined> => ({})

describe('timeout configuration', () => {
  it('uses PUBLISH_TIMEOUT_<APP> when defined', () => {
    const env = { PUBLISH_TIMEOUT_FOO: '12345', PUBLISH_TIMEOUT: '999' }
    expect(resolvePublishTimeoutMs(env, 'foo')).toBe(12345)
  })

  it('falls back to PUBLISH_TIMEOUT', () => {
    expect(resolvePublishTimeoutMs({ PUBLISH_TIMEOUT: '4321' }, 'foo')).toBe(4321)
  })

  it('falls back to the global timeout when the app-specific value is invalid', () => {
    const env = { PUBLISH_TIMEOUT_FOO: 'invalid', PUBLISH_TIMEOUT: '4321' }
    expect(resolvePublishTimeoutMs(env, 'foo')).toBe(4321)
  })

  it('accepts numeric timeout values surrounded by whitespace', () => {
    expect(resolvePublishTimeoutMs({ PUBLISH_TIMEOUT_FOO: ' 12345 ' }, 'foo')).toBe(12345)
  })

  it('uses the default timeout when nothing is defined', () => {
    expect(resolvePublishTimeoutMs(emptyEnv(), 'foo')).toBe(DEFAULT_PUBLISH_TIMEOUT_MS)
  })

  it('ignores invalid non-positive and non-numeric values', () => {
    expect(resolvePublishTimeoutMs({ PUBLISH_TIMEOUT: 'abc' }, 'foo')).toBe(DEFAULT_PUBLISH_TIMEOUT_MS)
    expect(resolvePublishTimeoutMs({ PUBLISH_TIMEOUT: '-5' }, 'foo')).toBe(DEFAULT_PUBLISH_TIMEOUT_MS)
    expect(resolvePublishTimeoutMs({ PUBLISH_TIMEOUT: '0' }, 'foo')).toBe(DEFAULT_PUBLISH_TIMEOUT_MS)
  })

  it('derives per-app timeout variable names with dashes converted to underscores', () => {
    expect(appTimeoutVarName('foo-stable')).toBe('PUBLISH_TIMEOUT_FOO_STABLE')
  })

  it('normalizes every non-alphanumeric character in timeout variable names', () => {
    expect(appTimeoutVarName('foo@beta.canary')).toBe('PUBLISH_TIMEOUT_FOO_BETA_CANARY')
  })
})
