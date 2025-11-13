# Migration Guide

This guide helps you migrate your code to handle breaking changes in undici-retry.

## Version 7.0.0 Breaking Changes

### Overview

Version 7.0.0 introduces a major refactoring of retry configuration to make delay resolvers more flexible and powerful:

- **Removed** several fields from `RetryConfig`
- **Changed** `DelayResolver` signature
- **Added** new delay resolver utilities and defaults

### Breaking Changes

#### 1. Removed fields from `RetryConfig`

The following fields have been removed from `RetryConfig` and moved to the delay resolver:

- ❌ `delayBetweenAttemptsInMsecs`
- ❌ `respectRetryAfter`
- ❌ `maxRetryAfterInMsecs`

**Before:**
```ts
const config: RetryConfig = {
  maxAttempts: 3,
  delayBetweenAttemptsInMsecs: 100,
  statusCodesToRetry: [429, 500, 502, 503, 504],
  retryOnTimeout: false,
  respectRetryAfter: true,
  maxRetryAfterInMsecs: 60000,
}
```

**After:**
```ts
import { createDefaultRetryResolver, DEFAULT_RETRYABLE_STATUS_CODES } from 'undici-retry'

const config: RetryConfig = {
  maxAttempts: 3,
  statusCodesToRetry: DEFAULT_RETRYABLE_STATUS_CODES,
  retryOnTimeout: false,
  delayResolver: createDefaultRetryResolver({
    baseDelay: 100,
    maxDelay: 60000,
    respectRetryAfter: true,
  }),
}
```

#### 2. Changed `DelayResolver` signature

The `DelayResolver` function now receives `attemptNumber` as the second parameter and `statusCodesToRetry` as the third parameter.

**Before:**
```ts
type DelayResolver = (response: Dispatcher.ResponseData) => number | undefined
```

**After:**
```ts
type DelayResolver = (
  response: Dispatcher.ResponseData,
  attemptNumber: number,
  statusCodesToRetry: readonly number[],
) => number | undefined
```

**Migration:**

If you have custom delay resolvers, add the second and third parameters:

**Before:**
```ts
const customResolver = (response) => {
  if (response.statusCode === 429) {
    return 5000
  }
  return undefined
}
```

**After:**
```ts
const customResolver = (response, attemptNumber, statusCodesToRetry) => {
  if (response.statusCode === 429) {
    return 5000
  }
  return undefined
}
```

The `attemptNumber` parameter enables you to implement custom backoff strategies:

```ts
const customResolver = (response, attemptNumber, statusCodesToRetry) => {
  if (response.statusCode === 502) {
    // Exponential backoff for 502 errors
    return 100 * Math.pow(2, attemptNumber - 1)
  }
  return undefined
}
```

#### 3. `statusCodesToRetry` is now optional

The `statusCodesToRetry` field is now optional in `RetryConfig`. If not provided, it defaults to `DEFAULT_RETRYABLE_STATUS_CODES`.

**Before:**
```ts
const config: RetryConfig = {
  maxAttempts: 3,
  delayBetweenAttemptsInMsecs: 100,
  statusCodesToRetry: [425, 429, 500, 502, 503, 504], // Required
  retryOnTimeout: false,
}
```

**After:**
```ts
import { DEFAULT_RETRYABLE_STATUS_CODES } from 'undici-retry'

const config: RetryConfig = {
  maxAttempts: 3,
  statusCodesToRetry: DEFAULT_RETRYABLE_STATUS_CODES, // Optional, this is the default
  retryOnTimeout: false,
}

// Or just omit it:
const config: RetryConfig = {
  maxAttempts: 3,
  retryOnTimeout: false,
  // statusCodesToRetry defaults to DEFAULT_RETRYABLE_STATUS_CODES
}
```

Note: `DEFAULT_RETRYABLE_STATUS_CODES` now includes `408` (Request Timeout) and `425` (Too Early).

### Migration Scenarios

#### Scenario 1: Using default retry behavior

**Before:**
```ts
const result = await sendWithRetry(client, request, {
  maxAttempts: 3,
  delayBetweenAttemptsInMsecs: 100,
  statusCodesToRetry: [429, 500, 502, 503, 504],
  retryOnTimeout: false,
  respectRetryAfter: true,
  maxRetryAfterInMsecs: 60000,
})
```

**After (Option 1 - Minimal change):**
```ts
import { DEFAULT_RETRYABLE_STATUS_CODES } from 'undici-retry'

const result = await sendWithRetry(client, request, {
  maxAttempts: 3,
  statusCodesToRetry: DEFAULT_RETRYABLE_STATUS_CODES,
  retryOnTimeout: false,
  // Default behavior now includes:
  // - No delay between attempts
  // - Retry-After header support for 429/503
  // - Max retry after: 60 seconds
})
```

**After (Option 2 - Explicit delay resolver):**
```ts
import { createDefaultRetryResolver, DEFAULT_RETRYABLE_STATUS_CODES } from 'undici-retry'

const result = await sendWithRetry(client, request, {
  maxAttempts: 3,
  statusCodesToRetry: DEFAULT_RETRYABLE_STATUS_CODES,
  retryOnTimeout: false,
  delayResolver: createDefaultRetryResolver({
    baseDelay: 100,
    maxDelay: 60000,
    respectRetryAfter: true,
  }),
})
```

#### Scenario 2: Custom delay between attempts

**Before:**
```ts
const result = await sendWithRetry(client, request, {
  maxAttempts: 5,
  delayBetweenAttemptsInMsecs: 500,
  statusCodesToRetry: [500, 502, 503],
  retryOnTimeout: true,
})
```

