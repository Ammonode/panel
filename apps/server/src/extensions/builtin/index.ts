import type { ExtensionManifest, ServerExtension } from '@ammonode/sdk'
import * as gameServers from './game-servers'
import * as paypal from './paypal'
import * as stripe from './stripe'

/** Extensions shipped with Ammonode. They use the same SDK as third-party ones. */
export const builtinExtensions: { manifest: ExtensionManifest; module: ServerExtension }[] = [
  { manifest: gameServers.manifest, module: gameServers.extension },
  { manifest: stripe.manifest, module: stripe.extension },
  { manifest: paypal.manifest, module: paypal.extension },
]
