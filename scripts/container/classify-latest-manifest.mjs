#!/usr/bin/env node
import { readFile } from 'node:fs/promises'

import { classifyLatestManifestLookup } from './promotion.mjs'

const [httpStatusText, responsePath] = process.argv.slice(2)
const httpStatus = Number(httpStatusText)
if (!Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599 || !responsePath) {
  throw new Error('usage: classify-latest-manifest.mjs HTTP_STATUS RESPONSE_PATH')
}

const responseBody = await readFile(responsePath, 'utf8')
const result = classifyLatestManifestLookup({ httpStatus, responseBody })
if (result.state === 'error') throw new Error(`latest manifest lookup failed: ${result.reason}`)
process.stdout.write(`${result.state}\n`)
