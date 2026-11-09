import { join } from 'node:path'
import { serveStatic } from 'hono/bun'
import { config } from './config'
import { loadExtensions } from './extensions/registry'
import { createApp } from './http/app'
import { registerBillingJobs } from './services/billing/jobs'
import { startQueueWorker } from './services/queue'
import { startScheduler } from './services/scheduler'
import { registerScheduleRunner } from './services/schedules'
import './services/mail'

await loadExtensions()
registerBillingJobs()
registerScheduleRunner()
startScheduler()
startQueueWorker()

const app = createApp()

// Serve the compiled web UI (apps/web/dist) with SPA fallback.
const webRoot = join(import.meta.dir, '../../web/dist')
const indexFile = Bun.file(join(webRoot, 'index.html'))
app.use('/assets/*', serveStatic({ root: webRoot }))
app.use('/*', serveStatic({ root: webRoot }))
app.get('*', async (c) =>
  (await indexFile.exists())
    ? c.html(await indexFile.text())
    : c.text('Web UI is not built. Run `bun run build`.', 503),
)

const server = Bun.serve({ port: config.port, fetch: app.fetch, idleTimeout: 60 })
console.log(`Ammonode listening on ${config.url} (port ${server.port})`)
