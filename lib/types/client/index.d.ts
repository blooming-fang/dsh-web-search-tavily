/** Client type declarations for dsh-web-search-tavily's browser half. */
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'

export declare const NS: 'settings.tavily'
export declare const TAVILY_NS: 'web-search-tavily'

export interface FieldState { text: string; overridden: boolean; invalid: boolean }
export interface TavilyUsage {
  key?: { usage?: number; limit?: number; search_usage?: number }
  account?: { current_plan?: string; plan_usage?: number; plan_limit?: number; search_usage?: number }
}
export interface TavilyKeyConfig { id: string; name: string; ref: string; enabled?: boolean }
export interface TavilyKeyState extends TavilyKeyConfig {
  enabled: boolean
  configured: boolean
  writable: boolean
  loading: boolean
  usage?: TavilyUsage
  error?: string
}
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
export interface TavilySection {
  keys?: TavilyKeyConfig[]
  endpoint?: string
  searchDepth?: string
  maxResults?: number
  timeoutMs?: number
}
export declare class TavilyTabController {
  readonly scope: SettingsScope<TavilySection>
  readonly api: IApiClient
  readonly store: SnapshotStore<TavilyTabState>
  constructor(scope: SettingsScope<TavilySection>, api: IApiClient)
  projection(): TavilyTabState
  readKeys(): Promise<void>
  inject(): Record<string, unknown>
}
export declare const inject: string[]
export declare function apply(ctx: import('@deepseek-ai/dsh-client-runtime/client').ClientContext): void
