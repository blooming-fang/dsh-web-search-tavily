import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve as resolvePath } from 'node:path'
import type { UserConfig } from 'tsdown'
import { defineConfig } from 'tsdown'
import { transform } from 'lightningcss'

/**
 * dsh-tavily-web-search build: a node ESM plugin entry (`lib/index.js`, which
 * is hand-maintained and type-checked separately) plus a browser CJS bundle
 * (`lib/client.js`) wrapped in the `window.__ModuleLoader__.load({ id,
 * factory })` handoff the web shell's module table expects. Browser-side
 * dependencies that the module table seeds or that live in the installed dsh
 * closure stay external; everything else is inlined.
 *
 * CSS Modules are compiled by lightningcss inside the bundle: importing
 * `x.module.css` yields the hashed class map, and the css text auto-injects a
 * `<style data-plugin-css>` tag at factory execution (the loader removes
 * plugin-owned tags on unload). A virtual-id wrapper keeps module CSS away
 * from tsdown's own css pipeline (which would require @tsdown/css); the
 * suffix must not end in `.css` or tsdown's guard intercepts it.
 */

/** The id stamped into the ModuleLoader handoff and onto injected style tags. */
const PLUGIN_ID = 'dsh-tavily-web-search'

const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/**
 * Externals resolved from the loader module table: the platform seed modules
 * (react family, cordis, the dsh client primitives/slots) plus the runtime
 * store exemption. `clsx` is NOT a platform module and must be inlined — the
 * table cannot answer it, so leaving it external throws at factory execution
 * ("require("clsx") missed the module table").
 */
const clientExternals = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-slots',
]

/** CSS Module inlining: compile to hashed classes + injected <style> tag. */
const cssModulesInline: UserConfig['plugins'] = [{
  name: 'dsh-css-modules-inline',
  resolveId(source: string, importer: string | undefined) {
    if (!source.endsWith('.module.css')) return null
    const abs = importer !== undefined ? resolvePath(dirname(importer), source) : source
    return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
  },
  async load(virtualId: string) {
    if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
    const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
    this.addWatchFile(fileId)
    const source = await readFile(fileId)
    const { code, exports: cssExports } = transform({
      filename: fileId,
      code: source,
      cssModules: { pattern: '[hash]_[local]' },
      minify: true,
    })
    const classMap: Record<string, string> = {}
    for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
    return [
      `const css = ${JSON.stringify(code.toString())};`,
      `const tagId = ${JSON.stringify(`${PLUGIN_ID}/${basename(fileId)}`)};`,
      'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
      '  const tag = document.createElement(\'style\');',
      `  tag.dataset.plugin = ${JSON.stringify(PLUGIN_ID)};`,
      '  tag.dataset.pluginCss = tagId;',
      '  tag.textContent = css;',
      '  document.head.appendChild(tag);',
      '}',
      `export default ${JSON.stringify(classMap)};`,
    ].join('\n')
  },
}]

const browserConfig: UserConfig = {
  name: `${PLUGIN_ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  dts: false,
  sourcemap: true,
  clean: false,
  external: clientExternals,
  // Bundle everything not in the module table; the table entries stay external.
  noExternal: (id: string) => (clientExternals.includes(id) ? undefined : true),
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: cssModulesInline,
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default defineConfig([browserConfig])
