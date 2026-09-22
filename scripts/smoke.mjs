/**
 * Integration smoke test for dsh-tavily-web-search on DSH 0.1.7.
 *
 * Boots a real cordis tree with the real `dsh-web` seam and the real
 * `dsh-host-webserver`, mounts this plugin through cordis so its `Config`
 * schema (and its `.volatile()` accessors) are resolved exactly as the Loader
 * resolves them, then exercises provider selection, the search round-robin,
 * result mapping, the timeout path, and the `/api/tavily/usage` route.
 *
 * Network access is mocked: nothing here leaves the machine.
 */
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The real transport, kept before the network mock replaces it. */
const realFetch = globalThis.fetch

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const nm = join(root, 'node_modules')
const load = (p) => import(pathToFileURL(join(nm, p)).href)

const { Context } = await load('@deepseek-ai/cordis/lib/index.js')
const { default: WebRuntime } = await load('@deepseek-ai/dsh-web/lib/index.js')
const { default: WebServer } = await load('@deepseek-ai/dsh-host-webserver/lib/index.js')
const plugin = await import(pathToFileURL(join(root, 'lib/index.js')).href)

let failures = 0
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  if (!ok) failures += 1
}

// ── 1. the Config schema is a valid, fully volatile settings form ───────────
const Config = plugin.Config
const json = Config.toJSON()
check('Config serializes to JSON (settings domain reads schema.toJSON())', typeof json === 'object' && json !== null)
check('keys is volatile (so the settings domain renders it as an editable field)', Config.dict.keys.meta.volatile === true)
for (const field of ['endpoint', 'searchDepth', 'maxResults', 'timeoutMs']) {
  check(`${field} is volatile`, Config.dict[field].meta.volatile === true)
}
// A volatile schema resolves each field to a live accessor, exactly as the
// Loader hands `config` to `apply`.
const defaults = Config({})
check('schema defaults resolve through the volatile accessors',
  defaults.keys.get().length === 0 &&
  defaults.endpoint.get() === 'https://api.tavily.com/search' &&
  defaults.searchDepth.get() === 'advanced' &&
  defaults.maxResults.get() === 8 &&
  defaults.timeoutMs.get() === 30000,
  JSON.stringify({ keys: defaults.keys.get(), endpoint: defaults.endpoint.get(), searchDepth: defaults.searchDepth.get(), maxResults: defaults.maxResults.get(), timeoutMs: defaults.timeoutMs.get() }))

// ── 2. mount the real services and the plugin ──────────────────────────────
const KEY_A = 'TAVILY_API_KEY_A'
const KEY_B = 'TAVILY_API_KEY_B'
const KEY_OFF = 'TAVILY_API_KEY_OFF'

const searchCalls = []
const usageCalls = []

