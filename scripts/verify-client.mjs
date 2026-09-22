/**
 * Runtime check of the browser half.
 *
 * The client bundle is a lazy-CJS registration for the web module table, so it
 * is loaded here the way the shell loads it: install the registration facade,
 * evaluate the bundle, then materialize its factory with a require that answers
 * the platform seed. `react`, `react/jsx-runtime`, `react-dom/server` and
 * `@deepseek-ai/dsh-client-store` are the real packages; the UI primitives are
 * stubbed because the shipped module carries browser-only assets (CSS modules,
 * shiki, katex) that cannot be materialized in Node. The stub's
 * `SettingsFormModel` and field specs are copied verbatim from the shipped
 * implementation, so the controller is exercised against its real contract.
 *
 * Usage: node ./scripts/verify-client.mjs
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const require = createRequire(import.meta.url)

const React = require('react')
const jsxRuntime = require('react/jsx-runtime')
const { renderToStaticMarkup } = require('react-dom/server')
/** The snapshot-store contract the form model publishes through (the shipped store needs zustand, undeclared). */
function createSnapshotStore(initial) {
  let snapshot = initial
  const listeners = new Set()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: (next) => { snapshot = next; for (const listener of listeners) listener() },
  }
}

let failures = 0
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  if (!ok) failures += 1
}

// ── the primitives stub (SettingsFormModel + specs copied from the shipped source) ──
function settingsNumberField(field) {
  return {
    field,
    format: (value) => typeof value === 'number' ? String(value) : '',
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      const parsed = Number(trimmed)
      return Number.isFinite(parsed) ? { kind: 'set', value: parsed } : undefined
    },
  }
}
function settingsTextField(field) {
  return {
    field,
    format: (value) => typeof value === 'string' ? value : '',
    parse: (text) => {
      const trimmed = text.trim()
      return trimmed === '' ? { kind: 'clear' } : { kind: 'set', value: trimmed }
    },
  }
}
class SettingsFormModel {
  constructor(scope, specs, secrets = []) {
    this.scope = scope
    this.specs = new Map(specs.map((spec) => [spec.field, spec]))
    this.secretSpecs = new Map(secrets.map((spec) => [spec.field, spec]))
    this.staged = new Map()
    this.listeners = new Set()
    this.saving = false
    this.failed = false
    this.unsubscribe = scope.subscribe(() => { this.publish() })
  }
  bind(project) {
    const store = createSnapshotStore(project())
    this.listeners.add(() => { store.set(project()) })
    return store
  }
  shell() {
    const snapshot = this.scope.getSnapshot()
    const plan = this.plan()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: plan.length > 0,
      invalid: plan.some((item) => item.run === undefined && item.op === undefined),
      saving: this.saving,
      failed: this.failed,
    }
  }
  field(field) {
    const staged = this.staged.get(field)
    if (this.secretSpecs.has(field)) return { text: staged?.text ?? '', overridden: false, invalid: false }
    const spec = this.spec(field)
    if (staged === undefined) {
      return { text: spec.format(this.sectionValue(field)), overridden: this.stored(field), invalid: false }
    }
    const write = staged.clear ? { kind: 'clear' } : spec.parse(staged.text)
    return { text: staged.text, overridden: write?.kind === 'set', invalid: write === undefined }
  }
  actions() {
    return {
      edit: (field, text) => { this.stage(field, { text, clear: false }) },
      resetField: (field) => { this.stage(field, { text: this.spec(field).format(this.baseValue(field)), clear: true }) },
      save: () => { void this.save() },
      discard: () => {
        if (this.staged.size === 0 && !this.failed) return
        this.staged.clear()
        this.baseline = undefined
        this.failed = false
        this.publish()
      },
    }
  }
  async save() {
    const plan = this.plan()
    if (!plan.length || this.saving || !this.scope.getSnapshot().writable || plan.some((item) => item.run === undefined && item.op === undefined)) return
    this.saving = true
    this.failed = false
    this.publish()
    try {
      const ops = plan.flatMap((item) => item.op === undefined ? [] : [item.op])
      let landed = !ops.length || await this.scope.mutate(ops, this.baseline?.revision)
      if (!landed) { this.failed = true; return }
      for (const item of plan) if (item.run) landed = await item.run() && landed
      if (landed) { this.staged.clear(); this.baseline = undefined }
      this.failed = !landed
    } catch {
      this.failed = true
    } finally {
      this.saving = false
      this.publish()
    }
  }
  dispose() { this.unsubscribe(); this.listeners.clear() }
  plan() {
    const plan = []
    for (const [field, staged] of this.staged) {
      const secret = this.secretSpecs.get(field)
      if (secret !== undefined) {
        const value = staged.text.trim()
        if (value !== '') plan.push({ field, run: () => secret.write(value) })
        continue
      }
      const spec = this.spec(field)
      if (staged.clear) {
        if (this.stored(field)) plan.push({ field, op: { op: 'unset', path: [field] } })
        continue
      }
      if (staged.text === spec.format(this.sectionValue(field))) continue
      const write = spec.parse(staged.text)
      if (write === undefined) plan.push({ field })
      else if (write.kind === 'clear') plan.push({ field, op: { op: 'unset', path: [field] } })
      else plan.push({ field, op: { op: 'set', path: [field], value: write.value } })
    }
    return plan
  }
  stage(field, edit) {
    this.baseline ??= this.scope.getSnapshot()
    this.staged.set(field, edit)
    this.failed = false
    this.publish()
  }
  spec(field) {
    const spec = this.specs.get(field)
    if (spec === undefined) throw new Error(`plugin card has no field ${field}`)
    return spec
  }
  sectionValue(field) { return this.scope.getSnapshot().value?.[field] }
  baseValue(field) { return this.scope.getSnapshot().base?.[field] }
  userLayer() { return this.scope.getSnapshot().user }
  stored(field) {
    const user = this.userLayer()
    return user !== undefined && Object.hasOwn(user, field)
  }
  publish() { for (const listener of this.listeners) listener() }
}

