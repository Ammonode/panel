/** Admin permissions, assigned to roles. `*` grants all. */
export const adminPermissions = {
  'admin.dashboard': 'View the admin dashboard',
  'admin.users.view': 'View users',
  'admin.users.manage': 'Create, edit and delete users',
  'admin.users.impersonate': 'Log in as a user',
  'admin.roles.manage': 'Manage roles',
  'admin.settings.manage': 'Manage settings',
  'admin.extensions.manage': 'Install and configure extensions and themes',
  'admin.products.manage': 'Manage categories, products and config options',
  'admin.coupons.manage': 'Manage coupons',
  'admin.orders.view': 'View orders and services',
  'admin.services.manage': 'Manage services',
  'admin.invoices.view': 'View invoices',
  'admin.invoices.manage': 'Create, edit and refund invoices',
  'admin.tickets.view': 'View tickets',
  'admin.tickets.manage': 'Reply to and manage tickets',
  'admin.announcements.manage': 'Manage announcements',
  'admin.taxes.manage': 'Manage tax rates and currencies',
  'admin.locations.manage': 'Manage locations',
  'admin.nodes.manage': 'Manage nodes and allocations',
  'admin.nests.manage': 'Manage nests and eggs',
  'admin.servers.view': 'View all servers',
  'admin.servers.manage': 'Create, edit and delete servers',
  'admin.databases.manage': 'Manage database hosts',
  'admin.mounts.manage': 'Manage mounts',
  'admin.activity.view': 'View the activity log',
} as const

export type AdminPermission = keyof typeof adminPermissions

/** Server permissions, assigned to subusers (same model as Pterodactyl). */
export const serverPermissions = {
  websocket: { connect: 'Connect to the server websocket' },
  control: { console: 'Send commands', start: 'Start', stop: 'Stop', restart: 'Restart' },
  user: {
    create: 'Create subusers',
    read: 'View subusers',
    update: 'Edit subusers',
    delete: 'Remove subusers',
  },
  file: {
    create: 'Create files',
    read: 'List files',
    'read-content': 'Read file contents',
    update: 'Edit files',
    delete: 'Delete files',
    archive: 'Archive files',
    sftp: 'Use SFTP',
  },
  backup: { create: 'Create', read: 'View', delete: 'Delete', download: 'Download', restore: 'Restore' },
  allocation: { read: 'View', create: 'Create', update: 'Edit', delete: 'Delete' },
  startup: { read: 'View', update: 'Edit variables', 'docker-image': 'Change docker image' },
  database: {
    create: 'Create',
    read: 'View',
    update: 'Rotate password',
    delete: 'Delete',
    view_password: 'View password',
  },
  schedule: { create: 'Create', read: 'View', update: 'Edit', delete: 'Delete' },
  settings: { rename: 'Rename', reinstall: 'Reinstall' },
  activity: { read: 'View activity' },
} as const

export const allServerPermissions = Object.entries(serverPermissions).flatMap(([group, perms]) =>
  Object.keys(perms).map((p) => `${group}.${p}`),
)

export function hasPermission(granted: readonly string[], needed: string): boolean {
  if (granted.includes('*') || granted.includes(needed)) return true
  const group = needed.split('.').slice(0, -1).join('.')
  return granted.includes(`${group}.*`)
}
