/**
 * 真实用量接口测试：读取 $DSH_HOME/settings.yaml 的 web-search-tavily 命名空间
 * 和 $DSH_HOME/.credentials.yaml，对每个已登记 Key 的 ref 调用 Tavily 官方
 * GET /usage 端点，报告哪些能通过插件校验、哪些报 "Unknown Tavily credential reference"。
 *
 * 用法: node ./scripts/test-usage.mjs [ref ...]
 *   不带参数: 测试 settings.yaml 里登记的所有 ref
 *   带参数  : 只测试给定 ref（例如 TAVILY_API_KEY_MTH3K8GV5KTCNE）
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'

const dshHome = process.env.DSH_HOME ?? join(process.env.USERPROFILE, '.dsh')
const settingsPath = join(dshHome, 'settings.yaml')
const credsPath = join(dshHome, '.credentials.yaml')

const settings = parse(readFileSync(settingsPath, 'utf8'))
const creds = parse(readFileSync(credsPath, 'utf8'))

const section = settings['web-search-tavily'] ?? {}
const rows = Array.isArray(section.keys) ? section.keys : []
const refsByRef = new Map((creds.refs ?? {}) && Object.entries(creds.refs ?? {}))

const targets = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : rows.map((r) => r.ref)

/** 与 lib/index.js handleUsage 一致的校验。 */
function configuredRefs() {
  const out = []
  const seen = new Set()
  for (const row of rows) {
    const ref = row?.ref?.trim()
    if (row?.enabled === false || !ref || seen.has(ref)) continue
    seen.add(ref)
    out.push(ref)
  }
  return out
}

const allowed = configuredRefs()
console.log(`settings.yaml: ${settingsPath}`)
console.log(`凭据文件: ${credsPath}`)
console.log('登记 Keys:')
for (const row of rows) {
  const hasCred = refsByRef.has(row.ref)
  const enabled = row.enabled !== false
  const allowedBy = allowed.includes(row.ref)
  console.log(`  - ${row.name.padEnd(6)} ${row.ref.padEnd(32)} enabled=${enabled} 凭据=${hasCred ? '有' : '无'} 插件校验=${allowedBy ? '通过' : '拒绝'}`)
}
console.log('')

for (const ref of targets) {
  const row = rows.find((r) => r.ref === ref)
  const label = row ? row.name : ref
  console.log(`=== ${label} (${ref}) ===`)
  if (!allowed.includes(ref)) {
    console.log('  ❌ 插件校验拒绝 → Unknown Tavily credential reference')
    continue
  }
  const key = refsByRef.get(ref)
  if (!key) {
    console.log('  ❌ 凭据文件中没有此 ref')
    continue
  }
  console.log(`  凭据解析: ${key.slice(0, 12)}...`)
  try {
    const r = await fetch('https://api.tavily.com/usage', {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${key}` },
    })
    const text = await r.text()
    console.log(`  HTTP ${r.status}`)
    if (r.ok) {
      try {
        const j = JSON.parse(text)
        console.log(`  ✅ usage=${j.usage ?? '?'} limit=${j.limit ?? '?'} search_usage=${j.search_usage ?? '?'} plan=${j.current_plan ?? '?'}`)
        console.log('  原始:', text.slice(0, 400))
      } catch {
        console.log('  (非 JSON) ' + text.slice(0, 200))
      }
    } else {
      console.log('  ❌ ' + text.slice(0, 200))
    }
  } catch (e) {
    console.log('  ❌ 网络错误: ' + String(e))
  }
  console.log('')
}
