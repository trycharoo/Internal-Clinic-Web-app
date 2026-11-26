import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createApiApp, type FetchLike } from './app.ts'
import { createDocumentRoutes, createHealthRoutes } from './routes/index.ts'

describe('clinic Hono app', () => {
  it('returns ok on GET /health', async () => {
    const app = createApiApp()
    const response = await app.request('/health')
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { status: 'ok', service: 'clinic-api' })
  })

  it('returns 503 when parserUrl, parserApiKey, or both are missing without calling upstream', async () => {
    for (const config of [
      { parserUrl: '', parserApiKey: '' },
      { parserUrl: 'https://parser.example', parserApiKey: '' },
      { parserUrl: '', parserApiKey: 'secret' },
    ]) {
      let called = false
      const app = createApiApp({
        ...config,
        fetchImpl: async () => {
          called = true
          return new Response('{}', { status: 200 })
        },
      })
      const response = await app.request('/api/documents/parse', {
        method: 'POST',
        body: new Uint8Array([1, 2, 3]),
      })
      assert.equal(response.status, 503)
      assert.deepEqual(await response.json(), { detail: 'Document parsing is not configured' })
      assert.equal(called, false)
    }
  })

  it('forwards body, default content-type, and x-api-key to /parse and preserves upstream responses', async () => {
    let forwarded: { url: string | URL | Request; init: RequestInit | undefined } | undefined
    const fetchImpl: FetchLike = async (url, init) => {
      forwarded = { url, init }
      return new Response('plain-text-ocr-result', {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    }
    const app = createApiApp({
      parserUrl: 'https://parser.example/',
      parserApiKey: 'private-key',
      fetchImpl,
    })

    const payload = new Uint8Array([10, 20, 30])
    const response = await app.request('/api/documents/parse', {
      method: 'POST',
      body: payload,
    })

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8')
    assert.equal(await response.text(), 'plain-text-ocr-result')
    assert.equal(forwarded?.url, 'https://parser.example/parse')
    const headers = forwarded?.init?.headers as Record<string, string>
    assert.equal(headers['content-type'], 'application/octet-stream')
    assert.equal(headers['x-api-key'], 'private-key')
    assert.deepEqual(forwarded?.init?.body, payload)

    for (const [status, detail] of [
      [415, 'Unsupported file type'],
      [422, 'Unable to parse document'],
    ] as const) {
      const errorApp = createApiApp({
        parserUrl: 'https://parser.example',
        parserApiKey: 'private-key',
        fetchImpl: async () =>
          new Response(JSON.stringify({ detail }), {
            status,
            headers: { 'content-type': 'application/json' },
          }),
      })
      const errResponse = await errorApp.request('/api/documents/parse', {
        method: 'POST',
        headers: { 'content-type': 'application/pdf' },
        body: payload,
      })
      assert.equal(errResponse.status, status)
      assert.deepEqual(await errResponse.json(), { detail })
    }
  })

  it('enforces exact maxBodyBytes boundary without calling upstream when exceeded', async () => {
    let called = 0
    const app = createApiApp({
      parserUrl: 'https://parser.example',
      parserApiKey: 'secret',
      maxBodyBytes: 4,
      fetchImpl: async (_url, init) => {
        called += 1
        return new Response(JSON.stringify({ bytes: (init?.body as Uint8Array).byteLength }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    })

    const atLimit = await app.request('/api/documents/parse', {
      method: 'POST',
      body: new Uint8Array([1, 2, 3, 4]),
    })
    assert.equal(atLimit.status, 200)
    assert.deepEqual(await atLimit.json(), { bytes: 4 })
    assert.equal(called, 1)

    const overLimit = await app.request('/api/documents/parse', {
      method: 'POST',
      body: new Uint8Array([1, 2, 3, 4, 5]),
    })
    assert.equal(overLimit.status, 413)
    assert.deepEqual(await overLimit.json(), { detail: 'Upload exceeds proxy limit' })
    assert.equal(called, 1)
  })

  it('returns 400 when reading the upload stream fails without calling upstream', async () => {
    let called = false
    const app = createApiApp({
      parserUrl: 'https://parser.example',
      parserApiKey: 'secret',
      fetchImpl: async () => {
        called = true
        return new Response('{}', { status: 200 })
      },
    })

    const failingStream = new ReadableStream<Uint8Array>({
      pull() {
        return Promise.reject(new Error('stream broke'))
      },
    })
    const reqInit: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      body: failingStream,
      duplex: 'half',
    }
    const response = await app.request('/api/documents/parse', reqInit)

    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { detail: 'Unable to read upload' })
    assert.equal(called, false)
  })

  it('returns 404 for unknown routes and unsupported methods without calling upstream', async () => {
    let called = false
    const app = createApiApp({
      parserUrl: 'https://parser.example',
      parserApiKey: 'secret',
      fetchImpl: async () => {
        called = true
        return new Response('{}', { status: 200 })
      },
    })

    for (const [method, path] of [
      ['GET', '/api/documents/parse'],
      ['POST', '/api/unknown'],
      ['POST', '/health'],
    ] as const) {
      const response = await app.request(path, { method })
      assert.equal(response.status, 404)
      assert.deepEqual(await response.json(), { detail: 'Not found' })
    }
    assert.equal(called, false)
  })

  it('returns bounded 500 response and bounded log on unexpected handler errors', async () => {
    const logged: unknown[][] = []
    const app = createApiApp({
      logger: { error: (...args: unknown[]) => logged.push(args) },
    })
    app.get('/boom', () => {
      throw new TypeError('sensitive database connection string')
    })

    const response = await app.request('/boom')
    assert.equal(response.status, 500)
    assert.deepEqual(await response.json(), { detail: 'Internal server error' })
    assert.deepEqual(logged, [['Unhandled API error', { errorName: 'TypeError' }]])
    assert.doesNotMatch(JSON.stringify(logged), /sensitive|database/)
  })

  it('keeps route paths self-contained in route modules', async () => {
    const healthRoutes = createHealthRoutes()
    const healthRes = await healthRoutes.request('/health')
    assert.equal(healthRes.status, 200)
    assert.deepEqual(await healthRes.json(), { status: 'ok', service: 'clinic-api' })

    const documentRoutes = createDocumentRoutes({ parserUrl: '', parserApiKey: '' })
    const prefixedDocRes = await documentRoutes.request('/api/documents/parse', { method: 'POST' })
    assert.equal(prefixedDocRes.status, 503)
    const unprefixedDocRes = await documentRoutes.request('/parse', { method: 'POST' })
    assert.equal(unprefixedDocRes.status, 404)

    const app = createApiApp({ parserUrl: '', parserApiKey: '' })
    for (const [method, path] of [
      ['POST', '/parse'],
      ['GET', '/health/'],
    ] as const) {
      const response = await app.request(path, { method })
      assert.equal(response.status, 404)
      assert.deepEqual(await response.json(), { detail: 'Not found' })
    }
  })
})