/** Mock fetch: the Tavily search endpoint, the usage endpoint, or an abort. */
function installFetch(mode) {
  globalThis.fetch = (url, init = {}) => {
    const target = String(url)
    if (target.includes('/usage')) {
      usageCalls.push({ target, auth: init.headers?.Authorization })
      return Promise.resolve(new Response(JSON.stringify({ usage: 12, limit: 1000, account: { current_plan: 'dev' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }))
    }
    searchCalls.push({ target, auth: init.headers?.Authorization, body: JSON.parse(init.body) })
    if (mode === 'hang') {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => { reject(init.signal.reason) })
      })
    }
    if (mode === 'http-500') {
      return Promise.resolve(new Response(JSON.stringify({ detail: { error: 'quota exhausted' } }), {
        status: 500, headers: { 'content-type': 'application/json' },
      }))
    }
    return Promise.resolve(new Response(JSON.stringify({
      results: [
        { url: 'https://a.example/1', title: 'A', content: 'snippet A', published_date: '2026-01-02' },
        { url: 'https://a.example/1', title: 'duplicate' },
        { url: 'https://b.example/2' },
        { url: '', title: 'no url' },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
  }
}

async function boot(overrides = {}, mode = 'ok') {
  installFetch(mode)
  searchCalls.length = 0
  usageCalls.length = 0
  const ctx = new Context()
  const policy = []
  ctx.provide('settings', { configure: (presentation) => { policy.push(presentation); return () => {} } })
  const resolved = { [KEY_A]: 'tvly-key-a', [KEY_B]: 'tvly-key-b' }
  ctx.provide('credentials', {
    async resolve(ref) {
      const value = resolved[ref]
      return value === undefined ? undefined : { value, source: 'test' }
    },
  })
  await ctx.plugin(WebRuntime, { searchProvider: 'tavily' })
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  const keys = overrides.keys ?? [
    { id: 'a', name: 'A', ref: KEY_A, enabled: true },
    { id: 'b', name: 'B', ref: KEY_B, enabled: true },
    { id: 'off', name: 'Off', ref: KEY_OFF, enabled: false },
  ]
  await ctx.plugin(
    { name: plugin.name, inject: plugin.inject, Config: plugin.Config, apply: plugin.apply },
    { keys, ...overrides.config },
  )
  await new Promise((resolve) => setTimeout(resolve, 50))
  return { ctx, policy }
}

// ── 3. provider registration, selection, mapping ───────────────────────────
const { ctx, policy } = await boot()
check('plugin declares the settings page policy (auto page off)', policy.length === 1 && policy[0].auto === false)
check('usage route registered', ctx.webServer.exact.has(plugin.TAVILY_USAGE_PATH) || ctx.webServer.exact.has('/api/tavily/usage'))

const result = await ctx.web.search({ query: 'hello', maxResults: 5 })
check('search reached the Tavily endpoint', searchCalls.length === 1 && searchCalls[0].target === 'https://api.tavily.com/search')
check('first key rotates in', searchCalls[0].auth === `Bearer tvly-key-a`, searchCalls[0].auth)
check('request body carries query/depth/max_results', searchCalls[0].body.query === 'hello' && searchCalls[0].body.search_depth === 'advanced' && searchCalls[0].body.max_results === 8, JSON.stringify(searchCalls[0].body))
check('duplicate and empty urls dropped, fields mapped', result.sources.length === 2 && result.sources[0].title === 'A' && result.sources[0].snippet === 'snippet A' && result.sources[0].publishedAt === '2026-01-02' && result.sources[1].url === 'https://b.example/2', JSON.stringify(result.sources))

await ctx.web.search({ query: 'again' })
check('second search rotates to the next key', searchCalls[1].auth === `Bearer tvly-key-b`, searchCalls[1].auth)
await ctx.web.search({ query: 'third' })
check('rotation wraps around', searchCalls[2].auth === `Bearer tvly-key-a`, searchCalls[2].auth)

// ── 4. usage route ─────────────────────────────────────────────────────────
const baseUrl = `http://127.0.0.1:${ctx.webServer.port}`
const known = await realFetch(`${baseUrl}/api/tavily/usage?ref=${KEY_A}`)
const knownBody = await known.json()
check('usage route proxies a registered ref', known.status === 200 && knownBody.ok === true && knownBody.usage.usage === 12, JSON.stringify(knownBody))
const disabled = await realFetch(`${baseUrl}/api/tavily/usage?ref=${KEY_OFF}`)
const disabledBody = await disabled.json()
check('usage route rejects an unconfigured registered ref with a Chinese message', disabled.status === 400 && disabledBody.message === '此 Tavily Key 尚未配置', JSON.stringify(disabledBody))
const unknown = await realFetch(`${baseUrl}/api/tavily/usage?ref=SOME_OTHER_KEY`)
const unknownBody = await unknown.json()
check('usage route rejects an unknown ref', unknown.status === 400 && unknownBody.message === '未知的 Tavily 凭据引用', JSON.stringify(unknownBody))

// ── 5. HTTP failure and timeout paths ──────────────────────────────────────
const failing = await boot({}, 'http-500')
try {
  await failing.ctx.web.search({ query: 'x' })
  check('upstream HTTP error surfaces', false)
} catch (error) {
  check('upstream HTTP error surfaces with the provider detail', String(error.message).includes('quota exhausted'), String(error.message).slice(0, 80))
}

const slow = await boot({ config: { timeoutMs: 60 } }, 'hang')
try {
  await slow.ctx.web.search({ query: 'x' })
  check('configured timeout aborts a hung search', false)
} catch (error) {
  check('configured timeout aborts a hung search', String(error.message).includes('超时'), String(error.message).slice(0, 80))
}

// ── 6. no usable key ───────────────────────────────────────────────────────
const empty = await boot({ keys: [] })
try {
  await empty.ctx.web.search({ query: 'x' })
  check('empty key pool reports a Chinese configuration error', false)
} catch (error) {
  check('empty key pool reports a Chinese configuration error', String(error.message).includes('没有已启用且已配置的 API Key'), String(error.message).slice(0, 80))
}

await Promise.all([ctx, failing.ctx, slow.ctx, empty.ctx].map((c) => c.stop?.().catch(() => {})))

console.log(`\n${failures === 0 ? 'SMOKE TEST OK' : `SMOKE TEST FAILED (${String(failures)})`}`)
process.exit(failures === 0 ? 0 : 1)
