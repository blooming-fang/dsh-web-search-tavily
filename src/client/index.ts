/**
 * dsh-tavily-web-search, browser half — one feature-owned top-level settings
 * section (`settings.section`), shown in the settings navigation beside the
 * General / Plugins / Feishu sections. The section binds the
 * `web-search-tavily` settings namespace and renders the API-key secret
 * control plus the provider options, so the key is configurable from the Web
 * UI without hard-coding it or touching the environment.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { en, zh, type TavilyKey } from './locales.ts'
import { TavilyTabController, TAVILY_NS, type TavilySection } from './service.ts'
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
export const inject = ['slots', 'locale', 'connection', 'settingsScope', 'remote']

/**
 * Client plugin body: register the section dictionaries, bind the settings
 * scope, and contribute the Tavily section into the settings navigation.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const api: IApiClient = ctx.get('connection').api
  const t: TranslateNS<'settings.tavily'> = ctx.locale.bind(NS)
  ctx.effect(
    () => ctx.locale.register(NS, { zh, en }),
    'dsh-tavily-web-search: dictionaries',
  )

  const controller = new TavilyTabController(
    ctx.settingsScope.bind<TavilySection>({ namespace: TAVILY_NS }),
    api,
  )

  ctx.effect(
    () =>
      ctx.remote.$on('credentials/reference-updated', () => {
        void controller.readKeys()
      }),
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
