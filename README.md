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
    statusCodesToRetry: [429, 500, 502, 503, 504], // note that if 429 is included, delay will be automatically calculated from 'Retry-After' header if present

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

    // if set to false, in case of an internal error (e. g. ECONNREFUSED), error will be returned within an Either and not thrown
    throwOnInternalError: true,
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
