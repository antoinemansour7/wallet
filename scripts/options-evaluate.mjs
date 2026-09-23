import { readFile, writeFile } from 'node:fs/promises'
import { evaluateOptionsArchive } from '../src/server/options/evaluation.js'

const [input, output, expectedHash] = process.argv.slice(2)
if (!input || !output) throw new Error('Usage: node scripts/options-evaluate.mjs ARCHIVE.json REPORT.json [EXPECTED_REPORT_HASH]')
const report = evaluateOptionsArchive(JSON.parse(await readFile(input, 'utf8')))
if (expectedHash && expectedHash !== report.reportHash) throw new Error('Independent replay report hash mismatch')
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
console.log(JSON.stringify({ reportHash: report.reportHash, rows: report.rows.length, output }))
