import { Hono } from 'hono'
import type { AppBindings } from '#server/app.ts'
import { publishAuthMiddleware } from '#server/AuthMiddleware.ts'
import { publishMetadataHandler } from './metadata.ts'
import { publishArtifactHandler } from './artifact.ts'
import { sessionStatusHandler } from './status.ts'

const publishServer = new Hono<AppBindings>()

publishServer.use('/:app/*', publishAuthMiddleware)
publishServer.post('/:app/:release_id', publishMetadataHandler)
publishServer.put('/:app/:release_id/artifact', publishArtifactHandler)
publishServer.get('/:app/:release_id', sessionStatusHandler)

export default publishServer
