/**
 * Tavily settings section, browser half — one feature-owned top-level entry in
 * the settings navigation (`settings.section`).
 *
 * The section binds the `web-search-tavily` settings namespace and manages a
 * pool of write-only credentials. Key values never ride a response; settings
 * contain only each key's display name, generated credential reference and
 * enabled state.
 *
 * The tab also surfaces the endpoint / search depth / result-count options
 * the provider serves, staged like the shipped plugin cards: a save writes
 * the section, and the Host's live settings section re-resolves the provider
 * options for the next search.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.tavily'

/** Settings namespace the Host plugin registers; spelled here to avoid a client→host dependency. */
export const TAVILY_NS = 'web-search-tavily'

/** One control's draft text and whether a save would leave an override. */
export interface FieldState {
  text: string
  overridden: boolean
  invalid: boolean
}

export interface TavilyUsage {
  key?: {
    usage?: number
    limit?: number
    search_usage?: number
    extract_usage?: number
    crawl_usage?: number
    map_usage?: number
    research_usage?: number
  }
  account?: {
    current_plan?: string
    plan_usage?: number
    plan_limit?: number
    paygo_usage?: number
    paygo_limit?: number
    search_usage?: number
  }
}

export interface TavilyKeyState {
  id: string
  name: string
  ref: string
  enabled: boolean
  configured: boolean
  writable: boolean
  loading: boolean
  usage?: TavilyUsage
  error?: string
}

/** The tab's full snapshot: shell facts plus every field. */
export interface TavilyTabState {
  available: boolean
  writable: boolean
  dirty: boolean
  invalid: boolean
  saving: boolean
  failed: boolean
  endpoint: FieldState
  searchDepth: FieldState
  maxResults: FieldState
  keys: TavilyKeyState[]
}

export interface TavilyKeyConfig {
  id: string
  name: string
  ref: string
  enabled?: boolean
}

/** A whole-number field. Empty draft clears; anything else must parse. */
function numberField(field: string) {
  return {
    field,
    format: (value: unknown) => (typeof value === 'number' ? String(value) : ''),
    parse: (text: string): { kind: 'clear' } | { kind: 'set'; value: number } | undefined => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      const parsed = Number(trimmed)
      return Number.isFinite(parsed) ? { kind: 'set', value: parsed } : undefined
    },
  }
}

/** A free-text field. Empty draft clears. */
function textField(field: string) {
  return {
    field,
    format: (value: unknown) => (typeof value === 'string' ? value : ''),
    parse: (text: string): { kind: 'clear' } | { kind: 'set'; value: string } => {
      const trimmed = text.trim()
      return trimmed === '' ? { kind: 'clear' } : { kind: 'set', value: trimmed }
    },
  }
}

type FieldSpec =
  | ReturnType<typeof textField>
  | ReturnType<typeof numberField>

/**
 * Stages the tab's edits over one settings namespace and writes them on save.
 * The API key is a write-only control addressed through the credentials
 * domain, exactly like the shipped web-search card.
 */
class TavilyCardForm {
  readonly scope: SettingsScope<TavilySection>
  readonly specs: Map<string, FieldSpec>
  readonly secretSpecs: Map<string, { write: (value: string) => Promise<boolean> }>
  readonly staged = new Map<string, { text: string; clear: boolean }>()
  readonly listeners = new Set<() => void>()
  saving = false
  failed = false

  constructor(
    scope: SettingsScope<TavilySection>,
    specs: FieldSpec[],
    secrets: { field: string; write: (value: string) => Promise<boolean> }[],
  ) {
    this.scope = scope
    this.specs = new Map(specs.map((spec) => [spec.field, spec]))
    this.secretSpecs = new Map(secrets.map((spec) => [spec.field, spec]))
    scope.subscribe(() => {
      this.publish()
    })
  }

  bind(project: () => TavilyTabState): SnapshotStore<TavilyTabState> {
    const store = createSnapshotStore(project())
    this.listeners.add(() => {
      store.set(project())
    })
    return store
  }

