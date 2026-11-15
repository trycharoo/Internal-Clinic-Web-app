import { createServer } from 'node:http'

const port = Number(process.env.PORT || 3000)
const maxProxyBodyBytes = 26 * 1024 * 1024

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

export function createBackendServer({ parserUrl = process.env.DOC_PARSER_URL, parserApiKey = process.env.DOC_PARSER_API_KEY, fetchImpl = fetch, logger = console } = {}) {
  return createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      return sendJson(response, 200, { status: 'ok', service: 'clinic-backend' })
    }
    if (request.method !== 'POST' || request.url !== '/api/documents/parse') {
      return sendJson(response, 404, { detail: 'Not found' })
    }
    if (!parserUrl || !parserApiKey) {
      return sendJson(response, 503, { detail: 'Document parsing is not configured' })
    }

    const chunks = []
    let size = 0
    let tooLarge = false
    try {
      for await (const chunk of request) {
        size += chunk.length
        if (size > maxProxyBodyBytes) {
          tooLarge = true
          chunks.length = 0
          continue
        }
        if (!tooLarge) chunks.push(chunk)
      }
    } catch {
      if (!request.aborted && !response.destroyed) {
        sendJson(response, 400, { detail: 'Unable to read upload' })
      }
      return
    }
    if (tooLarge) return sendJson(response, 413, { detail: 'Upload exceeds proxy limit' })

    try {
      const upstream = await fetchImpl(`${parserUrl.replace(/\/$/, '')}/parse`, {
        method: 'POST',
        headers: {
          'content-type': request.headers['content-type'] || 'application/octet-stream',
          'x-api-key': parserApiKey,
        },
        body: Buffer.concat(chunks),
        signal: AbortSignal.timeout(120_000),
      })
      const payload = await upstream.text()
      response.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      })
      response.end(payload)
    } catch (error) {
      const cause = error && typeof error === 'object' && 'cause' in error ? error.cause : null
      const errorCode = error && typeof error === 'object' && 'code' in error
        ? error.code
        : cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined
      logger.error('Document parser upstream request failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
        ...(typeof errorCode === 'string' ? { errorCode } : {}),
      })
      sendJson(response, 502, { detail: 'Document parser is unavailable' })
    }
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createBackendServer().listen(port, '0.0.0.0', () => console.log(`Clinic backend listening on ${port}`))
}
