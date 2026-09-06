// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Vite resolves an extensionless relative import; Node ESM does not.
 *
 * That difference is invisible in development and in the test suite — both run
 * through Vite — and fatal in production, where every serverless function is
 * plain Node ESM. `api/plaid.js` imported plaidTransactions, which imported
 * transactionLedger, which imported './securityKey' with no extension, and the
 * whole route died at module load with ERR_MODULE_NOT_FOUND. Every Plaid call
 * returned FUNCTION_INVOCATION_FAILED, and no test caught it.
 *
 * This is a static check rather than an import, so it needs no credentials and
 * cannot be defeated by a module that happens to load lazily.
 */
const ROOTS = ['api', 'src/server', 'src/utils']
const RELATIVE_IMPORT = /(?:^|\n)\s*(?:import|export)[^'"\n]*from\s+['"](\.[^'"]*)['"]/g
const DYNAMIC_IMPORT = /import\(\s*['"](\.[^'"]*)['"]\s*\)/g
const HAS_EXTENSION = /\.(js|jsx|json|css)$/

function jsFilesIn(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) { jsFilesIn(path, found); continue }
    if (/\.jsx?$/.test(entry) && !/\.test\.jsx?$/.test(entry)) found.push(path)
  }
  return found
}

describe('Node ESM resolution', () => {
  it('gives every relative import an extension in server-reachable code', () => {
    const offenders = []

    for (const root of ROOTS) {
      for (const file of jsFilesIn(root)) {
        const source = readFileSync(file, 'utf8')
        for (const pattern of [RELATIVE_IMPORT, DYNAMIC_IMPORT]) {
          pattern.lastIndex = 0
          let match
          while ((match = pattern.exec(source)) !== null) {
            if (!HAS_EXTENSION.test(match[1])) offenders.push(`${file} -> ${match[1]}`)
          }
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
