import type { Context } from 'hono'
import type { AppBindings } from '#server/app.ts'

/** GET / — service banner. */
export const rootHandler = async (c: Context<AppBindings>): Promise<Response> => {
  return c.json({
    service: 'fulgur',
    endpoints: {
      appcast: '/apps/{app}/appcast.xml',
      download: '/apps/{app}/releases/{version}/{file}',
      notes: '/apps/{app}/releases/{version}/notes.html',
      publish_metadata: 'POST /publish/{app}/{release_id}',
      publish_artifact: 'PUT /publish/{app}/{release_id}/artifact',
      session_status: 'GET /publish/{app}/{release_id}',
    },
  })
}
