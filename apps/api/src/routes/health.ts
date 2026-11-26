import { Hono } from 'hono'

/**
 * Build Hono routes for service health probes.
 */
export function createHealthRoutes() {
  return new Hono().get('/health', (c) => c.json({ status: 'ok', service: 'clinic-api' }, 200))
}