  shell() {
    const snapshot = this.scope.getSnapshot()
    const plan = this.plan()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: plan.length > 0,
      invalid: plan.some((item) => item.run === undefined),
      saving: this.saving,
      failed: this.failed,
    }
  }

  field(field: string): FieldState {
    const staged = this.staged.get(field)
    if (this.secretSpecs.has(field)) {
      return { text: staged?.text ?? '', overridden: false, invalid: false }
    }
    const spec = this.spec(field)
    if (staged === undefined) {
      return {
        text: spec.format(this.sectionValue(field)),
        overridden: this.stored(field),
        invalid: false,
      }
    }
    const write = staged.clear ? { kind: 'clear' as const } : spec.parse(staged.text)
    return {
      text: staged.text,
      overridden: write?.kind === 'set',
      invalid: write === undefined,
    }
  }

  actions() {
    return {
      edit: (field: string, text: string) => {
        this.stage(field, { text, clear: false })
      },
      resetField: (field: string) => {
        this.stage(field, {
          text: this.spec(field).format(this.baseValue(field)),
          clear: true,
        })
      },
      save: () => {
        void this.save()
      },
      discard: () => {
        if (this.staged.size === 0 && !this.failed) return
        this.staged.clear()
        this.failed = false
        this.publish()
      },
    }
  }

  async save() {
    const plan = this.plan()
    const writes = plan.flatMap((item) => (item.run === undefined ? [] : [item.run]))
    if (plan.length === 0 || this.saving || writes.length !== plan.length) return
    this.saving = true
    this.failed = false
    this.publish()
    let landed = true
    for (const write of writes) landed = (await write()) && landed
    if (landed) this.staged.clear()
    this.saving = false
    this.failed = !landed
    this.publish()
  }

  plan(): { field: string; run?: () => Promise<boolean> }[] {
    const plan: { field: string; run?: () => Promise<boolean> }[] = []
    for (const [field, staged] of this.staged) {
      const secret = this.secretSpecs.get(field)
      if (secret !== undefined) {
        const value = staged.text.trim()
        if (value !== '') {
          plan.push({ field, run: () => secret.write(value) })
        }
        continue
      }
      const spec = this.spec(field)
      if (staged.clear) {
        if (this.stored(field)) {
          plan.push({ field, run: () => this.clear(field) })
        }
        continue
      }
      if (staged.text === spec.format(this.sectionValue(field))) continue
      const write = spec.parse(staged.text)
      if (write === undefined) {
        plan.push({ field, run: undefined })
      } else if (write.kind === 'clear') {
        plan.push({ field, run: () => this.clear(field) })
      } else {
        plan.push({ field, run: () => this.store(field, write.value) })
      }
    }
    return plan
  }

  async clear(field: string) {
    await this.scope.unset(field)
    return !this.stored(field)
  }

  async store(field: string, value: unknown) {
    await this.scope.set(field, value)
    const user = this.userLayer()
    return user !== undefined && (user as Record<string, unknown>)[field] === value
  }

  stage(field: string, edit: { text: string; clear: boolean }) {
    this.staged.set(field, edit)
    this.failed = false
    this.publish()
  }

  spec(field: string): FieldSpec {
    const spec = this.specs.get(field)
    if (spec === undefined) throw new Error(`Tavily tab has no field ${field}`)
    return spec
  }

  sectionValue(field: string) {
    const value = this.scope.getSnapshot().value
    return value !== undefined ? (value as Record<string, unknown>)[field] : undefined
  }

  baseValue(field: string) {
    return (this.scope.getSnapshot().base as TavilySection | undefined)?.[field as keyof TavilySection]
  }

  userLayer() {
    return this.scope.getSnapshot().user as TavilySection | undefined
  }

  stored(field: string) {
    const user = this.userLayer()
    return user !== undefined && Object.hasOwn(user, field)
  }

  publish() {
    for (const listener of this.listeners) listener()
  }
}

/** The settings section shape (mirrors the Host schema). */
export interface TavilySection {
  keys?: TavilyKeyConfig[]
  endpoint?: string
  searchDepth?: string
  maxResults?: number
  timeoutMs?: number
}

/**
 * The tab's controller: binds the settings scope, bridges the credentials
 * domain, and exposes the staged form's snapshot.
 */
export class TavilyTabController {
  readonly scope: SettingsScope<TavilySection>
  readonly api: IApiClient
  readonly form: TavilyCardForm
  readonly store: SnapshotStore<TavilyTabState>
  keyStates = new Map<string, TavilyKeyState>()

  constructor(scope: SettingsScope<TavilySection>, api: IApiClient) {
    this.scope = scope
    this.api = api
    this.form = new TavilyCardForm(
      scope,
      [textField('endpoint'), textField('searchDepth'), numberField('maxResults')],
      [],
    )
    this.store = this.form.bind(() => this.projection())
    scope.subscribe(() => {
      void this.readKeys()
    })
    void this.readKeys()
  }

  projection(): TavilyTabState {
    return {
      ...this.form.shell(),
      endpoint: this.form.field('endpoint'),
      searchDepth: this.form.field('searchDepth'),
      maxResults: this.form.field('maxResults'),
      keys: this.keys().map((row) => this.keyStates.get(row.id) ?? {
        ...row,
        enabled: row.enabled !== false,
        configured: false,
        writable: true,
        loading: false,
      }),
    }
  }

