/**
 * D1 access layer. No authentication state lives in D1 — publishing tokens
 * are Worker secrets only.
 *
 * Tables (see schema.sql):
 *   releases(slug, version, ...) — immutable once published
 *   current(slug, version)       — the single mutable pointer per app
 */

export interface ReleaseRow {
  slug: string
  version: string
  r2_key: string
  filename: string
  size: number
  ed_signature: string
  min_system: string | null
  short_version: string | null
  release_notes: string | null
  release_notes_url: string | null
  release_notes_signature: string | null
  published_at: string
}

export interface CurrentRow {
  slug: string
  version: string
  updated_at: string
}

export class Database {
  constructor(private readonly db: D1Database) {}

  listReleases = async (slug: string): Promise<ReleaseRow[]> => {
    const { results } = await this.db
      .prepare(
        `SELECT slug, version, r2_key, filename, size, ed_signature, min_system,
			        short_version, release_notes, release_notes_url,
			        release_notes_signature, published_at
			 FROM releases WHERE slug = ?1 ORDER BY published_at DESC`,
      )
      .bind(slug)
      .all<ReleaseRow>()
    return results ?? []
  }

  getCurrent = async (slug: string): Promise<CurrentRow | null> =>
    await this.db.prepare(`SELECT slug, version, updated_at FROM current WHERE slug = ?1`).bind(slug).first<CurrentRow>()

  getRelease = async (slug: string, version: string): Promise<ReleaseRow | null> =>
    await this.db
      .prepare(
        `SELECT slug, version, r2_key, filename, size, ed_signature, min_system,
			        short_version, release_notes, release_notes_url,
			        release_notes_signature, published_at
			 FROM releases WHERE slug = ?1 AND version = ?2`,
      )
      .bind(slug, version)
      .first<ReleaseRow>()

  /** Commit a release and move its application's current pointer atomically. */
  commitRelease = async (row: ReleaseRow): Promise<void> => {
    const now = new Date().toISOString()
    const stmts = [
      this.db
        .prepare(
          `INSERT INTO releases
				 (slug, version, r2_key, filename, size, ed_signature, min_system,
				  short_version, release_notes, release_notes_url,
				  release_notes_signature, published_at)
				 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
        )
        .bind(
          row.slug,
          row.version,
          row.r2_key,
          row.filename,
          row.size,
          row.ed_signature,
          row.min_system,
          row.short_version,
          row.release_notes,
          row.release_notes_url,
          row.release_notes_signature,
          row.published_at,
        ),
      this.db
        .prepare(
          `INSERT INTO current (slug, version, updated_at) VALUES (?1, ?2, ?3)
				 ON CONFLICT(slug) DO UPDATE SET version = ?2, updated_at = ?3`,
        )
        .bind(row.slug, row.version, now),
    ]
    await this.db.batch(stmts)
  }
}
