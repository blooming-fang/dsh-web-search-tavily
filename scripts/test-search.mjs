/**
 * Real-environment search check: resolve a Tavily credential through the real
 * `dsh-credentials-local` service and run one real search plus one real usage
 * query through this plugin's provider.
 *
 * Usage: node ./scripts/test-search.mjs [ref]
 *   ref defaults to TAVILY_API_KEY.
 */
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const pluginRoot = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const nm = join(pluginRoot, 'node_modules')
const dshInstall = 'E:/soft/nvm/v24.11.0/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
const load = (base, p) => import(pathToFileURL(join(base, p)).href)

const ref = process.argv[2] ?? 'TAVILY_API_KEY'
const plugin = await import(pathToFileURL(join(pluginRoot, 'lib/index.js')).href)
const { Context } = await load(nm, '@deepseek-ai/cordis/lib/index.js')
const { default: CredentialsLocal } = await load(dshInstall, 'dsh-credentials-local/lib/index.js')

const ctx = new Context()
await ctx.plugin(CredentialsLocal, { dshHome: process.env.DSH_HOME })
const resolved = await ctx.credentials.resolve(ref)
if (resolved === undefined) {
  console.log(`FAIL ${ref} is not configured`)
  process.exit(1)
}
console.log(`ok   resolved ${ref} (source=${resolved.source}, length=${String(resolved.value.length)})`)

const provider = new plugin.TavilySearchProvider(() => ({
  resolveApiKey: async () => (await ctx.credentials.resolve(ref))?.value,
  endpoint: 'https://api.tavily.com/search',
  searchDepth: 'basic',
  maxResults: 3,
  timeoutMs: 30000,
}))
console.log('ok   provider available:', provider.available())

let failures = 0
try {
  const result = await provider.search({ query: 'DeepSeek Harness 最新版本' }, new AbortController().signal)
  console.log(`ok   search returned ${String(result.sources.length)} sources`)
  for (const source of result.sources.slice(0, 3)) console.log(`       - ${source.title ?? '(no title)'} ${source.url}`)
  if (result.sources.length === 0) failures += 1
} catch (error) {
  console.log('FAIL search:', String(error).slice(0, 300))
  failures += 1
}

try {
  const response = await fetch('https://api.tavily.com/usage', {
    headers: { Accept: 'application/json', Authorization: `Bearer ${resolved.value}` },
  })
  const body = await response.json()
  console.log(`ok   usage HTTP ${String(response.status)} plan=${String(body?.account?.current_plan ?? '?')} usage=${String(body?.account?.plan_usage ?? body?.key?.usage ?? '?')}`)
  if (!response.ok) failures += 1
} catch (error) {
  console.log('FAIL usage:', String(error).slice(0, 300))
  failures += 1
}

await ctx.stop?.().catch(() => {})
console.log(failures === 0 ? '\nREAL ENV OK' : `\nREAL ENV FAILED (${String(failures)})`)
process.exit(failures === 0 ? 0 : 1)
