import { S3Client } from 'bun'
import { count, eq } from 'drizzle-orm'
import { db, schema } from '../db'
import { decrypt } from '../lib/crypto'
import { HttpError } from '../lib/errors'
import { getSettings } from '../lib/settings'
import { daemonRequest, signDaemonToken } from './daemon'

type Server = typeof schema.servers.$inferSelect
type Node = typeof schema.nodes.$inferSelect
type Backup = typeof schema.backups.$inferSelect

/** S3 client from the admin settings, or null when backups are stored on the nodes. */
export async function s3Storage() {
  const s = await getSettings([
    'backups.driver',
    'backups.s3_endpoint',
    'backups.s3_region',
    'backups.s3_bucket',
    'backups.s3_access_key',
    'backups.s3_secret_key',
    'backups.s3_prefix',
    'backups.s3_path_style',
  ])
  if (s['backups.driver'] !== 's3') return null
  let secret = ''
  try {
    secret = s['backups.s3_secret_key'] ? decrypt(String(s['backups.s3_secret_key'])) : ''
  } catch {}
  const client = new S3Client({
    endpoint: String(s['backups.s3_endpoint'] || '') || undefined,
    region: String(s['backups.s3_region'] || 'us-east-1'),
    bucket: String(s['backups.s3_bucket']),
    accessKeyId: String(s['backups.s3_access_key']),
    secretAccessKey: secret,
    virtualHostedStyle: !s['backups.s3_path_style'],
  })
  const prefix = String(s['backups.s3_prefix'] ?? '').replace(/^\/+|\/+$/g, '')
  return {
    client,
    key: (b: Pick<Backup, 'uuid' | 'serverId'>) =>
      `${prefix ? `${prefix}/` : ''}${b.serverId}/${b.uuid}.tar.gz`,
  }
}

/** Creates a backup record and asks the daemon to build it (and upload it for S3). */
export async function startBackup(
  server: Server,
  node: Node,
  opts: { name: string; ignored: string; isLocked?: boolean },
) {
  const [{ n }] = (await db
    .select({ n: count() })
    .from(schema.backups)
    .where(eq(schema.backups.serverId, server.id))) as [{ n: number }]
  if (n >= server.backupLimit) {
    throw new HttpError(
      422,
      server.backupLimit
        ? `This server is limited to ${server.backupLimit} backups. Delete one first.`
        : 'Backups are not available for this server.',
      'limit',
    )
  }
  const s3 = await s3Storage()
  const [backup] = await db
    .insert(schema.backups)
    .values({
      uuid: crypto.randomUUID(),
      serverId: server.id,
      name: opts.name,
      ignoredFiles: opts.ignored,
      isLocked: opts.isLocked ?? false,
      disk: s3 ? 's3' : 'local',
    })
    .returning()
  try {
    await daemonRequest(node, 'POST', `/api/servers/${server.uuid}/backup`, {
      uuid: backup!.uuid,
      ignore: opts.ignored,
      // Presigned PUT: the node never sees the S3 credentials. Single PUT objects can be up to 5 GB.
      ...(s3
        ? {
            adapter: 's3',
            upload_url: s3.client.presign(s3.key(backup!), {
              method: 'PUT',
              expiresIn: 6 * 3600,
              type: 'application/gzip',
            }),
          }
        : { adapter: 'local' }),
    })
  } catch (e) {
    await db.delete(schema.backups).where(eq(schema.backups.id, backup!.id))
    throw e
  }
  return backup!
}

export async function backupDownloadUrl(server: Server, node: Node, backup: Backup) {
  if (backup.disk === 's3') {
    const s3 = await s3Storage()
    if (!s3) throw new HttpError(422, 'S3 storage is no longer configured', 'invalid')
    return s3.client.presign(s3.key(backup), { method: 'GET', expiresIn: 300 })
  }
  const token = await signDaemonToken(node, { server_uuid: server.uuid, backup_uuid: backup.uuid }, 300)
  return `${node.scheme}://${node.fqdn}:${node.daemonListen}/download/backup?token=${token}`
}

export async function restoreBackup(server: Server, node: Node, backup: Backup, truncate: boolean) {
  let download_url: string | undefined
  if (backup.disk === 's3') {
    const s3 = await s3Storage()
    if (!s3) throw new HttpError(422, 'S3 storage is no longer configured', 'invalid')
    download_url = s3.client.presign(s3.key(backup), { method: 'GET', expiresIn: 6 * 3600 })
  }
  await daemonRequest(node, 'POST', `/api/servers/${server.uuid}/backup/${backup.uuid}/restore`, {
    truncate,
    adapter: backup.disk,
    download_url,
  })
}

export async function deleteBackupFile(server: Server, node: Node, backup: Backup) {
  if (backup.disk === 's3') {
    const s3 = await s3Storage()
    if (s3) await s3.client.delete(s3.key(backup))
    return
  }
  await daemonRequest(node, 'DELETE', `/api/servers/${server.uuid}/backup/${backup.uuid}`)
}
