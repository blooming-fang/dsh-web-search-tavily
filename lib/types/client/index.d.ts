/** Client type declarations for dsh-tavily-web-search's browser half. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  SettingsFieldState,
  SettingsFormActions,
  SettingsFormScope,
  SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'

export declare const NS: 'settings.tavily'
export declare const TAVILY_NS: 'web-search-tavily'

export interface TavilyUsage {
  key?: { usage?: number; limit?: number; search_usage?: number }
  account?: { current_plan?: string; plan_usage?: number; plan_limit?: number; search_usage?: number }
}
export interface TavilyKeyConfig { id: string; name: string; ref: string; enabled?: boolean }
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
export interface TavilySection {
  keys?: TavilyKeyConfig[]
  endpoint?: string
  searchDepth?: string
  maxResults?: number
  timeoutMs?: number
}
export interface TavilyTabState extends SettingsFormShell {
  endpoint: SettingsFieldState
  searchDepth: SettingsFieldState
  maxResults: SettingsFieldState
  keys: TavilyKeyState[]
}
export interface TavilyTabActions extends SettingsFormActions {
  addKey: (name: string, value: string) => Promise<boolean>
  renameKey: (id: string, name: string) => Promise<boolean>
  replaceKey: (id: string, value: string) => Promise<boolean>
  removeKey: (id: string) => Promise<boolean>
  toggleKey: (id: string, enabled: boolean) => Promise<boolean>
  refreshUsage: (id: string) => Promise<boolean>
  refreshAllUsage: () => Promise<void>
}
export declare class TavilyTabController {
  readonly scope: SettingsFormScope<TavilySection>
  readonly store: SnapshotStore<TavilyTabState>
  constructor(scope: SettingsFormScope<TavilySection>, remote: unknown)
  projection(): TavilyTabState
  readKeys(): Promise<void>
  dispose(): void
  inject(): TavilyTabActions & { hooks: { tavilyTab: SnapshotStore<TavilyTabState> } }
}
export declare const inject: string[]
export declare function apply(ctx: ClientContext): void
