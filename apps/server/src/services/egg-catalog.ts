/**
 * Catalog of the official community eggs listed on https://eggs.pterodactyl.io/.
 * The site is built from three GitHub repositories, which we read directly so the
 * catalog always matches upstream.
 */
const REPOS = ['pterodactyl/game-eggs', 'pterodactyl/application-eggs', 'pterodactyl/generic-eggs'] as const

export type CatalogEgg = {
  id: string
  name: string
  repo: (typeof REPOS)[number]
  category: string
  path: string
  rawUrl: string
}

let cached: { at: number; eggs: CatalogEgg[] } | null = null
const TTL = 1000 * 60 * 60 * 6

const titleCase = (s: string) => s.replace(/[-_]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())

async function fetchRepo(repo: (typeof REPOS)[number]): Promise<CatalogEgg[]> {
  const res = await fetch(`https://api.github.com/repos/${repo}/git/trees/main?recursive=1`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'Ammonode-Panel' },
  })
  if (!res.ok) throw new Error(`GitHub returned ${res.status} for ${repo}`)
  const body = (await res.json()) as { tree: { path: string; type: string }[] }
  return body.tree
    .filter((n) => n.type === 'blob' && /(^|\/)egg-[^/]+\.json$/.test(n.path))
    .map((n) => {
      const parts = n.path.split('/')
      const dir = parts.at(-2) ?? parts[0]!
      return {
        id: `${repo.split('/')[1]}:${n.path}`,
        name: titleCase(dir),
        repo,
        category: titleCase(
          parts.length > 2 ? parts.slice(0, -2).join(' / ') : repo.split('/')[1]!.replace('-eggs', ''),
        ),
        path: n.path,
        rawUrl: `https://raw.githubusercontent.com/${repo}/main/${n.path}`,
      }
    })
}

export async function getEggCatalog(force = false): Promise<CatalogEgg[]> {
  if (!force && cached && Date.now() - cached.at < TTL) return cached.eggs
  const results = await Promise.allSettled(REPOS.map(fetchRepo))
  const eggs = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
  if (!eggs.length && cached) return cached.eggs
  cached = {
    at: Date.now(),
    eggs: eggs.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
  }
  return cached.eggs
}

export function isCatalogUrl(url: string) {
  return REPOS.some((r) => url.startsWith(`https://raw.githubusercontent.com/${r}/`))
}

export async function fetchCatalogEgg(url: string): Promise<unknown> {
  if (!isCatalogUrl(url))
    throw new Error('Only eggs from the official Pterodactyl egg repositories can be fetched')
  const res = await fetch(url, { headers: { 'user-agent': 'Ammonode-Panel' } })
  if (!res.ok) throw new Error(`Failed to download egg (${res.status})`)
  return res.json()
}
