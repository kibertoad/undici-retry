# undici-retry
Library for handling retry logic with undici HTTP client

## Basic example

```ts
import { sendWithRetry, DEFAULT_RETRYABLE_STATUS_CODES } from 'undici-retry';
import type { RetryConfig, RequestParams} from 'undici-retry'
import { Client } from 'undici';
import type { Dispatcher } from 'undici';

const client = new Client('http://my-url.com', {})
const request: Dispatcher.RequestOptions = {
    method: 'GET',
    path: '/',
    bodyTimeout: 500,
    headersTimeout: 500,
}

const retryConfig: RetryConfig = {
    maxAttempts: 3,
    statusCodesToRetry: DEFAULT_RETRYABLE_STATUS_CODES, // [408, 425, 429, 500, 502, 503, 504]
    retryOnTimeout: false, // If true, will retry within given limits if request times out

    // Optional: custom delay resolver for advanced retry logic
    // delayResolver: (response, statusCodesToRetry) => { ... }
}

const requestParams: RequestParams = {
    // if true, preserves original body as text and returns it as a part of error data if parsing as JSON is failed
    // Can be slightly slower than direct parsing of body as json
    // Default is false
    safeParseJson: true,

    // if true, response body will be returned as Blob
    blobBody: false,

    // if set to true, in case of an internal error (e. g. ECONNREFUSED), error will be thrown and not returned within an Either. Default is false.
    throwOnInternalError: false,
}

const result = await sendWithRetry(client, request, retryConfig, requestParams)

// If .error part of Either is set, request was not successful, and you will receive last error response
if (result.error) {
    console.log(JSON.stringify({
        body: result.error.body,
        headers: result.error.headers,
        statusCode: result.error.statusCode,
    }))
}

// If .result part of Either is set, request was successful either initially or after retrying, and you will receive the response
if (result.result) {
    console.log(JSON.stringify({
        body: result.result.body,
        headers: result.result.headers,
        statusCode: result.result.statusCode,
    }))
}
```

## Streaming response body

If you need to work with the response body as a stream (without consuming it immediately), use `sendWithRetryReturnStream`:

```ts
import { sendWithRetryReturnStream } from 'undici-retry';
import type { StreamedResponseRequestParams } from 'undici-retry';

// Note: StreamedResponseRequestParams only includes requestLabel and throwOnInternalError
// It does NOT include blobBody and safeParseJson since the body is returned as a stream
const streamParams: StreamedResponseRequestParams = {
    requestLabel: 'download-file',
    throwOnInternalError: false,
}

const result = await sendWithRetryReturnStream(client, request, retryConfig, streamParams)

if (result.result) {
    // Body is returned as a Readable stream
    const stream = result.result.body

    // IMPORTANT: The response body MUST be consumed to avoid connection leaks
    // You can consume it by reading the stream:
    const text = await stream.text()
    // or: const json = await stream.json()
    // or: const blob = await stream.blob()
    // or: pipe it to a file, process chunks, etc.
}
```

**Important: Always consume the response body**

Due to Node.js garbage collection behavior, response bodies must always be consumed or cancelled to prevent excessive connection usage and potential deadlocks. If you don't need the body content, use `.dump()`:

```ts
const response = await sendWithRetryReturnStream(client, request, retryConfig)

if (result.result) {
    // If you only need headers and don't care about the body:
    const headers = response.result.headers

    // MUST consume the body to release the connection
    await response.result.body.dump()
}
```

**Key differences from `sendWithRetry`:**
- On successful responses (status < 400), returns the body as a `Readable` stream without consuming it
- The stream can be processed however you need (piped to a file, parsed manually, etc.)
- Uses `StreamedResponseRequestParams` instead of `RequestParams` - only accepts `requestLabel` and `throwOnInternalError`
- The `blobBody` and `safeParseJson` parameters are not available (TypeScript will prevent you from passing them)
- Error responses still consume the body and return it as text or JSON (since the body must be dumped for retries)
- **You are responsible for consuming the response body** to avoid connection leaks

## Custom delay resolvers

You can write custom logic for resolving the retry delay based on the response received. The `delayResolver` function receives the response, attempt number, and the list of retryable status codes:

```ts
import type { DelayResolver } from 'undici-retry';

const customDelayResolver: DelayResolver = (response, attemptNumber, statusCodesToRetry) => {
    // Return number: delay in milliseconds before retrying
    // Return undefined: use default behavior (no delay)
    // Return -1: abort retry (do not retry this response)

    if (response.statusCode === 502) {
        // Exponential backoff for 502 errors
        return 100 * Math.pow(2, attemptNumber - 1)
    }

    if (response.statusCode === 503) {
        return -1 // Do not retry 503 errors
    }

    return undefined // Fallback to default behavior
}

const response = await sendWithRetry(client, request, {
    maxAttempts: 3,
    statusCodesToRetry: [502, 503],
    retryOnTimeout: false,
    delayResolver: customDelayResolver,
})
```

