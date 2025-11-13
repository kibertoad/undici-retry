import { Client } from 'undici'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDefaultRetryResolver } from '../lib/defaultRetryResolver'
import { sendWithRetry } from '../lib/undiciRetry'

describe('DefaultRetryResolver Integration', () => {
  let serverUrl: string
  let server: any
  let requestCount = 0

  beforeAll(async () => {
    const { createServer } = await import('node:http')

    server = createServer((req, res) => {
      requestCount++

      // First request fails with 503, second succeeds
      if (requestCount === 1) {
        res.writeHead(503, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Service Unavailable' }))
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
      }
    })

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address()
        serverUrl = `http://localhost:${address.port}`
        resolve()
      })
    })
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
  })

  it('works with sendWithRetry using DelayResolver interface', async () => {
    requestCount = 0

    const client = new Client(serverUrl)
    const delayResolver = createDefaultRetryResolver({
      baseDelay: 10,
      maxJitter: 0,
      retryableStatusCodes: [503],
    })

    const result = await sendWithRetry(
      client,
      {
        path: '/',
        method: 'GET',
      },
      {
        maxAttempts: 3,
        statusCodesToRetry: [503],
        delayResolver,
      },
    )

    expect(result.result).toBeDefined()
    expect(result.result?.body).toEqual({ success: true })
    expect(requestCount).toBe(2) // First request fails, second succeeds

    await client.close()
  })

  it('aborts retry when delay exceeds maxDelay', async () => {
    const { createServer } = await import('node:http')

    let localRequestCount = 0
    const localServer = createServer((req, res) => {
      localRequestCount++
      // Always return 429 with a long Retry-After
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': '120', // 120 seconds
      })
      res.end(JSON.stringify({ error: 'Too Many Requests' }))
    })

    const localServerUrl = await new Promise<string>((resolve) => {
      localServer.listen(0, () => {
        const address = localServer.address() as any
        resolve(`http://localhost:${address.port}`)
      })
    })

    const client = new Client(localServerUrl)
    const delayResolver = createDefaultRetryResolver({
      baseDelay: 100,
      maxDelay: 5000, // 5 seconds max
      retryableStatusCodes: [429],
    })

    const result = await sendWithRetry(
      client,
      {
        path: '/',
        method: 'GET',
      },
      {
        maxAttempts: 3,
        statusCodesToRetry: [429],
        delayResolver,
      },
    )

    // Should get error response immediately without retrying
    expect(result.error).toBeDefined()
    expect(result.error?.statusCode).toBe(429)
    expect(localRequestCount).toBe(1) // Only one request, no retries

    await client.close()
    await new Promise<void>((resolve) => {
      localServer.close(() => resolve())
    })
  })
})
