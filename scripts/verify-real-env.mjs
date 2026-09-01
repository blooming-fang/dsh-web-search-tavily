/**
 * 真实环境验证：用 dsh-settings-file + dsh-credentials-local + 真实插件 0.5.0，
 * 读取真实的 $DSH_HOME/settings.yaml 与 .credentials.yaml，对 usage 路由做端到端探测。
 * 重点是确认 enabled:false 的 Key 不再报 "Unknown Tavily credential reference"。
 */
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const dshInstall = 'E:/soft/nvm/v24.11.0/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
const profileNM = 'C:/Users/tlzn_user/.dsh/profiles/web/node_modules'
const load = (base, p) => import(pathToFileURL(join(base, p)).href)

const { Context } = await load(dshInstall, 'cordis/lib/index.js')
const { default: SettingsFile } = await load(dshInstall, 'dsh-settings-file/lib/index.js')
const { default: CredentialsLocal } = await load(dshInstall, 'dsh-credentials-local/lib/index.js')
const { default: WebServer } = await load(dshInstall, 'dsh-host-webserver/lib/index.js')

const ctx = new Context()

// Real settings-file + credentials-local, both reading real $DSH_HOME docs.
await ctx.plugin(SettingsFile, { dshHome: process.env.DSH_HOME })
await ctx.plugin(CredentialsLocal, { dshHome: process.env.DSH_HOME })
ctx.provide('launch.environment', { get: () => undefined })
const providers = []
ctx.provide('web', { registerSearchProvider(p) { providers.push(p) } })
await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
const ws = ctx.webServer
await new Promise((r) => setTimeout(r, 50))

const plugin = await load(profileNM, 'dsh-web-search-tavily/lib/index.js')
plugin.apply(ctx, {})
await new Promise((r) => setTimeout(r, 300))

console.log('registered providers:', providers.map((p) => p.id).join(', '))
console.log('usage route:', ws.exact.has('/api/tavily/usage'))

// Probe the usage route for each registered key ref from the real settings.
const settings = await ctx.settings.get('web-search-tavily')
const keys = Array.isArray(settings?.keys) ? settings.keys : []
console.log('\nsettings.web-search-tavily.keys:', JSON.stringify(keys.map(k => ({ name: k.name, ref: k.ref, enabled: k.enabled }))))
for (const k of keys) {
  const r = await fetch(`http://127.0.0.1:${ws.port}/api/tavily/usage?ref=${encodeURIComponent(k.ref)}`)
  const text = await r.text()
  let usage
  try { usage = JSON.parse(text).usage?.key?.usage } catch { usage = null }
  console.log(`ref=${k.ref} name=${k.name} enabled=${k.enabled} status=${r.status} usage=${usage} body=${text.slice(0, 90)}`)
}

await ctx.stop?.().catch(() => {})
process.exit(0)
