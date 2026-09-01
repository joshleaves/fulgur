import { describe, expect, it, vi } from 'vitest'
import { AppcastGenerator } from '#src/AppcastGenerator.ts'
import type { ReleaseRow } from '#database'

const release = (overrides: Partial<ReleaseRow> = {}): ReleaseRow => ({
  slug: 'foo',
  version: '1.2.3',
  r2_key: 'foo/1.2.3/Foo.zip',
  filename: 'Foo.zip',
  size: 1234,
  ed_signature: 'SIG',
  min_system: '12.0',
  short_version: '1.2',
  release_notes: null,
  release_notes_url: null,
  release_notes_signature: null,
  published_at: '2026-09-01T00:00:00.000Z',
  ...overrides,
})

const generate = (releases: ReleaseRow[], app = 'foo', baseUrl = 'https://updates.example.com') =>
  new AppcastGenerator(app, baseUrl, releases).toXml()

describe('AppcastGenerator', () => {
  it('generates the Sparkle document and core release fields', () => {
    const xml = generate([release()])

    expect(xml).toContain('<?xml version="1.0" encoding="utf-8"?>')
    expect(xml).toContain('<rss version="2.0"')
    expect(xml).toContain('<title>foo</title>')
    expect(xml).toContain('<sparkle:version>1.2.3</sparkle:version>')
    expect(xml).toContain('<sparkle:shortVersionString>1.2</sparkle:shortVersionString>')
    expect(xml).toContain('<sparkle:minimumSystemVersion>12.0</sparkle:minimumSystemVersion>')
    expect(xml).toContain('sparkle:edSignature="SIG"')
    expect(xml).toContain('length="1234"')
    expect(xml).toContain('https://updates.example.com/apps/foo/releases/1.2.3/Foo.zip')
    expect(xml).toContain('<pubDate>Tue, 01 Sep 2026 00:00:00 GMT</pubDate>')
  })

  it('links embedded release notes to the app notes route', () => {
    const xml = generate([release({ release_notes: '<h2>Hi</h2>' })])

    expect(xml).toContain(
      '<sparkle:releaseNotesLink>https://updates.example.com/apps/foo/releases/1.2.3/notes.html</sparkle:releaseNotesLink>',
    )
  })

  it('uses an external release notes URL directly', () => {
    const xml = generate([release({ release_notes_url: 'https://blog.example.com/notes' })])

    expect(xml).not.toContain('notes.html')
    expect(xml).toContain('<sparkle:releaseNotesLink>https://blog.example.com/notes</sparkle:releaseNotesLink>')
  })

  it('omits optional fields when the release does not provide them', () => {
    const xml = generate([release({ short_version: null, min_system: null })])

    expect(xml).not.toContain('<sparkle:shortVersionString>')
    expect(xml).not.toContain('<sparkle:minimumSystemVersion>')
    expect(xml).not.toContain('<sparkle:releaseNotesLink>')
  })

  it('preserves the release order supplied by the database', () => {
    const xml = generate([
      release({ version: '2.0.0', published_at: '2026-06-01T00:00:00.000Z' }),
      release({ version: '1.0.0', published_at: '2026-01-01T00:00:00.000Z' }),
    ])

    expect(xml.indexOf('2.0.0')).toBeLessThan(xml.indexOf('1.0.0'))
  })

  it('escapes XML values and URL-encodes path components', () => {
    const xml = generate(
      [release({ version: '1 & 2', filename: 'Foo & Bar.zip', short_version: '1 < 2 & 3' })],
      'a&b',
    )

    expect(xml).toContain('<title>a&amp;b</title>')
    expect(xml).toContain('Version 1 &lt; 2 &amp; 3')
    expect(xml).toContain('/apps/a%26b/releases/1%20%26%202/Foo%20%26%20Bar.zip')
  })

  it('escapes every XML-special character in enclosure attributes', () => {
    const xml = generate([release({ ed_signature: `A&B<>'"` })])

    expect(xml).toContain('sparkle:edSignature="A&amp;B&lt;&gt;&apos;&quot;"')
  })

  it('uses the current UTC date when a release date is invalid', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-02T03:04:05.000Z'))

    try {
      const xml = generate([release({ published_at: 'invalid' })])
      expect(xml).toContain('<pubDate>Wed, 02 Sep 2026 03:04:05 GMT</pubDate>')
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ['Update.ZIP', 'application/zip'],
    ['Update.dmg', 'application/x-apple-diskimage'],
    ['Update.tar.xz', 'application/x-xz'],
    ['Update.tgz', 'application/gzip'],
    ['Update.aar', 'application/vnd.apple.archive'],
    ['Update.bin', 'application/octet-stream'],
  ])('uses %s as %s', (filename, mime) => {
    const xml = generate([release({ filename })])

    expect(xml).toContain(`type="${mime}"`)
  })
})
