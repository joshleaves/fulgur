import { describe, expect, it, vi } from 'vitest'
import { Database, type ReleaseRow } from '#database'

const row: ReleaseRow = {
  slug: 'foo',
  version: '1.0.0',
  r2_key: 'foo/1.0.0/Foo.zip',
  filename: 'Foo.zip',
  size: 10,
  ed_signature: 'sig',
  min_system: null,
  short_version: null,
  release_notes: null,
  release_notes_url: null,
  release_notes_signature: null,
  published_at: '2026-09-01T00:00:00.000Z',
}

const prepared = (result: unknown) => ({
  bind: vi.fn().mockReturnThis(),
  all: vi.fn().mockResolvedValue(result),
  first: vi.fn().mockResolvedValue(result),
})

describe('Database', () => {
  it('lists releases and returns an empty array when D1 omits results', async () => {
    const statement = prepared({ results: undefined })
    const db = { prepare: vi.fn().mockReturnValue(statement) } as unknown as D1Database

    await expect(new Database(db).listReleases('foo')).resolves.toEqual([])
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('WHERE slug = ?1'))
    expect(statement.bind).toHaveBeenCalledWith('foo')
  })

  it('gets the current pointer and a release using bound parameters', async () => {
    const current = { slug: 'foo', version: '1.0.0', updated_at: 'now' }
    const currentStatement = prepared(current)
    const releaseStatement = prepared(row)
    const db = {
      prepare: vi.fn().mockReturnValueOnce(currentStatement).mockReturnValueOnce(releaseStatement),
    } as unknown as D1Database
    const database = new Database(db)

    await expect(database.getCurrent('foo')).resolves.toEqual(current)
    await expect(database.getRelease('foo', '1.0.0')).resolves.toEqual(row)
    expect(currentStatement.bind).toHaveBeenCalledWith('foo')
    expect(releaseStatement.bind).toHaveBeenCalledWith('foo', '1.0.0')
  })

  it('commits the release and current pointer as one D1 batch', async () => {
    const first = prepared(undefined)
    const second = prepared(undefined)
    const batch = vi.fn().mockResolvedValue([])
    const db = {
      prepare: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second),
      batch,
    } as unknown as D1Database

    await new Database(db).commitRelease(row)

    expect(batch).toHaveBeenCalledWith([first, second])
    expect(first.bind).toHaveBeenCalledWith(
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
    )
    expect(second.bind).toHaveBeenCalledWith(row.slug, row.version, expect.any(String))
  })
})
