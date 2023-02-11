# undici-retry
Library for handling retry logic with undici HTTP client

## Basic example

```ts
import {sendWithRetry} from 'undici-retry';
import {Client} from "undici";
import type {Dispatcher} from "undici";

const client = new Client('http://my-url.com', {})
const request: Dispatcher.RequestOptions = {
    method: 'GET',
    path: '/',
    bodyTimeout: 500,
    headersTimeout: 500,
}

const result = await sendWithRetry(client, request, {
    maxAttempts: 3,
    delayBetweenAttemptsInMsecs: 100,
    statusCodesToRetry: [500, 502, 503],
    
    // If true, will retry within given limits if request times out
    retryOnTimeout: false,

    // if true, preserves original body as text and returns it as a part of error data if parsing as JSON is failed
    // Can be slightly slower than direct parsing of body as json
    // Default is false
    safeParseJson: true, 
})

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
