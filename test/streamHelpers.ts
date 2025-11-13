import type { Readable } from 'node:stream'

/**
 * Helper function to consume a Node.js Readable stream manually without using built-in parsing methods.
 * This demonstrates how to work with streams at a lower level using Node.js stream events.
 *
 * @param stream - The Node.js Readable stream to consume
 * @returns A promise that resolves to the stream content as a string
 */
export async function consumeStream(stream: Readable): Promise<string> {
  const chunks: Buffer[] = []

  return new Promise((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })

    stream.on('end', () => {
      // Concatenate all chunks into a single buffer
      const result = Buffer.concat(chunks)
      // Decode to string
      resolve(result.toString('utf8'))
    })

    stream.on('error', (error) => {
      reject(error)
    })
  })
}