  /** The face the tab's slot registration injects. */
  inject() {
    return {
      hooks: { tavilyTab: this.store },
      ...this.form.actions(),
      addKey: (name: string, value: string) => this.addKey(name, value),
      renameKey: (id: string, name: string) => this.renameKey(id, name),
      replaceKey: (id: string, value: string) => this.replaceKey(id, value),
      removeKey: (id: string) => this.removeKey(id),
      toggleKey: (id: string, enabled: boolean) => this.toggleKey(id, enabled),
      refreshUsage: (id: string) => this.refreshUsage(id),
      refreshAllUsage: () => this.refreshAllUsage(),
    }
  }

  keys(): TavilyKeyConfig[] {
    const rows = this.scope.getSnapshot().value?.keys
    return Array.isArray(rows) ? rows : []
  }

  async storeKeys(keys: TavilyKeyConfig[]) {
    await this.scope.set('keys', keys)
    await this.readKeys()
  }

  async readKeys() {
    const rows = this.keys()
    if (rows.length === 0) {
      this.keyStates.clear()
      this.store.set(this.projection())
      return
    }
    let response
    try {
      response = await this.api.credentials.describe({ refs: rows.map((row) => row.ref) })
    } catch { return }
    if (!response.result.ok) return
    const next = new Map<string, TavilyKeyState>()
    for (const row of rows) {
      const previous = this.keyStates.get(row.id)
      const view = response.result.value.credentials[row.ref]
      next.set(row.id, {
        id: row.id,
        name: row.name,
        ref: row.ref,
        enabled: row.enabled !== false,
        configured: view?.configured ?? false,
        writable: view?.writable ?? true,
        loading: previous?.loading ?? false,
        ...(previous?.usage === undefined ? {} : { usage: previous.usage }),
        ...(previous?.error === undefined ? {} : { error: previous.error }),
      })
    }
    this.keyStates = next
    this.store.set(this.projection())
  }

  async addKey(name: string, value: string) {
    const cleanName = name.trim()
    const cleanValue = value.trim()
    if (cleanName === '' || cleanValue === '') return false
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const ref = `TAVILY_API_KEY_${id.toUpperCase()}`
    const stored = await this.api.credentials.set({ ref, value: cleanValue })
    if (!stored.result.ok) return false
    await this.storeKeys([...this.keys(), { id, name: cleanName, ref, enabled: true }])
    return true
  }

  async renameKey(id: string, name: string) {
    const clean = name.trim()
    if (clean === '') return false
    const rows = this.keys()
    await this.storeKeys(rows.map((row) => row.id === id ? { ...row, name: clean } : row))
    return true
  }

  async replaceKey(id: string, value: string) {
    const row = this.keys().find((item) => item.id === id)
    if (row === undefined || value.trim() === '') return false
    const response = await this.api.credentials.set({ ref: row.ref, value: value.trim() })
    await this.readKeys()
    return response.result.ok
  }

  async removeKey(id: string) {
    const row = this.keys().find((item) => item.id === id)
    if (row === undefined) return false
    const response = await this.api.credentials.unset({ ref: row.ref })
    if (!response.result.ok) return false
    await this.storeKeys(this.keys().filter((item) => item.id !== id))
    return true
  }

  async toggleKey(id: string, enabled: boolean) {
    await this.storeKeys(this.keys().map((row) => row.id === id ? { ...row, enabled } : row))
    return true
  }

  async refreshUsage(id: string) {
    const row = this.keys().find((item) => item.id === id)
    const state = this.keyStates.get(id)
    if (row === undefined || state === undefined) return false
    this.keyStates.set(id, { ...state, loading: true, error: undefined })
    this.store.set(this.projection())
    let response: Response
    try {
      response = await fetch(`/api/tavily/usage?ref=${encodeURIComponent(row.ref)}`, { cache: 'no-store' })
    } catch (error) {
      this.keyStates.set(id, { ...state, loading: false, error: error instanceof Error ? error.message : String(error) })
      this.store.set(this.projection())
      return false
    }
    const contentType = response.headers.get('content-type') ?? ''
    let body: { ok: boolean; usage?: TavilyUsage; message?: string } | undefined
    let rawText = ''
    if (contentType.includes('application/json')) {
      try { body = await response.json() as typeof body } catch { body = undefined }
    } else {
      try { rawText = (await response.text()).slice(0, 300) } catch { rawText = '' }
    }
    this.keyStates.set(id, {
      ...state,
      loading: false,
      ...(response.ok && body?.ok === true && body.usage !== undefined
        ? { usage: body.usage, error: undefined }
        : { error: body?.message ?? (rawText !== '' ? rawText : `HTTP ${String(response.status)}`) }),
    })
    this.store.set(this.projection())
    return this.keyStates.get(id)?.error === undefined
  }

  async refreshAllUsage() {
    await Promise.all(this.keys().map((row) => this.refreshUsage(row.id)))
  }
}
