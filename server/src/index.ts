// Entry point: `npm run dev` (tsx, locally) and `npm start` (node dist/index.js, on monday code).
import { Logger } from '@mondaycom/apps-sdk'
import { createApp } from './app'
import { LOGGER_TAG, createRealDeps } from './deps'
import { WideEvent } from './log/wideEvent'

const logger = new Logger(LOGGER_TAG)
const boot = new WideEvent('boot')

try {
  const deps = createRealDeps(logger)
  createApp(deps).listen(deps.config.port, () => {
    boot.set({ port: deps.config.port, node: process.version, cloud: Boolean(process.env.K_SERVICE) })
    boot.emit(logger)
  })
} catch (err) {
  // Fail fast with a clear message (e.g. "Missing config: TELEGRAM_BOT_TOKEN").
  boot.error(err)
  boot.emit(logger)
  process.exit(1)
}
