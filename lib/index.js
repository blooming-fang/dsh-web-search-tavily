/**
 * Tavily-backed WebSearchProvider for the DeepSeek Harness web capability seam.
 *
 * The plugin registers one provider under the id `tavily` and owns no settings
 * namespace of its own: since DSH 0.1.7 a plugin's `Config` schema IS its
 * configuration surface, discovered by the Loader from this module and served to
 * the browser through the settings domain. Every field is declared `.volatile()`
 * so the running plugin reads the live value on each operation instead of
 * pinning the composition-time snapshot.
 *
 * API keys never enter the configuration document: the `keys` section carries
 * only public key metadata (id, display name, credential reference and enabled
 * state) while the secret values live in the credentials provider, addressed by
 * `ref`.
 */
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { WebError } from '@deepseek-ai/dsh-web'

export const TAVILY_PROVIDER_ID = 'tavily'
export const WEB_SEARCH_TAVILY_SETTINGS_NAMESPACE = 'web-search-tavily'
export const TAVILY_USAGE_PATH = '/api/tavily/usage'
const TAVILY_ENDPOINT = 'https://api.tavily.com/search'
const TAVILY_USAGE_ENDPOINT = 'https://api.tavily.com/usage'
const DEFAULT_MAX_RESULTS = 8
const REQUEST_TIMEOUT_MS = 30000

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function providerError(message, options) {
  return new WebError(message, 'WEB_PROVIDER_ERROR', options)
}

function isAbortError(error) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function mapTavilyResponse(body) {
  const raw = Array.isArray(body?.results) ? body.results : []
  const sources = []
  const seen = new Set()
  for (const item of raw) {
    const url = typeof item?.url === 'string' ? item.url : ''
    if (url.length === 0 || seen.has(url)) continue
    seen.add(url)
    const source = { url }
    if (isNonEmptyString(item.title)) source.title = item.title
    if (isNonEmptyString(item.content)) source.snippet = item.content
    if (isNonEmptyString(item.published_date)) source.publishedAt = item.published_date
    sources.push(source)
  }
  return { sources, truncated: false }
}

/**
 * Combine the caller's cancellation with the configured per-request timeout.
 * @param signal - the surrounding search's signal, when the seam supplied one.
 * @param timeoutMs - the configured timeout; a non-positive value disables it.
 * @returns the signal to hand `fetch`, plus the timeout signal to classify failures with.
 */
function searchSignal(signal, timeoutMs) {
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined
  if (timeout === undefined) return { signal, timeout }
  if (signal === undefined) return { signal: timeout, timeout }
  return { signal: AbortSignal.any([signal, timeout]), timeout }
}

/** Search provider whose resolver rotates over configured keys. */
export class TavilySearchProvider {
  constructor(resolveOptions) {
    this.id = TAVILY_PROVIDER_ID
    this.resolveOptions = resolveOptions
  }

  /** Cheap local usability check: a configured endpoint the fetch layer can parse. */
  available() {
    const options = this.resolveOptions()
    return isNonEmptyString(options.endpoint) && URL.canParse(options.endpoint)
  }

  async search(request, signal) {
    const options = this.resolveOptions()
    const key = await this.apiKey(options, signal)
    if (signal?.aborted === true) throw providerError('Tavily 搜索已中止', { cause: signal.reason })
    const { signal: combined, timeout } = searchSignal(signal, options.timeoutMs)
    let response
    try {
      response = await fetch(options.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          query: request.query,
          search_depth: options.searchDepth,
          max_results: options.maxResults,
        }),
        ...(combined === undefined ? {} : { signal: combined }),
      })
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) {
        throw providerError('Tavily 搜索已中止', { cause: error })
      }
      if (timeout?.aborted === true) {
        throw providerError(`Tavily 搜索超时（${String(options.timeoutMs)} 毫秒）`, { cause: error })
      }
      throw providerError(`Tavily 搜索请求失败：${String(error)}`, { cause: error })
    }
    if (!response.ok) {
      let message = `Tavily API 错误（HTTP ${response.status}）`
      try {
        const parsed = await response.json()
        const detail = typeof parsed?.error === 'string' ? parsed.error : parsed?.message ?? parsed?.detail?.error
        if (isNonEmptyString(detail)) message = detail
      } catch {}
      throw providerError(message)
    }
    try {
      return mapTavilyResponse(await response.json())
    } catch (error) {
      throw providerError(`Tavily 返回了无法解析的响应内容：${String(error)}`, { cause: error })
    }
  }

  async apiKey(options, signal) {
    if (signal?.aborted === true) throw providerError('Tavily 搜索已中止', { cause: signal.reason })
    if (isNonEmptyString(options.apiKey)) return options.apiKey
    let resolved
    try {
      resolved = await options.resolveApiKey?.()
    } catch (error) {
      throw providerError(`Tavily 搜索凭据解析失败：${String(error)}`, { cause: error })
    }
    if (isNonEmptyString(resolved)) return resolved
    throw providerError('Tavily 搜索没有已启用且已配置的 API Key；请在“设置 → Tavily 搜索”中添加一个')
  }
}

export const name = 'web-search-tavily'
export const inject = ['web', 'webServer', 'credentials', 'settings']

