# Fulgur

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/joshleaves/fulgur)

**Cloudflare-native update server for Sparkle.**

Fulgur is a lightweight, multi-application update server for macOS applications using [Sparkle 2](https://sparkle-project.org/). It runs entirely on Cloudflare infrastructure (Worker + D1 + R2 + Durable Objects), is cache-first for the read path, and requires almost no administration:

- Serve Sparkle appcasts for many apps from one deployment.
- Publish a release with two authenticated requests from CI.
- A published release is **immutable**; only the "current" pointer is mutable.
- Publishing is serialized per application; different apps publish in parallel.
- No users, accounts, tokens in a database, or backoffice.

## Installation

Click **Deploy to Cloudflare** above. Cloudflare clones the repository, creates
the Worker and its D1, R2, and Durable Object resources, then deploys it. Once
the deployment is ready, clone the generated repository and initialize D1:

```bash
bun install
bunx wrangler d1 execute DB --remote --file=schema.sql
```

Each application is identified by a slug and needs its own publishing token.
For an app named `foo`, generate a token, then store it as
`PUBLISH_TOKEN_FOO`:

```bash
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
bunx wrangler secret put PUBLISH_TOKEN_FOO
```

Repeat the secret command for every app, for example
`PUBLISH_TOKEN_BAR` or `PUBLISH_TOKEN_FOO_STABLE`. The secret name is the
uppercased slug with non-alphanumeric characters replaced by underscores.
There is no separate registration step: the first successful publish creates
the app, whose Sparkle feed is then available at:

```text
https://<your-worker-domain>/apps/foo/appcast.xml
```

For a manual deployment, create the `fulgur-db` D1 database and
`fulgur-artifacts` R2 bucket, replace the D1 ID in `wrangler.jsonc`, initialize
the schema as above, configure the application secrets, then run
`bunx wrangler deploy`.

```
        Sparkle clients                    CI (one per app)
              │                                   │
              ▼                                   ▼
      GET /apps/foo/appcast.xml           POST/PUT /publish/foo/{release_id}
              │                                   │
              ▼                                   ▼
      Cloudflare CDN + Worker ──────────► PublishCoordinator DO (per app)
                     │                                   │
                     ▼                                   ▼
                    D1 ──(releases, current)──      R2 (immutable artifacts)
```

### Updating Fulgur

If you deployed Fulgur using **Deploy to Cloudflare**, your deployment lives in
your own Git repository. To update it, pull the latest changes from Fulgur and
push them to your repository:

```bash
git remote add upstream https://github.com/joshleaves/fulgur.git # first time only
git fetch upstream
git merge upstream/master
git push origin master
```

Pushing to `master` will trigger a new Cloudflare deployment. Existing D1 and
R2 data is preserved.

## Routes

| Method | Route | Auth | Purpose |
| ------ | ----- | ---- | ------- |
| GET | `/apps/{app}/appcast.xml` | — | Sparkle 2 appcast (cache-first) |
| GET | `/apps/{app}/releases/{version}/{file}` | — | Artifact download (immutable cache) |
| GET | `/apps/{app}/releases/{version}/notes.html` | — | Embedded release notes (immutable cache) |
| POST | `/publish/{app}/{release_id}` | Bearer | Step 1: publish metadata |
| PUT | `/publish/{app}/{release_id}/artifact` | Bearer | Step 2: artifact bytes (streamed) |
| GET | `/publish/{app}/{release_id}` | Bearer | Session status (observability) |

## Publishing from CI

Two requests, one client-generated `release_id` (UUID/ULID) reused for both.

```bash
RELEASE_ID=$(uuidgen | tr 'A-Z' 'a-z')

# Step 1 — metadata only
curl -fsS -X POST "https://updates.example.com/publish/foo/$RELEASE_ID" \
  -H "Authorization: Bearer $PUBLISH_TOKEN_FOO" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "1.2.3",
    "short_version": "1.2.3",
    "filename": "Foo.zip",
    "ed_signature": "<EdDSA signature from sign_update>",
    "min_system": "12.0",
    "release_notes": "<h2>What'\''s new</h2><ul><li>...</li></ul>"
  }'

# Step 2 — the artifact, raw and streamed (never buffered in the Worker)
curl -fsS -X PUT "https://updates.example.com/publish/foo/$RELEASE_ID/artifact" \
  -H "Authorization: Bearer $PUBLISH_TOKEN_FOO" \
  --data-binary @Foo.zip
```

Semantics:

- **Pending session** — step 1 creates it in the app's Durable Object, keyed by `release_id`. Repeating step 1 with the same id re-acknowledges (200); reusing a *committed* id returns 409; a second publish with a different id while one is pending returns **409 Conflict** immediately.
- **Commit** — step 2 streams the body into R2 (`{app}/{version}/{filename}`), inserts the immutable release row into D1, moves the `current` pointer, purges that app's appcast cache, and frees the lock. Returns 201.
- **Idempotency / immutability** — the `release_id` is a session identifier only; the release identity is the application version. Re-publishing an existing version is rejected with 409 (R2 immutability check, safe because every write for an app is serialized through its DO).
- **Expiry** — a pending session whose artifact never arrives expires after `PUBLISH_TIMEOUT` and the app becomes publishable again.

`release_notes` (embedded HTML, served at `/releases/{version}/notes.html`) and `release_notes_url` (external) are mutually exclusive; at most one may be provided. For apps opting into `SURequireSignedFeed`, pass `release_notes_signature` (EdDSA of the notes HTML).

## Publishing tokens

One independently revocable capability token per application, stored as a Cloudflare Worker secret — **never** in D1:

```bash
bunx wrangler secret put PUBLISH_TOKEN_FOO     # paste the token generated below
bunx wrangler secret delete PUBLISH_TOKEN_FOO  # revoke
```

- The token namespace itself defines authorization: `PUBLISH_TOKEN_FOO` authorizes only routes under `/publish/foo`, never `bar`.
- Publication endpoints **fail closed**: a missing secret and a wrong token both produce the same generic `401`: guessing a slug never creates a valid endpoint, and responses never reveal whether an app is configured.
- Comparison uses `crypto.subtle.timingSafeEqual` (native Workers API) without early returns on length mismatch.
- Generate tokens with 32 cryptographically random bytes, base64url encoded (~256 bits): `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`.

### Application identity

An app becomes known on its **first successful publish** (a D1 release row). Unknown apps return `404` on the read path: there are no empty appcasts and no pre-registration step.

## Timeouts

The publish lock/session is bounded by:

```
PUBLISH_TIMEOUT_<APP>  →  PUBLISH_TIMEOUT  →  10000 ms
```

`PUBLISH_TIMEOUT` bounds the time a pending session may hold the app's
publication lock (the critical section), **not** the HTTP duration of the
streamed upload itself. Examples:

```bash
bunx wrangler secret put PUBLISH_TIMEOUT            # global, ms
bunx wrangler secret put PUBLISH_TIMEOUT_FOO        # per app, ms
```

## Caching model

- **Appcasts** are built from D1 and written into the Cache API on first miss (`s-maxage=86400, stale-while-revalidate=60`). A successful publish purges only the affected app's appcast URL.
- **Artifacts** and embedded notes are immutable once published: `Cache-Control: public, max-age=31536000, immutable`.
- The Cache API is the Worker's edge cache — no zone API token required. Because the Worker is the origin, targeted purge via the Cache API is sufficient for this deployment shape.

## Storage

- **R2** — immutable artifacts at `{app}/{version}/{filename}`.
- **D1** — `releases` (immutable rows, PK `(slug, version)`) and `current` (the single mutable pointer per app; rollback = update this row). No authentication state in D1. Schema: `schema.sql`.

## Development

```bash
bun run dev            # wrangler dev (uses .dev.vars for local tokens)
bun test               # vitest: unit (node env) + integration (workers pool)
bun run typecheck      # tsc --noEmit
```

Local D1: `bunx wrangler d1 execute DB --local --file=schema.sql`.

## Documented assumptions & limits

- **R2 immutability** — the `head()`-then-`put()` check is race-free *because*
  all writes for one app are serialized through that app's Durable Object.
  Never write R2 keys under `{app}/` from outside the coordinator.
- **Upload size** — request body limits come from your Cloudflare plan
  (100 MB on Free/Pro, 200 MB Business, 500 MB Enterprise). Bodies are
  streamed end-to-end (128 MB isolate memory is never used to buffer).
- **Streaming transports** — the Worker reaches the DO through `stub.fetch`
  (classic pattern), not RPC stream parameters: Miniflare does not support
  ReadableStream over RPC, and `wrangler dev` must behave like production.
- **Cache API visibility** — `caches.default` is per-colocated-POP; the
  appcast TTL covers cross-POP propagation. If you need global instant
  purge, extend `src/AppcastCache.ts` with a zone purge call.
- **Channels** — not implemented. `foo@stable` is expressed as the separate
  app `foo-stable` with its own token (`PUBLISH_TOKEN_FOO_STABLE`).
- **App count** — one secret per app: 64 env vars cap (Free plan) ≈ ~60 apps;
  Paid plan raises the ceiling to 128.

## Security model

| Surface | Access |
| ------- | ------ |
| `GET /apps/*`, downloads, notes | public, no auth |
| `POST/PUT/GET /publish/*` | application-specific Bearer token |

- Compromising app `foo`'s CI runner cannot publish `bar`.
- Sparkle signing credentials stay in CI and are never required by Fulgur.
- Publishing tokens are never stored in D1; they live only in Worker secrets.
- Secrets are compared in constant time; failures are indistinguishable.
- Published artifacts are immutable; no endpoint can overwrite a release.

## Non-goals (V1)

Channels-as-feature, telemetry/analytics, admin/backoffice UI, multi-artifact
releases, authentication providers, token databases — per the spec these are
deliberately out of scope; the primitives above are the escape hatches.
