import { describe, it, expect } from 'vitest'
import { validateMetadata } from '#server/helpers/validate.ts'

const valid = (overrides: Record<string, unknown> = {}) => ({
  version: '1.2.3',
  filename: 'Fulgur.zip',
  ed_signature: '7cLALFUHSwvEJWSkV8',
  ...overrides,
})

describe('validateMetadata: shape checks', () => {
  it('rejects null', () => {
    const r = validateMetadata(null)
    expect(r.ok).toBe(false)
    expect(r.errors).toEqual(['body must be a JSON object'])
    expect(r.value).toBeUndefined()
  })

  it('rejects undefined', () => {
    expect(validateMetadata(undefined).ok).toBe(false)
  })

  it('rejects arrays (arrays are objects but not JSON objects here)', () => {
    expect(validateMetadata([1, 2, 3]).ok).toBe(false)
  })

  it('rejects strings', () => {
    expect(validateMetadata('1.2.3').ok).toBe(false)
  })

  it('rejects numbers and booleans', () => {
    expect(validateMetadata(42).ok).toBe(false)
    expect(validateMetadata(true).ok).toBe(false)
  })

  it('accepts a plain object', () => {
    expect(validateMetadata(valid()).ok).toBe(true)
  })
})

describe('validateMetadata: version', () => {
  it('rejects a missing version', () => {
    const r = validateMetadata({ filename: 'F.zip', ed_signature: 'sig' })
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('version is required')
  })

  it('rejects an empty/whitespace version', () => {
    expect(validateMetadata(valid({ version: '' })).ok).toBe(false)
    expect(validateMetadata(valid({ version: '   ' })).ok).toBe(false)
  })

  it('rejects non-string versions', () => {
    expect(validateMetadata(valid({ version: 123 })).ok).toBe(false)
    expect(validateMetadata(valid({ version: null })).ok).toBe(false)
  })

  it('rejects versions with invalid characters (spaces, slash, colon)', () => {
    expect(validateMetadata(valid({ version: '1 2' })).ok).toBe(false)
    expect(validateMetadata(valid({ version: '1/2' })).ok).toBe(false)
    expect(validateMetadata(valid({ version: 'v1:2' })).ok).toBe(false)
  })

  it('accepts common version formats', () => {
    for (const v of ['1', '1.2.3', '2026.09.01', 'v1.0-rc1', '2.0.0-beta.1+build.5', 'a']) {
      expect(validateMetadata(valid({ version: v })).ok).toBe(true)
    }
  })

  it('accepts a 64-char version but rejects a 65-char one (length bound)', () => {
    expect(validateMetadata(valid({ version: 'a'.repeat(64) })).ok).toBe(true)
    expect(validateMetadata(valid({ version: 'a'.repeat(65) })).ok).toBe(false)
  })
})

describe('validateMetadata: filename', () => {
  it('rejects a missing filename', () => {
    const r = validateMetadata({ version: '1.0.0', ed_signature: 'sig' })
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('filename is required')
  })

  it('rejects an empty/whitespace filename', () => {
    expect(validateMetadata(valid({ filename: '' })).ok).toBe(false)
    expect(validateMetadata(valid({ filename: '  ' })).ok).toBe(false)
  })

  it('rejects non-string filenames', () => {
    expect(validateMetadata(valid({ filename: 7 })).ok).toBe(false)
  })

  it('rejects filenames with path separators or invalid characters', () => {
    expect(validateMetadata(valid({ filename: 'foo/bar.zip' })).ok).toBe(false)
    expect(validateMetadata(valid({ filename: '../evil.zip' })).ok).toBe(false)
    expect(validateMetadata(valid({ filename: 'a<b>.zip' })).ok).toBe(false)
  })

  it('accepts filenames with letters, digits, dots, dashes, underscores and spaces', () => {
    for (const f of ['Fulgur.zip', 'Fulgur-1.2.3.dmg', 'fulgur_app.tar.xz', 'My App 1.0.zip']) {
      expect(validateMetadata(valid({ filename: f })).ok).toBe(true)
    }
  })

  it('accepts a 128-char filename but rejects a 129-char one (length bound)', () => {
    expect(validateMetadata(valid({ filename: 'a'.repeat(126) + '.z' })).ok).toBe(true)
    expect(validateMetadata(valid({ filename: 'a'.repeat(127) + '.z' })).ok).toBe(false)
  })
})

