import { Hono } from 'hono'
import type { AppBindings } from '#server/app.ts'
import { appcastHandler } from './appcast.ts'
import { downloadHandler } from './download.ts'
import { notesHandler } from './notes.ts'

const appsServer = new Hono<AppBindings>()

appsServer.get('/:app/appcast.xml', appcastHandler)
appsServer.get('/:app/releases/:version/notes.html', notesHandler)
appsServer.get('/:app/releases/:version/:file', downloadHandler)

export default appsServer