**After:**
```ts
import { createDefaultRetryResolver } from 'undici-retry'

const result = await sendWithRetry(client, request, {
  maxAttempts: 5,
  statusCodesToRetry: [500, 502, 503],
  retryOnTimeout: true,
  delayResolver: createDefaultRetryResolver({
    baseDelay: 500,
    maxJitter: 0, // No jitter
  }),
})
```

#### Scenario 3: Disabling Retry-After

**Before:**
```ts
const result = await sendWithRetry(client, request, {
  maxAttempts: 3,
  delayBetweenAttemptsInMsecs: 200,
  statusCodesToRetry: [429, 503],
  retryOnTimeout: false,
  respectRetryAfter: false,
})
```

**After:**
```ts
import { createDefaultRetryResolver } from 'undici-retry'

const result = await sendWithRetry(client, request, {
  maxAttempts: 3,
  statusCodesToRetry: [429, 503],
  retryOnTimeout: false,
  delayResolver: createDefaultRetryResolver({
    baseDelay: 200,
    respectRetryAfter: false,
  }),
})
```

#### Scenario 4: Custom delay resolver

**Before:**
```ts
const result = await sendWithRetry(client, request, {
  maxAttempts: 3,
  statusCodesToRetry: [502, 503],
  retryOnTimeout: false,
  delayResolver: (response) => {
    if (response.statusCode === 502) {
      return 60000
    }
    return undefined
  },
})
```

**After:**
```ts
const result = await sendWithRetry(client, request, {
  maxAttempts: 3,
  statusCodesToRetry: [502, 503],
  retryOnTimeout: false,
  delayResolver: (response, attemptNumber, statusCodesToRetry) => {
    // Add second and third parameters ^^^^^^^^^^^^^^^^^^  ^^^^^^^^^^^^^^^^^^
    if (response.statusCode === 502) {
      return 60000
    }
    return undefined
  },
})
```

You can now use `attemptNumber` to implement custom backoff logic:

```ts
const result = await sendWithRetry(client, request, {
  maxAttempts: 3,
  statusCodesToRetry: [502, 503],
  retryOnTimeout: false,
  delayResolver: (response, attemptNumber, statusCodesToRetry) => {
    if (response.statusCode === 502) {
      // Exponential backoff: 100ms, 200ms, 400ms, 800ms...
      return 100 * Math.pow(2, attemptNumber - 1)
    }
    return undefined
  },
})
```

#### Scenario 5: Exponential backoff

**Before:**
```ts
// Not possible in v6.x
```

**After (Option 1 - Using createDefaultRetryResolver):**
```ts
import { createDefaultRetryResolver } from 'undici-retry'

const result = await sendWithRetry(client, request, {
  maxAttempts: 5,
  statusCodesToRetry: [429, 500, 502, 503],
  retryOnTimeout: false,
  delayResolver: createDefaultRetryResolver({
    baseDelay: 100,
    maxDelay: 5000,
    exponentialBackoff: true,  // Delays: 100ms, 200ms, 400ms, 800ms, 1600ms
    respectRetryAfter: true,
  }),
})
```

**After (Option 2 - Using DefaultRetryResolver class for manual control):**
```ts
import { DefaultRetryResolver } from 'undici-retry'

const resolver = new DefaultRetryResolver({
  baseDelay: 100,
  maxDelay: 5000,
  exponentialBackoff: true,
  respectRetryAfter: true,
})

let attemptNumber = 1
while (attemptNumber <= 3) {
  const response = await client.request(request)

  if (response.statusCode < 400) {
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

  await setTimeout(decision.delay)
  attemptNumber++
}
```

### New Features

#### 1. `DEFAULT_RETRYABLE_STATUS_CODES` export

A constant containing commonly retryable HTTP status codes:

```ts
import { DEFAULT_RETRYABLE_STATUS_CODES } from 'undici-retry'

// [408, 425, 429, 500, 502, 503, 504]
```

#### 2. `createDefaultRetryResolver` factory

Creates a delay resolver with built-in retry logic:

```ts
import { createDefaultRetryResolver } from 'undici-retry'

const resolver = createDefaultRetryResolver({
  baseDelay: 100,
  maxDelay: 60000,
  maxJitter: 100,
  exponentialBackoff: false,
  respectRetryAfter: true,
})
```

#### 3. `DefaultRetryResolver` class

For manual retry loops with exponential backoff and attempt tracking:

```ts
import { DefaultRetryResolver } from 'undici-retry'

const resolver = new DefaultRetryResolver({
  baseDelay: 100,
  exponentialBackoff: true,
})

const decision = resolver.resolveRetryDecision(response, attemptNumber, statusCodes)
```

#### 4. `parseRetryAfterHeader` utility

Parse Retry-After headers manually:

```ts
import { parseRetryAfterHeader } from 'undici-retry'

const result = parseRetryAfterHeader('120')
if (result.result !== undefined) {
  console.log(`Wait ${result.result}ms`)
}
```

### Quick Reference

| Old Field | New Location |
|-----------|-------------|
| `delayBetweenAttemptsInMsecs` | `createDefaultRetryResolver({ baseDelay })` |
| `respectRetryAfter` | `createDefaultRetryResolver({ respectRetryAfter })` |
| `maxRetryAfterInMsecs` | `createDefaultRetryResolver({ maxDelay })` |

### Need Help?

If you encounter issues during migration:

1. Check the [README](./README.md) for updated examples
2. Review the [test files](./test/) for comprehensive usage examples
3. Open an issue on GitHub for assistance
