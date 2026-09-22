/**
 * Tavily settings section, browser half — one feature-owned top-level entry in
 * the settings navigation (`settings.section`).
 *
 * Since DSH 0.1.7 a plugin's configuration lives in its own `Config` schema,
 * served to the browser by the settings domain: the section binds the shared
 * configuration form of the plugin's profile entry (`ctx.configForms`) instead
 * of registering a namespace of its own. Edits are staged and written as
 * revision-fenced path mutations, so a save is one atomic document write.
 *
 * The section manages a pool of write-only credentials. Key values never ride a
 * response; the section holds only each key's display name, generated credential
 * reference and enabled state.
 */

// Type-only merges: the credentials remote namespace (dsh-api-settings-controller/remote),
// the `credentials/reference-updated` forwarded event (dsh-credentials), and the
// Remote namespaces themselves (dsh-api-remotes/client).
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-settings-controller/remote'
import type { CredentialInfo } from '@deepseek-ai/dsh-credentials'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel,
  settingsNumberField,
  settingsTextField,
  type SettingsFieldState,
  type SettingsFormScope,
  type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'

/** The `credentials` remote namespace the section reads and writes. */
export interface TavilyCredentialsRemote {
  describe(refs: string[]): Promise<RemoteResult<Record<string, CredentialInfo>>>
  set(ref: string, value: string): Promise<RemoteResult<void>>
  unset(ref: string): Promise<RemoteResult<void>>
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.tavily'

/** Profile entry id (the plugin's settings namespace) this section edits. */
export const TAVILY_NS = 'web-search-tavily'

/** The settings section shape (mirrors the Host Config schema). */
export interface TavilySection {
  keys?: TavilyKeyConfig[]
  endpoint?: string
  searchDepth?: string
  maxResults?: number
  timeoutMs?: number
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

export interface TavilyKeyConfig {
  id: string
  name: string
  ref: string
  enabled?: boolean
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

/** The section's full snapshot: the shared form shell plus every control. */
export interface TavilyTabState extends SettingsFormShell {
  endpoint: SettingsFieldState
  searchDepth: SettingsFieldState
  maxResults: SettingsFieldState
  keys: TavilyKeyState[]
}

/**
 * The section's controller: binds the shared configuration form of the
 * `web-search-tavily` profile entry, bridges the credentials domain, and
 * exposes the staged form's snapshot plus the key-pool actions.
 */
export class TavilyTabController {
  readonly scope: SettingsFormScope<TavilySection>
  readonly remote: TavilyCredentialsRemote
  readonly form: SettingsFormModel<TavilySection>
  readonly store: SnapshotStore<TavilyTabState>
  keyStates = new Map<string, TavilyKeyState>()
  private readonly unsubscribe: () => void

  constructor(scope: SettingsFormScope<TavilySection>, remote: TavilyCredentialsRemote) {
    this.scope = scope
    this.remote = remote
    this.form = new SettingsFormModel(scope, [
      settingsTextField('endpoint'),
      settingsTextField('searchDepth'),
      settingsNumberField('maxResults'),
    ])
    this.store = this.form.bind(() => this.projection())
    this.unsubscribe = scope.subscribe(() => {
      void this.readKeys()
    })
    void this.readKeys()
  }

  /** Release the form and scope subscriptions. */
  dispose() {
    this.unsubscribe()
    this.form.dispose()
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

  /** The face the section's slot registration injects. */
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

  /** Replace the whole public key pool in one revision-fenced write. */
  async storeKeys(keys: TavilyKeyConfig[]) {
    await this.scope.mutate([{ op: 'set', path: ['keys'], value: keys }])
    await this.readKeys()
  }

  async readKeys() {
    const rows = this.keys()
    if (rows.length === 0) {
      this.keyStates.clear()
      this.store.set(this.projection())
      return
    }
    let response: RemoteResult<Record<string, CredentialInfo>>
    try {
      response = await this.remote.describe(rows.map((row) => row.ref))
    } catch { return }
    if (!response.ok) return
    const views = response.value
    const next = new Map<string, TavilyKeyState>()
    for (const row of rows) {
      const previous = this.keyStates.get(row.id)
      const view = views[row.ref]
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
    const stored = await this.remote.set(ref, cleanValue)
    if (!stored.ok) return false
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
    const response = await this.remote.set(row.ref, value.trim())
    await this.readKeys()
    return response.ok
  }

  async removeKey(id: string) {
    const row = this.keys().find((item) => item.id === id)
    if (row === undefined) return false
    const response = await this.remote.unset(row.ref)
    if (!response.ok) return false
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