describe('validateMetadata: ed_signature', () => {
  it('rejects a missing ed_signature', () => {
    const r = validateMetadata({ version: '1.0.0', filename: 'F.zip' })
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toContain('ed_signature')
  })

  it('rejects an empty/whitespace ed_signature', () => {
    expect(validateMetadata(valid({ ed_signature: '' })).ok).toBe(false)
    expect(validateMetadata(valid({ ed_signature: ' ' })).ok).toBe(false)
  })

  it('rejects non-string ed_signature', () => {
    expect(validateMetadata(valid({ ed_signature: 12345 })).ok).toBe(false)
  })
})

describe('validateMetadata: optional fields', () => {
  it('keeps short_version when a non-empty string', () => {
    expect(validateMetadata(valid({ short_version: '1.2' })).value?.short_version).toBe('1.2')
  })

  it('drops empty/whitespace short_version', () => {
    expect(validateMetadata(valid({ short_version: '' })).value?.short_version).toBeUndefined()
    expect(validateMetadata(valid({ short_version: '  ' })).value?.short_version).toBeUndefined()
  })

  it('drops non-string optional fields', () => {
    const r = validateMetadata(valid({ short_version: 12, min_system: true }))
    expect(r.value?.short_version).toBeUndefined()
    expect(r.value?.min_system).toBeUndefined()
  })

  it('trims surrounding whitespace from optional fields', () => {
    const r = validateMetadata(valid({ min_system: ' 12.0 ', short_version: ' 1.2 ' }))
    expect(r.value?.min_system).toBe('12.0')
    expect(r.value?.short_version).toBe('1.2')
  })
})

describe('validateMetadata: release notes mutual exclusion', () => {
  it('accepts embedded release notes alone', () => {
    const r = validateMetadata(valid({ release_notes: '<h2>Hi</h2>' }))
    expect(r.ok).toBe(true)
    expect(r.value?.release_notes).toBe('<h2>Hi</h2>')
    expect(r.value?.release_notes_url).toBeUndefined()
  })

  it('accepts an external notes URL alone', () => {
    const r = validateMetadata(valid({ release_notes_url: 'https://example.com/notes.html' }))
    expect(r.ok).toBe(true)
    expect(r.value?.release_notes_url).toBe('https://example.com/notes.html')
    expect(r.value?.release_notes).toBeUndefined()
  })

  it('rejects both release_notes and release_notes_url together', () => {
    const r = validateMetadata(valid({ release_notes: '<p>hi</p>', release_notes_url: 'https://example.com' }))
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toContain('at most one')
  })

  it('treats whitespace-only notes as absent (both set -> allowed)', () => {
    const r = validateMetadata(valid({ release_notes: '  ', release_notes_url: 'https://example.com' }))
    expect(r.ok).toBe(true)
    expect(r.value?.release_notes).toBeUndefined()
  })

  it('rejects release_notes_signature when no embedded notes are provided', () => {
    const r = validateMetadata(valid({ release_notes_signature: 'sig' }))
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('release_notes_signature requires release_notes')
  })
})

describe('validateMetadata: happy path & error aggregation', () => {
  it('returns the cleaned value on success', () => {
    const r = validateMetadata(valid({ short_version: '1.2', min_system: '12.0', release_notes_url: 'https://example.com/n.html' }))
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
    expect(r.value).toEqual({
      version: '1.2.3',
      short_version: '1.2',
      filename: 'Fulgur.zip',
      ed_signature: '7cLALFUHSwvEJWSkV8',
      min_system: '12.0',
      release_notes: undefined,
      release_notes_url: 'https://example.com/n.html',
      release_notes_signature: undefined,
    })
  })

  it('aggregates all errors at once (version + filename + signature missing)', () => {
    const r = validateMetadata({})
    expect(r.ok).toBe(false)
    expect(r.errors).toHaveLength(3)
  })

  it('aggregates regex errors alongside missing fields', () => {
    const r = validateMetadata({ version: 'bad version', filename: 'bad/name', ed_signature: '' })
    expect(r.ok).toBe(false)
    expect(r.errors).toHaveLength(3)
  })

  it('ignores unknown extra fields', () => {
    const r = validateMetadata(valid({ hacker_field: 'x' }))
    expect(r.ok).toBe(true)
    expect(Object.keys(r.value ?? {})).not.toContain('hacker_field')
  })
})
