import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import {
  createRoutes,
  MAX_PROXY_BODY_BYTES,
  type ApiLogger,
  type DocumentRoutesOptions,
  type FetchLike,
  type RoutesOptions,
} from './routes/index.ts'

export { MAX_PROXY_BODY_BYTES }
export type { ApiLogger, DocumentRoutesOptions, FetchLike, RoutesOptions }
export type ApiAppOptions = RoutesOptions

/**
 * Create the clinic Hono application with registered routes and bounded error handling.
 */
export function createApiApp(options: ApiAppOptions = {}) {
  const logger: ApiLogger = options.logger ?? console

  const app = new Hono().route('/', createRoutes(options))

  app.notFound((c) => c.json({ detail: 'Not found' }, 404))

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return error.getResponse()
    }
    logger.error('Unhandled API error', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    })
    return c.json({ detail: 'Internal server error' }, 500)
  })

  return app
}

export type ApiApp = ReturnType<typeof createApiApp>
