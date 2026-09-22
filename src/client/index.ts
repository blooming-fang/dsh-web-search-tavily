/**
 * dsh-tavily-web-search, browser half — one feature-owned top-level settings
 * section (`settings.section`), shown in the settings navigation beside the
 * General / Plugins sections.
 *
 * Since DSH 0.1.7 a plugin's `Config` schema is its configuration surface: the
 * settings domain discovers the profile entry and exposes its shared form
 * through `ctx.configForms`. This section binds that form for the
 * `web-search-tavily` entry and renders the provider options plus the API-key
 * pool, whose secret values live in the credentials domain and never enter the
 * configuration document.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-settings-controller/remote'
import type {} from '@deepseek-ai/dsh-credentials'
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
export const NS = 'settings.tavily'

/** Required services: the slot registry, locale, the wire face, and the shared config forms. */
export const inject = ['slots', 'locale', 'remote', 'remote.credentials', 'configForms']

/**
 * Client plugin body: register the section dictionaries, bind the plugin's
 * shared configuration form, and contribute the Tavily section into the
 * settings navigation while the Host serves the entry.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const t: TranslateNS<'settings.tavily'> = ctx.locale.bind(NS)
  ctx.effect(
    () => ctx.locale.register(NS, { zh, en }),
    'dsh-tavily-web-search: dictionaries',
  )

  const controller = new TavilyTabController(
    ctx.configForms.get<TavilySection>(TAVILY_NS),
    ctx.remote.credentials,
  )
  ctx.effect(
    () => () => { controller.dispose() },
    'dsh-tavily-web-search: form subscription',
  )

  // A key can be written from somewhere else (the credentials domain is shared),
  // and the settings section does not change when it is, so the badge would keep
  // reporting a state the Host already replaced.
  ctx.effect(
    () => ctx.remote.$on('credentials/reference-updated', () => {
      void controller.readKeys()
    }),
    'dsh-tavily-web-search: credential invalidations',
  )

  // The section is contributed only while the Host serves the entry: a
  // deployment that never composed the plugin shows no trace of the page.
  ctx.effect(
    () => ctx.configForms.whileServed([TAVILY_NS], () =>
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
      ),
    ),
    'dsh-tavily-web-search: settings section',
  )
}
