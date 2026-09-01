/**
 * Integration tests running the real Worker + Durable Object in the
 * Workers runtime (vitest-pool-workers). Each file gets isolated storage.
 */
import { beforeAll, describe, it, expect } from 'vitest'
import { env, SELF } from 'cloudflare:test'
import schemaSql from '../schema.sql?raw'

const BASE = 'https://fulgur.test'
const TOK_FOO = 'test-token-foo-0000000000000000'
const TOK_BAR = 'test-token-bar-0000000000000000'

const appcastUrl = (app: string) => `${BASE}/apps/${app}/appcast.xml`
const sessionUrl = (app: string, rid: string) => `${BASE}/publish/${app}/${rid}`
const artifactUrl = (app: string, rid: string) => `${BASE}/publish/${app}/${rid}/artifact`
const authHeader = (token: string) => ({ authorization: `Bearer ${token}` })

const validMetadata = (version = '1.2.3', extra: Record<string, unknown> = {}) => ({
  version,
  filename: 'Foo.zip',
  ed_signature: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  ...extra,
})

beforeAll(async () => {
  // Local D1's exec() mishandles comment lines and multiline bodies, so
  // split schema.sql into individual statements and run each via prepare().
  const statements = schemaSql
    .split('\n')
    .filter((line: string) => !line.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*\n/)
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0)
  for (const statement of statements) {
    await env.DB.prepare(statement).run()
  }
})

describe('public read paths', () => {
  it('serves a service banner at /', async () => {
    const res = await SELF.fetch(`${BASE}/`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { service: string }
    expect(body.service).toBe('fulgur')
  })

  it('404s an appcast for an unknown app (app exists only after first publish)', async () => {
    const res = await SELF.fetch(appcastUrl('foo'))
    expect(res.status).toBe(404)
  })

  it('404s downloads and notes for unknown releases', async () => {
    const res = await SELF.fetch(`${BASE}/apps/foo/releases/9.9.9/Foo.zip`)
    expect(res.status).toBe(404)
    const notes = await SELF.fetch(`${BASE}/apps/foo/releases/9.9.9/notes.html`)
    expect(notes.status).toBe(404)
  })
})

describe('publishing auth (fail-closed, indistinguishable)', () => {
  it('rejects publish without a token', async () => {
    const res = await SELF.fetch(sessionUrl('foo', 'rid-aaaaaaaa'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validMetadata()),
    })
    expect(res.status).toBe(401)
  })

  it('rejects publish with a wrong token', async () => {
    const res = await SELF.fetch(sessionUrl('foo', 'rid-aaaaaaaa'), {
      method: 'POST',
      headers: { ...authHeader('wrong-token'), 'content-type': 'application/json' },
      body: JSON.stringify(validMetadata()),
    })
    expect(res.status).toBe(401)
  })

  it('rejects publish for an app with no token configured (missing secret)', async () => {
    // Same 401 as a wrong token: the response never reveals whether an
    // app is configured.
    const res = await SELF.fetch(sessionUrl('baz', 'rid-aaaaaaaa'), {
      method: 'POST',
      headers: { ...authHeader('any-token'), 'content-type': 'application/json' },
      body: JSON.stringify(validMetadata()),
    })
    expect(res.status).toBe(401)
  })

  it('rejects artifact PUT without auth', async () => {
    const res = await SELF.fetch(artifactUrl('foo', 'rid-aaaaaaaa'), {
      method: 'PUT',
      body: 'bytes',
    })
    expect(res.status).toBe(401)
  })
})

