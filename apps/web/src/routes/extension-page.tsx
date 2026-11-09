import { useParams } from '@tanstack/react-router'
import { Card, Empty } from '../components/ui'
import { useRegistry } from '../extensions/registry'

/** Renders pages registered by extensions under /x/... and /admin/x/... */
export function ExtensionPage({ area }: { area: 'client' | 'admin' }) {
  const params = useParams({ strict: false }) as { _splat?: string }
  const { routes } = useRegistry()
  const path = `/${params._splat ?? ''}`.replace(/\/+$/, '') || '/'
  const route = routes.find((r) => r.area === area && (r.path.replace(/\/+$/, '') || '/') === path)
  if (!route)
    return (
      <Card>
        <Empty title="Page not found">This page may belong to an extension that is disabled.</Empty>
      </Card>
    )
  const C = route.component
  return <C />
}