const primitives = {
  SettingsFormModel,
  settingsTextField,
  settingsNumberField,
  SettingsForm: (props) => jsxRuntime.jsx('section', { children: props.children }),
  SettingsValueField: (props) => jsxRuntime.jsxs('label', { children: [props.label, jsxRuntime.jsx('input', { id: props.id, value: props.text, disabled: props.disabled, onChange: (event) => { props.onEdit(event.target.value) } })] }),
  SettingsSecretField: (props) => jsxRuntime.jsxs('label', { children: [props.label, jsxRuntime.jsx('input', { id: props.id, type: 'password', value: props.text, onChange: (event) => { props.onEdit(event.target.value) } })] }),
  IconGlobeOutlineRegular: () => jsxRuntime.jsx('i', { className: 'globe' }),
  IconChevronDownOutlineRegular: () => jsxRuntime.jsx('i', { className: 'chevron' }),
}

// ── load the bundle exactly as the module table does ──────────────────────
const code = readFileSync(join(root, 'lib/client.js'), 'utf8')
let registration
globalThis.window = { __ModuleLoader__: { load: (value) => { registration = value } } }
new Function(code)()
check('bundle registers under the package id', registration?.id === 'dsh-tavily-web-search', registration?.id)

const shim = (specifier) => {
  if (specifier === 'react') return React
  if (specifier === 'react/jsx-runtime') return jsxRuntime
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error(`bundle requested an unseeded module: ${specifier}`)
}
const exports = registration.factory(shim)
check('bundle exports apply/inject/NS', typeof exports.apply === 'function' && Array.isArray(exports.inject) && exports.NS === 'settings.tavily', JSON.stringify(exports.inject))
check('client inject face matches the 0.1.7 services', exports.inject.join(',') === 'slots,locale,remote,remote.credentials,configForms', exports.inject.join(','))

