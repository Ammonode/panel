import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { config } from '../config'
import { getExtension, publicExtensionAssets } from '../extensions/registry'
import { HttpError } from '../lib/errors'
import { getSettings } from '../lib/settings'
import { authenticate } from './middleware/auth'
import { accountRoutes } from './routes/account'
import { adminBackupStorageRoutes } from './routes/admin/backup-storage'
import { adminBillingRoutes } from './routes/admin/billing'
import { adminBrandingRoutes, mediaRoutes } from './routes/admin/branding'
import { adminEggRoutes, adminNodeExtraRoutes } from './routes/admin/eggs'
import { adminMailRoutes } from './routes/admin/mail'
import { adminDatabaseHostRoutes, adminPanelRoutes } from './routes/admin/panel'
import { adminServerEditRoutes } from './routes/admin/server-edit'
import { adminServerRoutes } from './routes/admin/servers'
import { adminUserRoutes, impersonationRoutes } from './routes/admin/users'
import { affiliateRoutes } from './routes/affiliates'
import { adminAnnouncementRoutes, announcementRoutes } from './routes/announcements'
import { authRoutes } from './routes/auth'
import { billingRoutes } from './routes/billing'
import { clientRoutes } from './routes/client'
import { clientServerRoutes } from './routes/client-server'
import { clientServerExtraRoutes } from './routes/client-server-extra'
import { extensionAssetRoutes } from './routes/extension-assets'
import { accountOAuthRoutes, adminOAuthRoutes, oauthRoutes } from './routes/oauth'
import { remoteRoutes } from './routes/remote'
import { searchRoutes } from './routes/search'
import { storeRoutes } from './routes/store'
import { adminTicketRoutes, clientTicketRoutes } from './routes/tickets'
import type { AppEnv } from './types'

export const api = new Hono<AppEnv>()
  .use(authenticate)
  .get('/health', (c) => c.json({ ok: true }))
  .get('/settings/public', async (c) =>
    c.json(
      await getSettings([
        'app.name',
        'app.logo',
        'app.theme',
        'auth.registration',
        'billing.currency',
        'tickets.enabled',
        'app.support_email',
        'billing.credits_enabled',
        'affiliates.enabled',
      ]),
    ),
  )
  .get('/ui/extensions', (c) => c.json({ data: publicExtensionAssets() }))
  .route('/auth', authRoutes)
  .route('/auth', impersonationRoutes)
  .route('/auth', oauthRoutes)
  .route('/account/oauth', accountOAuthRoutes)
  .route('/account', accountRoutes)
  .route('/client', clientRoutes)
  .route('/client/servers', clientServerRoutes)
  .route('/client/servers', clientServerExtraRoutes)
  .route('/client', billingRoutes)
  .route('/store', storeRoutes)
  .route('/search', searchRoutes)
  .route('/announcements', announcementRoutes)
  .route('/affiliates', affiliateRoutes)
  .route('/client/tickets', clientTicketRoutes)
  .route('/admin', adminPanelRoutes)
  .route('/admin', adminDatabaseHostRoutes)
  .route('/admin', adminServerRoutes)
  .route('/admin', adminServerEditRoutes)
  .route('/admin', adminUserRoutes)
  .route('/admin', adminBillingRoutes)
  .route('/admin', adminMailRoutes)
  .route('/admin', adminTicketRoutes)
  .route('/admin', adminAnnouncementRoutes)
  .route('/admin', adminBrandingRoutes)
  .route('/admin', adminEggRoutes)
  .route('/admin', adminBackupStorageRoutes)
  .route('/admin', adminOAuthRoutes)
  .route('/admin', adminNodeExtraRoutes)

export type Api = typeof api

export function createApp() {
  const app = new Hono<AppEnv>()
  app.use(secureHeaders({ crossOriginEmbedderPolicy: false, contentSecurityPolicy: undefined }))

  // Basic CSRF protection for cookie authenticated requests.
  app.use('/api/*', async (c, next) => {
    const method = c.req.method
    if (
      method !== 'GET' &&
      method !== 'HEAD' &&
      !c.req.header('authorization') &&
      !c.req.path.startsWith('/api/extensions/')
    ) {
      const origin = c.req.header('origin')
      if (origin && origin !== config.url && !config.isDev) throw new HttpError(403, 'Invalid origin', 'csrf')
    }
    await next()
  })

  // Extension endpoints (payment webhooks, return URLs). Extensions verify requests themselves.
  app.all('/api/extensions/:id/*', async (c) => {
    const ext = getExtension(c.req.param('id'))
    if (!ext?.enabled || !ext.routeHandler)
      return c.json({ error: { code: 'not_found', message: 'Route not found' } }, 404)
    const path = c.req.path.slice(`/api/extensions/${c.req.param('id')}`.length) || '/'
    return ext.routeHandler(c.req.raw, path)
  })

  // Daemon endpoints use node tokens, not sessions.
  app.route('/api/remote', remoteRoutes)
  app.route('/api', api)
  app.route('/media', mediaRoutes)
  app.route('/extension-assets', extensionAssetRoutes)
  app.all('/api/*', (c) => c.json({ error: { code: 'not_found', message: 'Route not found' } }, 404))

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status)
    }
    console.error(err)
    return c.json({ error: { code: 'server_error', message: 'An unexpected error occurred.' } }, 500)
  })
  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Route not found' } }, 404))
  return app
}
