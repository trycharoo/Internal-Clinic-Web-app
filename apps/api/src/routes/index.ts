import { Hono } from 'hono'
import {
  createDocumentRoutes,
  MAX_PROXY_BODY_BYTES,
  type ApiLogger,
  type DocumentRoutesOptions,
  type FetchLike,
} from './documents.ts'
import { createHealthRoutes } from './health.ts'

export { createDocumentRoutes, createHealthRoutes, MAX_PROXY_BODY_BYTES }
export type { ApiLogger, DocumentRoutesOptions, FetchLike }
export type RoutesOptions = DocumentRoutesOptions

/**
 * Bundle all API route modules into a single Hono router for registration in app.ts.
 */
export function createRoutes(options: RoutesOptions = {}) {
  return new Hono()
    .route('/', createHealthRoutes())
    .route('/', createDocumentRoutes(options))
}