// ── a fake browser plugin context ─────────────────────────────────────────
const writes = []
const describeCalls = []
const credentialWrites = []
let sectionRegistration
let whileServedNamespaces
let forwardedListener
let registeredDicts

function makeScope(initial) {
  let snapshot = { status: 'ready', value: initial, base: { endpoint: 'https://api.tavily.com/search' }, user: { keys: initial.keys }, writable: true, revision: 1, mode: 'host' }
  const listeners = new Set()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    mutate: async (ops) => {
      writes.push(ops)
      const value = { ...snapshot.value }
      for (const op of ops) {
        if (op.op === 'set') value[op.path[0]] = op.value
        else delete value[op.path[0]]
      }
      snapshot = { ...snapshot, value, user: { ...value }, revision: snapshot.revision + 1 }
      for (const listener of listeners) listener()
      return true
    },
  }
}

const scope = makeScope({ endpoint: 'https://api.tavily.com/search', searchDepth: 'advanced', maxResults: 8, keys: [] })
const remote = {
  credentials: {
    async describe(refs) {
      describeCalls.push(refs)
      return { ok: true, value: Object.fromEntries(refs.map((ref) => [ref, { configured: true, writable: true }])) }
    },
    async set(ref, value) { credentialWrites.push({ kind: 'set', ref, value }); return { ok: true, value: undefined } },
    async unset(ref) { credentialWrites.push({ kind: 'unset', ref }); return { ok: true, value: undefined } },
  },
  $on(event, listener) { forwardedListener = { event, listener }; return () => {} },
}
const ctx = {
  effect: (fn) => { const disposer = fn(); return disposer },
  locale: {
    bind: () => (key) => ({ nav: 'Tavily 搜索', heading: 'Tavily 搜索', intro: 'intro', name: 'Tavily 网页搜索', description: 'desc', unsaved: '未保存', expand: '展开设置', collapse: '收起设置', keysTitle: 'API Key 池' }[key] ?? key),
    register: (ns, dicts) => { registeredDicts = { ns, dicts }; return () => {} },
  },
  slots: {
    inject: (key, callback) => { const disposer = callback(); return disposer },
    register: (options, component) => { sectionRegistration = { options, component }; return () => {} },
  },
  remote,
  configForms: {
    get: (ns) => { ctx.configForms.requested = ns; return scope },
    whileServed: (namespaces, register) => { whileServedNamespaces = namespaces; return register(new Set(namespaces)) },
  },
}

exports.apply(ctx)
check('dictionaries registered under settings.tavily', registeredDicts?.ns === 'settings.tavily' && typeof registeredDicts.dicts.zh.nav === 'string')
check('binds the plugin entry shared form', ctx.configForms.requested === 'web-search-tavily', ctx.configForms.requested)
check('section is contributed only while the entry is served', JSON.stringify(whileServedNamespaces) === '["web-search-tavily"]', JSON.stringify(whileServedNamespaces))
check('registered into settings.section with nav identity', sectionRegistration?.options.name === 'settings.section' && sectionRegistration.options.id === 'tavily-search' && sectionRegistration.options.order === 25 && sectionRegistration.options.locale === 'settings.tavily')
check('nav label follows the active locale', sectionRegistration.options.label() === 'Tavily 搜索')
check('subscribes to forwarded credential updates', forwardedListener?.event === 'credentials/reference-updated')

const face = sectionRegistration.options.inject()
check('inject face carries the hooks seat and form actions', typeof face.hooks.tavilyTab?.getSnapshot === 'function' && typeof face.edit === 'function' && typeof face.save === 'function' && typeof face.addKey === 'function')