describe('publish lifecycle (two-request, release_id flow)', () => {
  const RID = 'rid-lifecycle-01'

  it('creates a pending session from metadata', async () => {
    const res = await SELF.fetch(sessionUrl('foo', RID), {
      method: 'POST',
      headers: { ...authHeader(TOK_FOO), 'content-type': 'application/json' },
      body: JSON.stringify(validMetadata('1.2.3', { release_notes: '<h2>Hi</h2>' })),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { status: string; expires_at: string }
    expect(body.status).toBe('pending')
    expect(new Date(body.expires_at).getTime()).toBeGreaterThan(Date.now())
  })

  it('re-acknowledges the same release_id idempotently (200)', async () => {
    const res = await SELF.fetch(sessionUrl('foo', RID), {
      method: 'POST',
      headers: { ...authHeader(TOK_FOO), 'content-type': 'application/json' },
      body: JSON.stringify(validMetadata('1.2.3')),
    })
    expect(res.status).toBe(200)
  })

  it('rejects a different release_id while a publish is active (409)', async () => {
    const res = await SELF.fetch(sessionUrl('foo', 'rid-other-0001'), {
      method: 'POST',
      headers: { ...authHeader(TOK_FOO), 'content-type': 'application/json' },
      body: JSON.stringify(validMetadata('1.2.4')),
    })
    expect(res.status).toBe(409)
  })

  it('streams the artifact and commits (201)', async () => {
    const artifact = new Uint8Array(64 * 1024).fill(0x61) // 64 KiB of 'a'
    const res = await SELF.fetch(artifactUrl('foo', RID), {
      method: 'PUT',
      headers: authHeader(TOK_FOO),
      body: artifact,
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { status: string; version: string }
    expect(body.status).toBe('committed')
    expect(body.version).toBe('1.2.3')
  })

  it('serves the appcast with the committed release', async () => {
    const res = await SELF.fetch(appcastUrl('foo'))
    expect(res.status).toBe(200)
    const xml = await res.text()
    expect(xml).toContain('<rss version="2.0"')
    expect(xml).toContain('<sparkle:version>1.2.3</sparkle:version>')
    expect(xml).toContain('length="65536"')
    expect(xml).toContain('notes.html')
  })

  it('serves embedded release notes immutably cached', async () => {
    const res = await SELF.fetch(`${BASE}/apps/foo/releases/1.2.3/notes.html`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(res.headers.get('cache-control')).toContain('immutable')
  })

  it('serves the artifact bytes with immutable cache headers', async () => {
    const res = await SELF.fetch(`${BASE}/apps/foo/releases/1.2.3/Foo.zip`)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    const bytes = await res.arrayBuffer()
    expect(bytes.byteLength).toBe(64 * 1024)
  })

  it('supports conditional artifact requests with ETags', async () => {
    const initial = await SELF.fetch(`${BASE}/apps/foo/releases/1.2.3/Foo.zip`)
    const etag = initial.headers.get('etag')
    expect(etag).toBeTruthy()

    const cached = await SELF.fetch(`${BASE}/apps/foo/releases/1.2.3/Foo.zip`, {
      headers: { 'if-none-match': etag! },
    })
    expect(cached.status).toBe(304)
  })

  it('supports a single byte range while streaming the artifact', async () => {
    const res = await SELF.fetch(`${BASE}/apps/foo/releases/1.2.3/Foo.zip`, {
      headers: { range: 'bytes=0-99' },
    })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 0-99/65536')
    expect(res.headers.get('content-length')).toBe('100')
    expect((await res.arrayBuffer()).byteLength).toBe(100)
  })

  it('rejects malformed byte ranges', async () => {
    const res = await SELF.fetch(`${BASE}/apps/foo/releases/1.2.3/Foo.zip`, {
      headers: { range: 'bytes=100-0' },
    })
    expect(res.status).toBe(416)
  })

  it('reports session state via GET', async () => {
    const res = await SELF.fetch(sessionUrl('foo', RID), {
      headers: authHeader(TOK_FOO),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { state: string; version: string }
    expect(body.state).toBe('committed')
    expect(body.version).toBe('1.2.3')
  })

  it('rejects re-using a committed release_id while its session is retained', async () => {
    // A finished session cannot be replayed to create a second publish.
    const res = await SELF.fetch(sessionUrl('foo', RID), {
      method: 'POST',
      headers: { ...authHeader(TOK_FOO), 'content-type': 'application/json' },
      body: JSON.stringify(validMetadata('1.2.3')),
    })
    expect(res.status).toBe(409)
  })

  it('rejects re-publishing the same version (immutability)', async () => {
    const rid2 = 'rid-repub-0001'
    const session = await SELF.fetch(sessionUrl('foo', rid2), {
      method: 'POST',
      headers: { ...authHeader(TOK_FOO), 'content-type': 'application/json' },
      body: JSON.stringify(validMetadata('1.2.3')),
    })
    expect(session.status).toBe(201) // session is created...
    const put = await SELF.fetch(artifactUrl('foo', rid2), {
      method: 'PUT',
      headers: authHeader(TOK_FOO),
      body: new Uint8Array(4),
    })
    expect(put.status).toBe(409) // ...but R2 immutability check rejects it
    const body = (await put.json()) as { message: string }
    expect(body.message).toContain('already published')
  })
})

describe('per-application isolation', () => {
  it('keeps foo and bar appcasts independent', async () => {
    const barAppcast = await SELF.fetch(appcastUrl('bar'))
    expect(barAppcast.status).toBe(404) // bar has not published yet
    const fooAppcast = await SELF.fetch(appcastUrl('foo'))
    expect(fooAppcast.status).toBe(200)
  })

  it("allows bar to publish concurrently with foo's session", async () => {
    // foo still holds a committed session (no lock), so both should start.
    const ridFoo = 'rid-iso-foo-01'
    const ridBar = 'rid-iso-bar-01'
    const [fooRes, barRes] = await Promise.all([
      SELF.fetch(sessionUrl('foo', ridFoo), {
        method: 'POST',
        headers: {
          ...authHeader(TOK_FOO),
          'content-type': 'application/json',
        },
        body: JSON.stringify(validMetadata('2.0.0')),
      }),
      SELF.fetch(sessionUrl('bar', ridBar), {
        method: 'POST',
        headers: {
          ...authHeader(TOK_BAR),
          'content-type': 'application/json',
        },
        body: JSON.stringify(
          validMetadata('0.9.0', {
            filename: 'Bar.dmg',
            release_notes_url: 'https://example.com/bar-notes.html',
          }),
        ),
      }),
    ])
    expect(fooRes.status).toBe(201)
    expect(barRes.status).toBe(201)

    await Promise.all([
      SELF.fetch(artifactUrl('foo', ridFoo), {
        method: 'PUT',
        headers: authHeader(TOK_FOO),
        body: new Uint8Array(1024).fill(0x01),
      }),
      SELF.fetch(artifactUrl('bar', ridBar), {
        method: 'PUT',
        headers: authHeader(TOK_BAR),
        body: new Uint8Array(2048).fill(0x02),
      }),
    ])

    const barXml = await (await SELF.fetch(appcastUrl('bar'))).text()
    expect(barXml).toContain('<sparkle:version>0.9.0</sparkle:version>')
    // External notes URL is used directly as the releaseNotesLink.
    expect(barXml).toContain('https://example.com/bar-notes.html')
    expect(barXml).toContain('<sparkle:releaseNotesLink>https://example.com/bar-notes.html</sparkle:releaseNotesLink>')

    const fooXml = await (await SELF.fetch(appcastUrl('foo'))).text()
    expect(fooXml).toContain('<sparkle:version>2.0.0</sparkle:version>')
    expect(fooXml).toContain('<sparkle:version>1.2.3</sparkle:version>')
  })
})

describe('pending session expiry', () => {
  it('frees the app when a pending session outlives its timeout', async () => {
    // PUBLISH_TIMEOUT=2000ms from the test bindings; sleep past it.
    const rid = 'rid-expire-01'
    const first = await SELF.fetch(sessionUrl('foo', rid), {
      method: 'POST',
      headers: { ...authHeader(TOK_FOO), 'content-type': 'application/json' },
      body: JSON.stringify(validMetadata('3.0.0')),
    })
    expect(first.status).toBe(201)

    await new Promise((r) => setTimeout(r, 2600))

    // Artifact PUT for the expired session -> 404...
    const stalePut = await SELF.fetch(artifactUrl('foo', rid), {
      method: 'PUT',
      headers: authHeader(TOK_FOO),
      body: new Uint8Array(4),
    })
    expect(stalePut.status).toBe(404)

    // ...and a brand-new session is accepted.
    const next = await SELF.fetch(sessionUrl('foo', 'rid-expire-02'), {
      method: 'POST',
      headers: { ...authHeader(TOK_FOO), 'content-type': 'application/json' },
      body: JSON.stringify(validMetadata('3.1.0')),
    })
    expect(next.status).toBe(201)
  })
})

describe('bad input handling', () => {
  it('rejects invalid JSON metadata', async () => {
    const res = await SELF.fetch(sessionUrl('foo', 'rid-badjson-01'), {
      method: 'POST',
      headers: { ...authHeader(TOK_FOO), 'content-type': 'application/json' },
      body: '{not json',
    })
    expect(res.status).toBe(400)
  })

  it('rejects invalid release_id format for status requests', async () => {
    const res = await SELF.fetch(sessionUrl('foo', 'bad!'), {
      headers: authHeader(TOK_FOO),
    })
    expect(res.status).toBe(400)
  })

  it('rejects invalid release_id format', async () => {
    const res = await SELF.fetch(sessionUrl('foo', 'bad!'), {
      method: 'POST',
      headers: { ...authHeader(TOK_FOO), 'content-type': 'application/json' },
      body: JSON.stringify(validMetadata()),
    })
    expect(res.status).toBe(400)
  })

  it('rejects invalid metadata (signature without embedded notes)', async () => {
    const res = await SELF.fetch(sessionUrl('foo', 'rid-badsig-01'), {
      method: 'POST',
      headers: { ...authHeader(TOK_FOO), 'content-type': 'application/json' },
      body: JSON.stringify(validMetadata('9.9.8', { release_notes_signature: 'sig' })),
    })
    expect(res.status).toBe(400)
  })

  it('rejects invalid metadata (both notes forms)', async () => {
    const res = await SELF.fetch(sessionUrl('foo', 'rid-badmeta-01'), {
      method: 'POST',
      headers: { ...authHeader(TOK_FOO), 'content-type': 'application/json' },
      body: JSON.stringify(
        validMetadata('9.9.9', {
          release_notes: '<p>1</p>',
          release_notes_url: 'https://example.com/x',
        }),
      ),
    })
    expect(res.status).toBe(400)
  })
})
