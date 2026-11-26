import { createAdaptorServer, type ServerType } from '@hono/node-server'
import { createApiApp, type ApiAppOptions } from './app.ts'

/**
 * Wrap the Hono application in a Node.js HTTP server without listening yet.
 */
export function createApiServer(options: ApiAppOptions = {}): ServerType {
  const app = createApiApp(options)
  return createAdaptorServer({
    fetch: app.fetch,
    overrideGlobalObjects: false,
  })
}
