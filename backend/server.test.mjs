import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { afterEach, describe, it } from 'node:test'
import { promisify } from 'node:util'
import { createBackendServer } from './server.mjs'

let server

async function start(options) {
  server = createBackendServer(options)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${server.address().port}`
}

afterEach(async () => {
  if (server?.listening) await new Promise((resolve) => server.close(resolve))
})

describe('document parser proxy', () => {
  it('returns configuration error without forwarding uploads', async () => {
    let called = false
    const base = await start({ parserUrl: '', parserApiKey: '', fetchImpl: () => { called = true } })
    const response = await fetch(`${base}/api/documents/parse`, { method: 'POST', body: new FormData() })
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { detail: 'Document parsing is not configured' })
    assert.equal(called, false)
  })

  it('forwards multipart data and the secret header, preserving the parser response', async () => {
    let forwarded
    const fetchImpl = async (url, init) => {
      forwarded = { url, init }
      return new Response(JSON.stringify({ filename: 'scan.pdf', text: 'review me' }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const base = await start({ parserUrl: 'https://parser.example/', parserApiKey: 'private-key', fetchImpl })
    const form = new FormData()
    form.append('file', new Blob(['pdf bytes']), 'scan.pdf')
    const response = await fetch(`${base}/api/documents/parse`, { method: 'POST', body: form })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { filename: 'scan.pdf', text: 'review me' })
    assert.equal(forwarded.url, 'https://parser.example/parse')
    assert.equal(forwarded.init.headers['x-api-key'], 'private-key')
    assert.match(forwarded.init.headers['content-type'], /^multipart\/form-data; boundary=/)
  })

  it('returns a bounded error when the parser cannot be reached', async () => {
    const logged = []
    const failure = new TypeError('private upstream details', { cause: Object.assign(new Error('private cause'), { code: 'ECONNRESET' }) })
    const base = await start({
      parserUrl: 'https://parser.example',
      parserApiKey: 'secret',
      fetchImpl: async () => { throw failure },
      logger: { error: (...args) => logged.push(args) },
    })
    const form = new FormData()
    form.append('file', new Blob(['data']), 'scan.png')
    const response = await fetch(`${base}/api/documents/parse`, { method: 'POST', body: form })
    assert.equal(response.status, 502)
    assert.deepEqual(await response.json(), { detail: 'Document parser is unavailable' })
    assert.deepEqual(logged, [['Document parser upstream request failed', { errorName: 'TypeError', errorCode: 'ECONNRESET' }]])
    assert.doesNotMatch(JSON.stringify(logged), /private|parser\.example|secret|scan\.png/)
  })

  it('returns 413 for an oversized request without resetting the client connection', async () => {
    const base = await start({ parserUrl: 'https://parser.example', parserApiKey: 'secret' })
    const response = await fetch(`${base}/api/documents/parse`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: Buffer.alloc(27 * 1024 * 1024),
    })
    assert.equal(response.status, 413)
    assert.deepEqual(await response.json(), { detail: 'Upload exceeds proxy limit' })
  })

  it('keeps the server alive after a caller cancels an upload', async () => {
    const serverModule = new URL('./server.mjs', import.meta.url).href
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', `
      import assert from 'node:assert/strict'
      import { createConnection } from 'node:net'
      import { createBackendServer } from ${JSON.stringify(serverModule)}

      const server = createBackendServer({
        parserUrl: 'https://parser.example', parserApiKey: 'synthetic',
        fetchImpl: () => assert.fail('An incomplete upload must not be forwarded'),
      })
      let uploadRequest
      const received = new Promise((resolve) => server.once('request', (request) => {
        uploadRequest = request
        request.once('data', resolve)
      }))
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
      const socket = createConnection(server.address().port, '127.0.0.1')
      socket.write('POST /api/documents/parse HTTP/1.1\\r\\nHost: localhost\\r\\nContent-Length: 100000\\r\\nContent-Type: application/octet-stream\\r\\n\\r\\npartial')
      await received
      const aborted = new Promise((resolve) => uploadRequest.once('aborted', resolve))
      socket.destroy()
      await aborted
      // Cross an event-loop turn so an unhandled body-read rejection would
      // terminate this isolated process before its health check.
      await new Promise((resolve) => setImmediate(resolve))
      const response = await fetch('http://127.0.0.1:' + server.address().port + '/health')
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { status: 'ok', service: 'clinic-backend' })
      await new Promise((resolve) => server.close(resolve))
      console.log('Health remains available after cancelled upload')
    `], { timeout: 10_000 })
    assert.match(stdout, /Health remains available after cancelled upload/)
  })
})
