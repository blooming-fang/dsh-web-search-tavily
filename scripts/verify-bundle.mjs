/**
 * Static check of the built browser bundle: the module-table handoff, the
 * required modules against the 0.1.7 platform seed, and the absence of the
 * pre-0.1.7 client APIs.
 */
import { readFileSync } from 'node:fs'

const PLUGIN_ID = 'dsh-tavily-web-search'
/** The platform seed the web shell constructs before cordis exists. */
const PLATFORM_SEED = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
let failures = 0
const check = (label, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  if (!ok) failures += 1
}

// Parse only: the bundle is CJS wrapped in the loader handoff.
new Function(code)
check('bundle parses', true)
check('carries the module-loader handoff', code.includes('window.__ModuleLoader__.load({'))
check('registers under the package id', code.includes(`id: "${PLUGIN_ID}"`))

const required = [...new Set([...code.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]))]
const unseeded = required.filter((specifier) => !PLATFORM_SEED.has(specifier))
check('every required module is in the platform seed', unseeded.length === 0, required.join(', '))

check('contributes the settings section', code.includes('settings.section'))
check('binds the shared configuration form of its entry', code.includes('configForms') && code.includes('web-search-tavily'))
check('keeps the multi-key pool and usage query', code.includes('addKey') && code.includes('refreshAllUsage') && code.includes('/api/tavily/usage'))

// Pre-0.1.7 client APIs must be gone: `settingsScope`, `connection`,
// `dsh-client-runtime`, and the host-side `installSection` namespace model.
for (const stale of ['settingsScope', 'installSettingsSection', 'installSection', 'dsh-client-runtime', 'dsh-client-connection']) {
  check(`no pre-0.1.7 API remains: ${stale}`, !code.includes(stale))
}

console.log(failures === 0 ? '\nBUNDLE VERIFY OK' : `\nBUNDLE VERIFY FAILED (${String(failures)})`)
process.exit(failures === 0 ? 0 : 1)
