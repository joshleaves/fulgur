/**
 * PublishCoordinator Durable Object — one instance per application
 * (getByName(app)). Serializes all publication state changes for that app.
 *
 * The Worker reaches this DO through its fetch() handler (the classic
 * streaming-safe pattern — RPC stream parameters are not supported by
 * Miniflare). This is an internal coordination protocol, NOT public HTTP:
 * all user-facing routes live in src/server.ts. Internal routes:
 *   POST /session          {release_id, metadata} — create/re-ack session
 *   PUT  /artifact/{rid}   raw artifact bytes      — stream -> R2 -> D1 -> commit
 *   GET  /status/{rid}                             — session state
 *
 * Concurrency model (deliberate):
 * - The "lock" is the presence of a non-expired pending session in storage.
 * - A second publish for the same app while one is active is rejected
 *   IMMEDIATELY with 409 Conflict (no queueing, no blockConcurrencyWhile —
 *   that would serialize waiters instead of rejecting them).
 * - Sessions are persisted in ctx.storage, so they survive a DO restart.
 * - A DO alarm set at session creation expires stale pending sessions and
 *   frees the app for the next publish (metadata POST succeeded but artifact
 *   PUT never arrived -> app becomes publishable again).
 *
 * PUBLISH_TIMEOUT semantics: maximum duration a pending session may hold
 * the publication lock. It is NOT a hard limit on the artifact upload itself
 * (streamed uploads have no HTTP duration limit on Workers).
 *
 * R2 immutability: the head()-then-put() check inside the artifact handler is
 * safe ONLY because every write for one app is serialized through this single
 * DO instance — no concurrent writer for keys under the app's prefix.
 */

import { DurableObject } from 'cloudflare:workers'
import { resolvePublishTimeoutMs } from '#coordinator/timeout.ts'
import { Database } from '#database'

/** DO-internal base URL (never leaves the stub.fetch boundary). */
export const DO_BASE = 'https://fulgur-coordinator.local'

/** Release id constraint shared by the public publish routes. */
export const RELEASE_ID_RE = /^[0-9A-Za-z\-_]{8,64}$/

export interface PublishMetadata {
  version: string;
  short_version?: string;
  filename: string;
  ed_signature: string;
  min_system?: string;
  release_notes?: string;
  release_notes_url?: string;
  release_notes_signature?: string;
}

export interface PublishSession {
  release_id: string;
  state: 'pending' | 'committed';
  metadata: PublishMetadata;
  started_at: number;
  timeout_ms: number;
}

const SESSION_KEY = 'publish_session'

const json = (status: number, body: Record<string, unknown>): Response => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

