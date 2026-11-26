import { Hono } from 'hono'

export const MAX_PROXY_BODY_BYTES = 26 * 1024 * 1024

export type ApiLogger = {
  error: (...args: unknown[]) => void
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type DocumentRoutesOptions = {
  parserUrl?: string
  parserApiKey?: string
  fetchImpl?: FetchLike
  logger?: ApiLogger
  maxBodyBytes?: number
}

type BoundedBodyResult =
  | { ok: true; body: Uint8Array<ArrayBuffer> }
  | { ok: false; reason: 'too_large' | 'read_error' }

/**
 * Drain the request body while enforcing a byte limit so oversized uploads
 * return 413 cleanly without resetting the client TCP connection mid-stream.
 */
async function readBoundedBody(request: Request, maxBytes: number): Promise<BoundedBodyResult> {
  if (!request.body) {
    return { ok: true, body: new Uint8Array(0) }
  }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let tooLarge = false

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        tooLarge = true
        chunks.length = 0
        continue
      }
      if (!tooLarge) {
        chunks.push(value)
      }
    }
  } catch {
    return { ok: false, reason: 'read_error' }
  } finally {
    reader.releaseLock()
  }

  if (tooLarge) {
    return { ok: false, reason: 'too_large' }
  }

  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  return { ok: true, body }
}

function extractErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  if ('code' in error && typeof error.code === 'string') return error.code
  if (
    'cause' in error &&
    error.cause &&
    typeof error.cause === 'object' &&
    'code' in error.cause &&
    typeof error.cause.code === 'string'
  ) {
    return error.cause.code
  }
  return undefined
}

/**
 * Build Hono routes for document parsing proxy operations.
 */
export function createDocumentRoutes(options: DocumentRoutesOptions = {}) {
  const {
    parserUrl = process.env.DOC_PARSER_URL,
    parserApiKey = process.env.DOC_PARSER_API_KEY,
    fetchImpl = fetch,
    logger = console,
    maxBodyBytes = MAX_PROXY_BODY_BYTES,
  } = options

  return new Hono().basePath('/api/documents').post('/parse', async (c) => {
    if (!parserUrl || !parserApiKey) {
      return c.json({ detail: 'Document parsing is not configured' }, 503)
    }

    const bodyResult = await readBoundedBody(c.req.raw, maxBodyBytes)
    if (!bodyResult.ok) {
      if (bodyResult.reason === 'too_large') {
        return c.json({ detail: 'Upload exceeds proxy limit' }, 413)
      }
      return c.json({ detail: 'Unable to read upload' }, 400)
    }

    try {
      const upstream = await fetchImpl(`${parserUrl.replace(/\/$/, '')}/parse`, {
        method: 'POST',
        headers: {
          'content-type': c.req.header('content-type') || 'application/octet-stream',
          'x-api-key': parserApiKey,
        },
        body: bodyResult.body,
        signal: AbortSignal.timeout(120_000),
      })
      const payload = await upstream.text()
      const isNullBodyStatus =
        upstream.status === 204 || upstream.status === 205 || upstream.status === 304

      return new Response(isNullBodyStatus && payload.length === 0 ? null : payload, {
        status: upstream.status,
        headers: {
          'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
        },
      })
    } catch (error) {
      const errorCode = extractErrorCode(error)
      logger.error('Document parser upstream request failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
        ...(typeof errorCode === 'string' ? { errorCode } : {}),
      })
      return c.json({ detail: 'Document parser is unavailable' }, 502)
    }
  })
}
