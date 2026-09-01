/**
 * Verify the plugin's node half registers the /api/tavily/usage route on a
 * real cordis + dsh-host-webserver tree. Boots a minimal tree, applies the
 * plugin, and checks webServer's exact route table for TAVILY_USAGE_PATH.
 */
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const dshDeps = 'E:/soft/nvm/v24.11.0/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
const profileNM = 'C:/Users/tlzn_user/.dsh/profiles/web/node_modules'
const load = (base, p) => import(pathToFileURL(join(base, p)).href)

const { Context } = await load(dshDeps, 'cordis/lib/index.js')
const { default: WebServer } = await load(dshDeps, 'dsh-host-webserver/lib/index.js')

const ctx = new Context()

// Minimal settings + credentials + launch.environment + web seams.
const sectionState = { keys: [] }
ctx.provide('settings', {
  register() { return { get: () => sectionState, watch: () => () => {}, update: async () => {}, replace: async () => {} } },
  describe() { return [] },
})
ctx.provide('credentials', {
  async resolve(ref) { const v = process.env[ref]; return v && v.length ? { value: v, source: 'env' } : undefined },
  async set() {}, async unset() {},
})
ctx.provide('launch.environment', { get: () => undefined })
const providers = []
ctx.provide('web', { registerSearchProvider(p) { providers.push(p) } })

// Real WebServer service on an ephemeral port.
await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
const ws = ctx.webServer
await new Promise((r) => setTimeout(r, 50))

// Apply the plugin with the real key pool so the usage route exercises the
// same ref-allowlist the running deployment sees (including disabled keys).
const plugin = await load(profileNM, 'dsh-tavily-web-search/lib/index.js')
const keys = [
  { id: 'mth3iduzu7kb77', name: '我的', ref: 'TAVILY_API_KEY_MTH3IDUZU7KB77', enabled: false },
  { id: 'mth3k8gv5ktcne', name: '志明', ref: 'TAVILY_API_KEY_MTH3K8GV5KTCNE', enabled: true },
  { id: 'mth3kd4zxmb1h6', name: '秋', ref: 'TAVILY_API_KEY_MTH3KD4ZXMB1H6', enabled: false },
]
sectionState.keys = keys
plugin.apply(ctx, { keys })
await new Promise((r) => setTimeout(r, 100))

console.log('registered providers:', providers.map((p) => p.id).join(', '))
console.log('exact routes:', [...ws.exact.keys()].join(', '))
console.log('usage route registered:', ws.exact.has('/api/tavily/usage'))

// Probe it over HTTP for each registered ref (enabled and disabled alike).
for (const ref of ['TEST', ...keys.map((k) => k.ref)]) {
  const r = await fetch(`http://127.0.0.1:${ws.port}/api/tavily/usage?ref=${encodeURIComponent(ref)}`)
  const body = await r.text()
  console.log(`probe ref=${ref} status=${r.status} body=${body.slice(0, 120)}`)
}

await ctx.stop?.()
process.exit(0)
