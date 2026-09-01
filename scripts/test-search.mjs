/**
 * 真实搜索测试：加载已安装到 profile 的插件，通过真实凭据服务解析
 * TAVILY_API_KEY，然后调用 Tavily 搜索接口做一次真实搜索。
 */
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const profileNodeModules = 'C:/Users/tlzn_user/.dsh/profiles/web/node_modules'
const dshInstall = 'E:/soft/nvm/v24.11.0/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
const load = (base, p) => import(pathToFileURL(join(base, p)).href)

// 1. 加载真实插件（已安装版本）
const plugin = await load(profileNodeModules, 'dsh-tavily-web-search/lib/index.js')
console.log('✅ 插件导出:', Object.keys(plugin).join(', '))

// 2. 加载真实凭据服务
const { default: CredentialsLocal } = await load(dshInstall, 'dsh-credentials-local/lib/index.js')
const { Context } = await load(dshInstall, 'cordis/lib/index.js')
const ctx = new Context()

// 实例化凭据服务（真实读取 $DSH_HOME/.credentials.yaml）
const credentials = new CredentialsLocal(ctx, {})
console.log('✅ 凭据服务已挂载')

// 3. 通过凭据服务解析 TAVILY_API_KEY
const resolved = await credentials.resolve('TAVILY_API_KEY')
if (!resolved) {
  console.log('❌ TAVILY_API_KEY 未配置')
  process.exit(1)
}
console.log(`✅ TAVILY_API_KEY 已解析 (source=${resolved.source}, value=${resolved.value.slice(0, 12)}...)`)

// 4. 用插件的 TavilySearchProvider 做真实搜索
const provider = new plugin.TavilySearchProvider(() => ({
  resolveApiKey: async () => (await credentials.resolve('TAVILY_API_KEY'))?.value,
  apiKeyEnv: 'TAVILY_API_KEY',
  endpoint: 'https://api.tavily.com/search',
  searchDepth: 'basic',
  maxResults: 3,
  timeoutMs: 30000,
}))

console.log('\n=== 调用 provider.search() ===')
const controller = new AbortController()
try {
  const result = await provider.search({ query: 'DeepSeek V4 发布 最新消息' }, controller.signal)
  console.log('✅ 搜索成功!')
  console.log('结果数:', result.sources.length)
  for (const s of result.sources.slice(0, 5)) {
    console.log(`  - [${s.title?.slice(0, 50) ?? '无标题'}]`)
    console.log(`    ${s.url}`)
    if (s.snippet) console.log(`    ${s.snippet.slice(0, 90)}...`)
  }
} catch (err) {
  console.log('❌ 搜索失败:', String(err).slice(0, 300))
  process.exit(1)
}