export class PublishCoordinator extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const { pathname } = url
    const method = request.method

    if (method === 'POST' && pathname === '/session') {
      return await this.handleSession(request)
    }
    const artifactMatch = /^\/artifact\/([^/]+)$/.exec(pathname)
    if (method === 'PUT' && artifactMatch) {
      if (!request.body) return json(400, { error: 'bad_request' })
      return await this.handleArtifact(decodeURIComponent(artifactMatch[1]), request.body)
    }
    const statusMatch = /^\/status\/([^/]+)$/.exec(pathname)
    if (method === 'GET' && statusMatch) {
      return await this.handleStatus(decodeURIComponent(statusMatch[1]))
    }
    return json(404, { error: 'not_found' })
  }

  /**
	 * Create (or idempotently re-acknowledge) a pending publish session.
	 */
  private async handleSession(request: Request): Promise<Response> {
    let payload: { release_id?: unknown; metadata?: unknown }
    try {
      payload = (await request.json()) as {
        release_id?: unknown;
        metadata?: unknown;
      }
    } catch {
      return json(400, { error: 'bad_request' })
    }
    if (
      typeof payload.release_id !== 'string' ||
      !RELEASE_ID_RE.test(payload.release_id) ||
      payload.metadata === null ||
      typeof payload.metadata !== 'object' ||
      Array.isArray(payload.metadata)
    ) {
      return json(400, { error: 'bad_request' })
    }
    const releaseId = payload.release_id
    const metadata = payload.metadata as PublishMetadata

    const now = Date.now()
    const existing = await this.ctx.storage.get<PublishSession>(SESSION_KEY)

    if (existing) {
      const keepsLock = existing.state === 'pending'
      if (existing.state === 'committed' && existing.release_id === releaseId) {
        // Reusing a finished session must not create a second publish.
        return json(409, {
          error: 'conflict',
          message: `publish for ${existing.metadata.version} already committed with this release_id`,
        })
      }
      if (keepsLock) {
        const expiresAt = existing.started_at + existing.timeout_ms
        if (now < expiresAt) {
          if (existing.release_id === releaseId) {
            // Idempotent re-acknowledgement: same session, original timeout kept.
            return json(200, {
              status: 'pending',
              release_id: releaseId,
              expires_at: new Date(expiresAt).toISOString(),
            })
          }
          // Different release_id while another publish is active -> immediate 409.
          return json(409, {
            error: 'conflict',
            message: 'another publish is currently active for this application',
          })
        }
      }
      // Committed session for another release_id, or expired pending session:
      // clear it and take over below (deleting again is a no-op).
      await this.ctx.storage.delete(SESSION_KEY)
      await this.ctx.storage.deleteAlarm()
    }

    const timeoutMs = resolvePublishTimeoutMs(
      this.env as unknown as Record<string, string | undefined>,
      (this.ctx.id.name ?? '').toLowerCase(),
    )
    const session: PublishSession = {
      release_id: releaseId,
      state: 'pending',
      metadata,
      started_at: now,
      timeout_ms: timeoutMs,
    }
    await this.ctx.storage.put(SESSION_KEY, session)
    await this.ctx.storage.setAlarm(now + timeoutMs)

    return json(201, {
      status: 'pending',
      release_id: releaseId,
      expires_at: new Date(now + timeoutMs).toISOString(),
    })
  }

  /**
	 * Stream the artifact into R2, then commit: D1 insert, current pointer,
	 * session committed, lock released. The Worker purges the appcast cache
	 * after a 201.
	 * `body` is the raw request body stream — never buffered.
	 */
  private async handleArtifact(releaseId: string, body: ReadableStream<Uint8Array>): Promise<Response> {
    const session = await this.ctx.storage.get<PublishSession>(SESSION_KEY)
    if (!session || session.release_id !== releaseId) {
      return json(404, {
        error: 'not_found',
        message: 'no pending publish session',
      })
    }
    if (session.state === 'committed') {
      return json(409, {
        error: 'conflict',
        message: 'publish already committed',
      })
    }
    const now = Date.now()
    if (now - session.started_at >= session.timeout_ms) {
      await this.ctx.storage.delete(SESSION_KEY)
      await this.ctx.storage.deleteAlarm()
      return json(404, {
        error: 'not_found',
        message: 'publish session expired; start a new publish',
      })
    }

    const app = (this.ctx.id.name ?? '').toLowerCase()
    const meta = session.metadata
    const r2Key = `${app}/${meta.version}/${meta.filename}`

    // Immutability pre-check. Safe because ALL writes for this app are
    // serialized through this DO instance — no concurrent writer for
    // keys under this app's prefix.
    const existing = await this.env.ARTIFACTS.head(r2Key)
    if (existing) {
      // Version already published: releases are immutable. The session can
      // never succeed, so release the lock immediately (a retry with a new
      // release_id will get the same 409 from R2).
      await this.ctx.storage.delete(SESSION_KEY)
      await this.ctx.storage.deleteAlarm()
      return json(409, {
        error: 'conflict',
        message: `release ${meta.version} already published (immutable)`,
      })
    }

    // Stream the artifact into R2 — zero buffering.
    try {
      await this.env.ARTIFACTS.put(r2Key, body, {
        httpMetadata: { contentType: 'application/octet-stream' },
      })
    } catch (err) {
      // Upload failed: no D1 write, release the lock immediately.
      console.warn("publish artifact upload failed", err)
      await this.ctx.storage.delete(SESSION_KEY)
      await this.ctx.storage.deleteAlarm()
      return json(502, {
        error: 'upload_failed',
        message: 'artifact upload failed; lock released, retry the publish',
      })
    }

    const obj = await this.env.ARTIFACTS.head(r2Key)
    const publishedAt = new Date().toISOString()
    try {
      await new Database(this.env.DB).commitRelease({
        slug: app,
        version: meta.version,
        r2_key: r2Key,
        filename: meta.filename,
        size: obj?.size ?? 0,
        ed_signature: meta.ed_signature,
        min_system: meta.min_system ?? null,
        short_version: meta.short_version ?? null,
        release_notes: meta.release_notes ?? null,
        release_notes_url: meta.release_notes_url ?? null,
        release_notes_signature: meta.release_notes_signature ?? null,
        published_at: publishedAt,
      })
    } catch (err) {
      // D1 commit failed: the artifact is in R2 but unreferenced
      // (orphan — safe, no release row points at it). Release the lock
      // so a retry can republish.
      console.warn("publish D1 commit failed", err)
      await this.ctx.storage.delete(SESSION_KEY)
      await this.ctx.storage.deleteAlarm()
      return json(502, {
        error: 'commit_failed',
        message: 'metadata commit failed; lock released, retry the publish',
      })
    }

    // Mark committed and free the lock.
    session.state = 'committed'
    await this.ctx.storage.put(SESSION_KEY, session)
    await this.ctx.storage.deleteAlarm()

    return json(201, {
      status: 'committed',
      app,
      version: meta.version,
      r2_key: r2Key,
      published_at: publishedAt,
    })
  }

  /** Current session state (for observability / client polling). */
  private async handleStatus(releaseId: string): Promise<Response> {
    const session = await this.ctx.storage.get<PublishSession>(SESSION_KEY)
    if (!session || session.release_id !== releaseId) {
      return json(404, { error: 'not_found' })
    }
    return json(200, {
      release_id: session.release_id,
      state: session.state,
      version: session.metadata.version,
      started_at: new Date(session.started_at).toISOString(),
      expires_at: new Date(session.started_at + session.timeout_ms).toISOString(),
    })
  }

  /**
	 * Alarm: expire a pending session whose artifact never arrived, freeing
	 * the app for the next publish. Also the safety net after a DO restart.
	 */
  async alarm(): Promise<void> {
    const session = await this.ctx.storage.get<PublishSession>(SESSION_KEY)
    if (session && session.state === 'pending') {
      await this.ctx.storage.delete(SESSION_KEY)
    }
    await this.ctx.storage.deleteAlarm()
  }
}
