// Installs, checks and removes WallAI's QStash schedules. The catalog and all of
// the logic live in src/server/qstashSchedules.js; see
// docs/research/qstash-scheduling.md. Nothing here prints QSTASH_TOKEN or
// CRON_SECRET.
//
//   npm run schedule -- check
//   npm run schedule -- apply [--only research] [--dry-run]
//   npm run schedule -- remove [--only options] --yes
import { runScheduleCommand } from '../src/server/qstashSchedules.js'

process.exitCode = await runScheduleCommand({ argv: process.argv.slice(2), env: process.env })