### Built-in delay resolver: `createDefaultRetryResolver`

The library provides a sophisticated default delay resolver with exponential backoff, jitter, and Retry-After header support:

```ts
import { createDefaultRetryResolver } from 'undici-retry';

const delayResolver = createDefaultRetryResolver({
    baseDelay: 100,              // Base delay in milliseconds (default: 100)
    maxDelay: 60000,             // Maximum delay cap (default: 60000)
    maxJitter: 100,              // Random jitter to add (default: 100)
    exponentialBackoff: true,    // Use exponential backoff (default: true)
    respectRetryAfter: true,     // Honor Retry-After headers for 429/503 (default: true)
})

const response = await sendWithRetry(client, request, {
    maxAttempts: 3,
    statusCodesToRetry: [429, 500, 502, 503],
    retryOnTimeout: false,
    delayResolver,
})
```

**Exponential vs Linear Backoff:**
- **Exponential backoff** (default): delay = baseDelay × 2^(attemptNumber - 1) → 100ms, 200ms, 400ms, 800ms...
- **Linear backoff**: delay = baseDelay × attemptNumber → 100ms, 200ms, 300ms, 400ms...
- Both strategies respect `maxDelay` cap and can add random jitter to prevent thundering herd

### Advanced: Using `DefaultRetryResolver` class

For full control with exponential backoff based on attempt numbers:

```ts
import { DefaultRetryResolver } from 'undici-retry';

const resolver = new DefaultRetryResolver({
    baseDelay: 100,
    maxDelay: 5000,
    exponentialBackoff: true,
    respectRetryAfter: true,
})

// Manual retry loop with attempt tracking
let attemptNumber = 1
while (attemptNumber <= 3) {
    const response = await client.request(request)

    if (response.statusCode < 400) {
        // Success
        break
    }

    const decision = resolver.resolveRetryDecision(
        response,
        attemptNumber,
        [429, 500, 502, 503]
    )

    if (!decision.shouldRetry) {
        console.log(`Not retrying: ${decision.reason}`)
        break
    }

    console.log(`Retrying after ${decision.delay}ms: ${decision.reason}`)
    await setTimeout(decision.delay)
    attemptNumber++
}
```

### Retry-After header support

Both `createDefaultRetryResolver` and `DefaultRetryResolver` automatically respect `Retry-After` headers for 429 (Too Many Requests) and 503 (Service Unavailable) responses:

- Supports both delta-seconds format: `Retry-After: 120`
- Supports HTTP-date format: `Retry-After: Wed, 21 Oct 2025 07:28:00 GMT`
- Aborts retry if delay exceeds `maxDelay`
- Falls back to base delay if header is invalid

You can parse Retry-After headers manually using the exported utility:

```ts
import { parseRetryAfterHeader } from 'undici-retry';

const result = parseRetryAfterHeader('120')
if (result.result !== undefined) {
    console.log(`Delay: ${result.result}ms`)
} else {
    console.log(`Error: ${result.error}`)
}
```

## Default retryable status codes

The library exports a constant with commonly retryable HTTP status codes:

```ts
import { DEFAULT_RETRYABLE_STATUS_CODES } from 'undici-retry';

// DEFAULT_RETRYABLE_STATUS_CODES = [408, 425, 429, 500, 502, 503, 504]
```

These represent temporary failures that typically succeed on retry:
- **408** Request Timeout
- **425** Too Early
- **429** Too Many Requests
- **500** Internal Server Error
- **502** Bad Gateway
- **503** Service Unavailable
- **504** Gateway Timeout

## Types

### RetryConfig

```ts
type RetryConfig = {
  maxAttempts: number
  delayResolver?: DelayResolver
  statusCodesToRetry?: readonly number[]
  retryOnTimeout: boolean
}
```

### DelayResolver

```ts
type DelayResolver = (
  response: Dispatcher.ResponseData,
  attemptNumber: number,
  statusCodesToRetry: readonly number[],
) => number | undefined
```

Parameters:
- `response`: The HTTP response from undici
- `attemptNumber`: The current attempt number (1-indexed, so first attempt is 1)
- `statusCodesToRetry`: List of retryable status codes

Returns:
- `number`: Delay in milliseconds before retrying
- `undefined`: Use default behavior (no delay, retry immediately)
- `-1`: Abort retry (do not retry this response)

### RequestParams

```ts
type RequestParams = {
  blobBody?: boolean
  safeParseJson?: boolean
  requestLabel?: string
  throwOnInternalError?: boolean
}
```

### StreamedResponseRequestParams

```ts
type StreamedResponseRequestParams = Omit<RequestParams, 'blobBody' | 'safeParseJson'>
// Only includes: requestLabel, throwOnInternalError
```
