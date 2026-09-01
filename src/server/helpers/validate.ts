/**
 * Publish metadata validation.
 * Exactly one of release_notes / release_notes_url is allowed.
 */

export interface ReleaseMetadata {
  version: string
  short_version?: string
  filename: string
  ed_signature: string
  min_system?: string
  release_notes?: string
  release_notes_url?: string
  release_notes_signature?: string
}

export interface ValidationResult {
  ok: boolean
  errors: string[]
  value?: ReleaseMetadata
}

const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.\-+_]{0,63}$/
const FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._\- ]{0,127}$/

const stringValue = (
  body: Record<string, unknown>,
  key: string,
): string | undefined => {
  const value = body[key]
  if (typeof value !== 'string') return undefined

  const trimmed = value.trim()
  return trimmed || undefined
}

export const validateMetadata = (raw: unknown): ValidationResult => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['body must be a JSON object'] }
  }

  const body = raw as Record<string, unknown>
  const errors: string[] = []

  const version = stringValue(body, 'version') ?? ''
  const filename = stringValue(body, 'filename') ?? ''
  const ed_signature = stringValue(body, 'ed_signature') ?? ''

  const short_version = stringValue(body, 'short_version')
  const min_system = stringValue(body, 'min_system')
  const release_notes = stringValue(body, 'release_notes')
  const release_notes_url = stringValue(body, 'release_notes_url')
  const release_notes_signature = stringValue(
    body,
    'release_notes_signature',
  )

  if (!version) {
    errors.push('version is required')
  } else if (!VERSION_RE.test(version)) {
    errors.push('version contains invalid characters')
  }

  if (!filename) {
    errors.push('filename is required')
  } else if (!FILENAME_RE.test(filename)) {
    errors.push('filename contains invalid characters')
  }

  if (!ed_signature) {
    errors.push(
      'ed_signature is required (Sparkle EdDSA signature of the artifact)',
    )
  }

  if (release_notes && release_notes_url) {
    errors.push('provide at most one of release_notes / release_notes_url')
  }

  if (release_notes_signature && !release_notes) {
    errors.push('release_notes_signature requires release_notes')
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    errors: [],
    value: {
      version,
      short_version,
      filename,
      ed_signature,
      min_system,
      release_notes,
      release_notes_url,
      release_notes_signature,
    },
  }
}