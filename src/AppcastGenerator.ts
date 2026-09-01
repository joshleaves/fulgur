/**
 * Sparkle 2 appcast generation from release metadata.
 * Field set follows the official publishing docs:
 *   <sparkle:version>, <sparkle:shortVersionString>, <sparkle:minimumSystemVersion>,
 *   <pubDate> (RFC 822), enclosure with sparkle:edSignature + length,
 *   <sparkle:releaseNotesLink> (embedded notes route or external URL).
 */

import type { ReleaseRow } from '#database'

export class AppcastGenerator {
  constructor(
    private readonly app: string,
    private readonly baseUrl: string,
    private readonly releases: ReleaseRow[],
  ) {}

  toXml(): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" xmlns:dc="http://purl.org/dc/elements/1.1/">
${this.renderChannel()}
</rss>
`
  }

  private renderChannel(): string {
    const items = this.releases.map((release) => this.renderReleaseItem(release)).join('\n')

    const escapedApp = AppcastGenerator.xmlEscape(this.app)
    const escapedBaseUrl = AppcastGenerator.xmlEscape(this.baseUrl)

    return `\t<channel>
\t\t<title>${escapedApp}</title>
\t\t<link>${escapedBaseUrl}/apps/${escapedApp}/appcast.xml</link>
\t\t<description>Release updates for ${escapedApp}</description>
\t\t<language>en</language>
${items}
\t</channel>`
  }

  private renderReleaseItem(release: ReleaseRow): string {
    const artifactUrl = `${this.baseUrl}/apps/${encodeURIComponent(this.app)}/releases/${encodeURIComponent(release.version)}/${encodeURIComponent(release.filename)}`
    const lines = [
      '\t\t<item>',
      `\t\t\t<title>Version ${AppcastGenerator.xmlEscape(release.short_version ?? release.version)}</title>`,
      `\t\t\t<link>${AppcastGenerator.xmlEscape(artifactUrl)}</link>`,
      `\t\t\t<sparkle:version>${AppcastGenerator.xmlEscape(release.version)}</sparkle:version>`,
    ]

    if (release.short_version) {
      lines.push(`\t\t\t<sparkle:shortVersionString>${AppcastGenerator.xmlEscape(release.short_version)}</sparkle:shortVersionString>`)
    }
    if (release.min_system) {
      lines.push(`\t\t\t<sparkle:minimumSystemVersion>${AppcastGenerator.xmlEscape(release.min_system)}</sparkle:minimumSystemVersion>`)
    }

    const notesLink = release.release_notes_url
      ? release.release_notes_url
      : release.release_notes
        ? `${this.baseUrl}/apps/${encodeURIComponent(this.app)}/releases/${encodeURIComponent(release.version)}/notes.html`
        : null
    if (notesLink) {
      lines.push(`\t\t\t<sparkle:releaseNotesLink>${AppcastGenerator.xmlEscape(notesLink)}</sparkle:releaseNotesLink>`)
    }

    lines.push(`\t\t\t<pubDate>${AppcastGenerator.toRfc822(release.published_at)}</pubDate>`)
    lines.push(
      `\t\t\t<enclosure url="${AppcastGenerator.xmlEscape(artifactUrl)}" sparkle:edSignature="${AppcastGenerator.xmlEscape(release.ed_signature)}" length="${release.size}" type="${AppcastGenerator.guessMime(release.filename)}" />`,
    )
    lines.push('\t\t</item>')

    return lines.join('\n')
  }

  private static xmlEscape(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  }

  private static toRfc822(iso: string): string {
    const date = new Date(iso)
    return Number.isNaN(date.getTime()) ? new Date().toUTCString() : date.toUTCString()
  }

  private static guessMime(filename: string): string {
    const lower = filename.toLowerCase()
    if (lower.endsWith('.zip')) return 'application/zip'
    if (lower.endsWith('.dmg')) return 'application/x-apple-diskimage'
    if (lower.endsWith('.tar.xz') || lower.endsWith('.txz')) return 'application/x-xz'
    if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'application/gzip'
    if (lower.endsWith('.aar')) return 'application/vnd.apple.archive'
    return 'application/octet-stream'
  }
}
