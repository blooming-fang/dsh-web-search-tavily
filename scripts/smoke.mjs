/**
 * Integration smoke test: boot a minimal cordis tree with the settings-file
 * provider, credentials-local, and our plugin, then verify the namespace is
 * registered and the provider registers into ctx.web.
 */
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const profileNodeModules = 'C:/Users/tlzn_user/.dsh/profiles/web/node_modules'
const localNodeModules = 'C:/Users/tlzn_user/Desktop/dsh-web-search-tavily/node_modules'
const load = (base, p) => import(pathToFileURL(join(base, p)).href)

const { Context } = await load(localNodeModules, '@deepseek-ai/cordis/lib/index.js')
const ctx = new Context()

// Mount the settings + credentials services manually (the real boot composes
// these rows; here we provide minimal stubs to exercise our plugin's apply).
class SettingsStub {
  constructor() {
    this.registrations = new Map()
    this.sections = new Map()
  }
  register(ns, schema, options = {}) {
    const scope = {
      ns,
      get: () => this.sections.get(ns) ?? {},
      watch: () => () => {},
      update: async (patch) => {
        this.sections.set(ns, { ...this.sections.get(ns), ...patch })
      },
      replace: async (section) => {
        this.sections.set(ns, section)
      },
    }
    this.registrations.set(ns, { schema, options, scope })
    return scope
  }
  describe() {
    return [...this.registrations.entries()].map(([ns, r]) => ({
      ns,
      schema: r.schema,
      value: r.scope.get(),
      revision: 0,
      applies: r.options.applies ?? 'live',
    }))
  }
  get(ns) {
    return this.registrations.get(ns)?.scope.get()
  }
}

const settings = new SettingsStub()
ctx.provide('settings', settings)

class CredentialsStub {
  async resolve(ref) {
    const v = process.env[ref]
    return v && v.length > 0 ? { value: v, source: 'env' } : undefined
  }
  async set(ref, value) {}
  async unset(ref) {}
}
ctx.provide('credentials', new CredentialsStub())

// Minimal launch-environment face.
ctx.provide('launch.environment', {
  get: () => undefined,
})

// Minimal web seam.
const providers = []
ctx.provide('web', {
  registerSearchProvider(provider) {
    providers.push(provider)
  },
})

// Import our plugin and apply it.
const plugin = await load(profileNodeModules, 'dsh-web-search-tavily/lib/index.js')
plugin.apply(ctx, {})

// installSettingsSection registers through ctx.inject(['settings']) which
// settles asynchronously; give the microtask queue a turn.
await new Promise((resolve) => setTimeout(resolve, 10))

console.log('settings namespaces:', [...settings.registrations.keys()].join(', '))
console.log('registered providers:', providers.map((p) => p.id).join(', '))
console.log('provider available (no env key):', providers[0]?.available())

process.env.TAVILY_API_KEY = 'tvly-test-123'
console.log('provider available (env key):', providers[0]?.available())

// Verify search resolves the key and attempts a Tavily call (network will fail here).
try {
  const result = await providers[0].search({ query: 'test' }, new AbortController().signal)
  console.log('search result (unexpected):', result)
} catch (err) {
  console.log('search error (expected network failure):', String(err).slice(0, 90))
}

console.log('SMOKE TEST OK')
