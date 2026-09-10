/**
 * dsh-tavily-web-search, browser half — one feature-owned top-level settings
 * section (`settings.section`), shown in the settings navigation beside the
 * General / Plugins / Feishu sections. The section binds the
 * `web-search-tavily` settings namespace and renders the API-key secret
 * control plus the provider options, so the key is configurable from the Web
 * UI without hard-coding it or touching the environment.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { en, zh, type TavilyKey } from './locales.ts'
import { TavilyTabController, TAVILY_NS, type TavilyCredentialsRemote, type TavilySection } from './service.ts'
import { TavilySettingsSection } from './TavilyTab.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Tavily settings section copy. */
    'settings.tavily': TavilyKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.tavily'

/** Required services: the slot registry, locale, settings scope, and the wire face. */
export const inject = ['slots', 'locale', 'connection', 'settingsScope', 'remote', 'remote.credentials']

/**
 * Client plugin body: register the section dictionaries, bind the settings
 * scope, and contribute the Tavily section into the settings navigation.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const t: TranslateNS<'settings.tavily'> = ctx.locale.bind(NS)
  ctx.effect(
    () => ctx.locale.register(NS, { zh, en }),
    'dsh-tavily-web-search: dictionaries',
  )

  // The remote client's namespaces ride a Typert module augmentation that some
  // TypeScript builds hide from the extending client type; pin the face here.
  const credentials = (ctx.remote as unknown as { credentials: TavilyCredentialsRemote }).credentials
  const controller = new TavilyTabController(
    ctx.settingsScope.bind<TavilySection>({ namespace: TAVILY_NS }),
    credentials,
  )

  ctx.effect(
    () =>
      // The forwarded event rides the same Typert augmentation that some builds
      // hide from the client type; pin the wire call structurally (the official
      // clients subscribe to the same forwarded event).
      (ctx.remote.$on as unknown as (event: string, listener: () => void) => () => void)(
        'credentials/reference-updated',
        () => {
          void controller.readKeys()
        },
      ),
    'dsh-tavily-web-search: credential invalidations',
  )

  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'tavily-search',
        order: 25,
        label: () => t('nav'),
        locale: NS,
        inject: () => controller.inject(),
      },
      TavilySettingsSection,
    ),
  )
}