const KeyConfig = z.object({
  id: z.string(),
  name: z.string(),
  ref: z.string().role('credential-ref'),
  enabled: z.boolean().default(true),
})

/**
 * The plugin's live configuration. Every field is volatile: the settings domain
 * renders exactly the volatile fields of a plugin's Config as its editable form,
 * and a volatile read is what lets a saved edit reach the next search without a
 * plugin remount. Secrets remain references; only public key metadata enters the
 * configuration document.
 */
export const Config = z.object({
  keys: z.array(KeyConfig).default([]).volatile(),
  endpoint: z.string().default(TAVILY_ENDPOINT).volatile(),
  searchDepth: z.string().default('advanced').volatile(),
  maxResults: z.number().step(1).min(1).default(DEFAULT_MAX_RESULTS).volatile(),
  timeoutMs: z.number().step(1).min(1).default(REQUEST_TIMEOUT_MS).volatile(),
})

function configuredRefs(config) {
  const rows = Array.isArray(config.keys) ? config.keys : []
  const refs = []
  const seen = new Set()
  for (const row of rows) {
    if (row?.enabled === false || !isNonEmptyString(row?.ref)) continue
    const ref = credentialRef(row.ref.trim())
    if (seen.has(ref)) continue
    seen.add(ref)
    refs.push(ref)
  }
  return refs
}

/**
 * Every registered key reference, whether enabled or not. Used only by the
 * usage route so a disabled key (which is skipped by search rotation) can
 * still be inspected for its live usage.
 */
function allRefs(config) {
  const rows = Array.isArray(config.keys) ? config.keys : []
  const refs = []
  const seen = new Set()
  for (const row of rows) {
    if (!isNonEmptyString(row?.ref)) continue
    const ref = credentialRef(row.ref.trim())
    if (seen.has(ref)) continue
    seen.add(ref)
    refs.push(ref)
  }
  return refs
}

function makeOptionsResolver(ctx, current) {
  let cursor = 0
  return () => {
    const config = current()
    return {
      resolveApiKey: async () => {
        const credentials = ctx.get('credentials')
        const refs = configuredRefs(config)
        for (let offset = 0; offset < refs.length; offset += 1) {
          const index = (cursor + offset) % refs.length
          const ref = refs[index]
          const resolved = credentials !== undefined
            ? (await credentials.resolve(ref))?.value
            : undefined
          if (isNonEmptyString(resolved)) {
            cursor = (index + 1) % refs.length
            return resolved
          }
        }
        return undefined
      },
      endpoint: config.endpoint ?? TAVILY_ENDPOINT,
      searchDepth: config.searchDepth ?? 'advanced',
      maxResults: config.maxResults ?? DEFAULT_MAX_RESULTS,
      timeoutMs: config.timeoutMs ?? REQUEST_TIMEOUT_MS,
    }
  }
}

function writeJson(res, status, value) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(value))
}

/** Resolve a known reference server-side and proxy Tavily's value-free usage response. */
async function handleUsage(req, res, ctx, current) {
  if (req.method !== 'GET') {
    res.writeHead(405, { allow: 'GET' })
    res.end()
    return
  }
  try {
    const url = new URL(req.url ?? TAVILY_USAGE_PATH, 'http://localhost')
    const ref = credentialRef(url.searchParams.get('ref') ?? '')
    const allowed = new Set(allRefs(current()))
    if (!allowed.has(ref)) throw new Error('未知的 Tavily 凭据引用')
    const key = (await ctx.credentials.resolve(ref))?.value
    if (!isNonEmptyString(key)) throw new Error('此 Tavily Key 尚未配置')
    const upstream = await fetch(TAVILY_USAGE_ENDPOINT, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${key}` },
    })
    const text = await upstream.text()
    let value
    try { value = text.length === 0 ? {} : JSON.parse(text) } catch { value = { message: text.slice(0, 300) } }
    if (!upstream.ok) {
      writeJson(res, upstream.status, { ok: false, message: value?.detail?.error ?? value?.message ?? `Tavily 用量查询返回 HTTP ${upstream.status}` })
      return
    }
    writeJson(res, 200, { ok: true, usage: value })
  } catch (error) {
    writeJson(res, 400, { ok: false, message: error instanceof Error ? error.message : String(error) })
  }
}

/** Read the live section this plugin serves its next operation from. */
function currentSection(config) {
  return {
    keys: config.keys.get(),
    endpoint: config.endpoint.get(),
    searchDepth: config.searchDepth.get(),
    maxResults: config.maxResults.get(),
    timeoutMs: config.timeoutMs.get(),
  }
}

export function apply(ctx, config) {
  const current = () => currentSection(config)
  // This plugin owns its settings page, so the settings domain must not also
  // generate the generic page for the entry's volatile fields.
  ctx.effect(
    () => ctx.settings.configure({ auto: false }, ctx.fiber),
    'web-search-tavily: settings page policy',
  )
  ctx.web.registerSearchProvider(new TavilySearchProvider(makeOptionsResolver(ctx, current)))
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: TAVILY_USAGE_PATH,
    handler: (req, res) => handleUsage(req, res, ctx, current),
  }), 'web-search-tavily: usage route')
}
