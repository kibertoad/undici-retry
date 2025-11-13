# undici-retry
Library for handling retry logic with undici HTTP client

## Basic example

```ts
import { sendWithRetry } from 'undici-retry';
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
    delayBetweenAttemptsInMsecs: 100,
    statusCodesToRetry: [429, 500, 502, 503, 504],
    respectRetryAfter: true, // if 429 is included in "statusCodesToRetry" and this set to true, delay will be automatically calculated from 'Retry-After' header if present. Default is "true"

    // If true, will retry within given limits if request times out
    retryOnTimeout: false,

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

## Delay resolvers

You can write custom logic for resolving the retry delay based on response received. E. g.:

```ts
const OFFSET = 100

const response = await sendWithRetry(client, request, {
    maxAttempts: 3,
    statusCodesToRetry: [502, 503],
    delayBetweenAttemptsInMsecs: 30,
    retryOnTimeout: false,
    delayResolver: (response) => {
        if (response.statusCode === 502) {
            return 60000 - (now % 60000) + OFFSET // this will wait until next minute
        }

        if (response.statusCode === 503) {
            return -1 // Do not retry
        }

        return undefined // this will fallback to `delayBetweenAttemptsInMsecs` param
    },
})
```