// ── render the component through React ────────────────────────────────────
// The renderer binds the entry's `hooks.tavilyTab` source to the `useTavilyTab`
// selector prop; do that here the way the slot machinery does.
const useTavilyTab = (selector) => selector(face.hooks.tavilyTab.getSnapshot())
const html = renderToStaticMarkup(React.createElement(sectionRegistration.component, { ...face, useTavilyTab, t: ctx.locale.bind('settings.tavily'), close: () => {} }))
check('component renders the section for the served entry', html.includes('Tavily 搜索') && html.includes('Tavily 网页搜索'), html.slice(0, 120))
const unavailable = renderToStaticMarkup(React.createElement(sectionRegistration.component, {
  ...face,
  useTavilyTab: () => ({ available: false, writable: true, dirty: false, invalid: false, saving: false, failed: false, endpoint: { text: '', overridden: false, invalid: false }, searchDepth: { text: '', overridden: false, invalid: false }, maxResults: { text: '', overridden: false, invalid: false }, keys: [] }),
  t: ctx.locale.bind('settings.tavily'),
  close: () => {},
}))
check('component renders nothing while the entry is not served', unavailable === '')

// ── scalar field save goes through one revision-fenced mutation ────────────
writes.length = 0
face.edit('maxResults', '20')
await face.save()
await new Promise((resolve) => setTimeout(resolve, 0))
check('saving a scalar field writes one set op', writes.length === 1 && JSON.stringify(writes[0]) === '[{"op":"set","path":["maxResults"],"value":20}]', JSON.stringify(writes[0]))
check('the saved value is reflected in the snapshot', face.hooks.tavilyTab.getSnapshot().maxResults.text === '20')

// ── key pool management ───────────────────────────────────────────────────
writes.length = 0
const added = await face.addKey('个人', 'tvly-secret')
check('adding a key writes the credential and the public metadata', added === true && credentialWrites[0]?.kind === 'set' && credentialWrites[0].value === 'tvly-secret')
const addedRef = credentialWrites[0]?.ref
check('the generated reference is a Tavily credential name', /^TAVILY_API_KEY_[0-9A-Z]+$/.test(addedRef ?? ''), addedRef)
check('the pool mutation carries only public metadata', writes.length === 1 && writes[0][0].op === 'set' && writes[0][0].path[0] === 'keys' && JSON.stringify(Object.keys(writes[0][0].value[0]).sort()) === '["enabled","id","name","ref"]', JSON.stringify(writes[0][0]))
check('the key row reports the credential state', face.hooks.tavilyTab.getSnapshot().keys[0]?.configured === true)

const keyId = writes[0][0].value[0].id
writes.length = 0
await face.toggleKey(keyId, false)
check('disabling a key writes the pool back', writes[0][0].value[0].enabled === false)

writes.length = 0
await face.renameKey(keyId, '工作')
check('renaming a key writes the pool back', writes[0][0].value[0].name === '工作')

// ── usage query ───────────────────────────────────────────────────────────
const realFetch = globalThis.fetch
globalThis.fetch = async (url) => {
  check('usage query addresses the plugin route with the reference', String(url) === `/api/tavily/usage?ref=${encodeURIComponent(addedRef)}`, String(url))
  return new Response(JSON.stringify({ ok: true, usage: { account: { current_plan: 'Researcher', plan_usage: 42, plan_limit: 1000, search_usage: 7 } } }), { status: 200, headers: { 'content-type': 'application/json' } })
}
const refreshed = await face.refreshUsage(keyId)
globalThis.fetch = realFetch
check('usage lands on the key row', refreshed === true && face.hooks.tavilyTab.getSnapshot().keys[0]?.usage?.account?.plan_usage === 42, JSON.stringify(face.hooks.tavilyTab.getSnapshot().keys[0]?.usage))

// ── removal and forwarded credential updates ──────────────────────────────
const before = describeCalls.length
forwardedListener.listener(addedRef)
await new Promise((resolve) => setTimeout(resolve, 0))
check('a forwarded credential update re-reads the pool', describeCalls.length > before)

writes.length = 0
await face.removeKey(keyId)
check('removing a key deletes the credential and the pool row', credentialWrites.at(-1)?.kind === 'unset' && writes[0][0].value.length === 0)

console.log(`\n${failures === 0 ? 'CLIENT VERIFY OK' : `CLIENT VERIFY FAILED (${String(failures)})`}`)
process.exit(failures === 0 ? 0 : 1)
