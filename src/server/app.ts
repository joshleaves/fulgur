/**
 * Fulgur HTTP API — Hono router assembly.
 *
 * Each route lives in src/server/routes/ as one handler file. The apps and
 * publish sub-apps group those handlers; this module mounts both namespaces.
 * The Worker (src/index.ts) just mounts this server.
 *
 *   GET  /apps/{app}/appcast.xml                    — Sparkle 2 appcast (cache-first)
 *   GET  /apps/{app}/releases/{version}/{file}      — artifact download (immutable cache)
 *   GET  /apps/{app}/releases/{version}/notes.html  — embedded release notes (immutable cache)
 *   POST /publish/{app}/{release_id}                — JSON metadata -> pending publish session
 *   PUT  /publish/{app}/{release_id}/artifact       — raw artifact stream -> commit
 *   GET  /publish/{app}/{release_id}                — session status (observability)
 *
 * Design notes:
 * - The Worker is the only public surface. The per-app PublishCoordinator
 *   Durable Object is reached through stub.fetch() with an internal protocol
 *   (streaming-safe in Miniflare) and holds NO user-facing routes.
 * - App identity: an app becomes known on its first successful publish.
 *   Unknown apps produce 404 on the read path (no empty appcasts).
 * - Publishing is serialized per app via one DO instance (getByName(app));
 *   different apps publish concurrently. Active concurrent publish -> 409.
 * - Artifact uploads are streamed: request.body is handed straight to the DO
 *   and into R2 — never buffered (128 MB isolate memory limit).
 * - PUBLISH_TIMEOUT bounds the publish lock/session, not the upload itself.
 */

import { Hono } from 'hono'
import { rootHandler } from '#server/routes/root.ts'
import appsServer from '#server/routes/apps/index.ts'
import publishServer from '#server/routes/publish/index.ts'

export type AppBindings = { Bindings: Env }

const server = new Hono<AppBindings>()

server.get('/', rootHandler)
server.route('/apps', appsServer)
server.route('/publish', publishServer)

server.notFound((c) => c.json({ error: 'not_found', message: 'no such route' }, 404))

export default server
