/** Type declarations for dsh-tavily-web-search's node half. */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import type z from '@deepseek-ai/schemastery'

export declare const TAVILY_PROVIDER_ID: 'tavily'
export declare const WEB_SEARCH_TAVILY_SETTINGS_NAMESPACE: string
export declare const TAVILY_USAGE_PATH: string
export declare const name: string
export declare const inject: string[]

/** One API key's public metadata; the secret itself lives in the credentials provider. */
export interface TavilyKeyConfig {
  id: string
  name: string
  /** Credential reference the provider resolves at search time. */
  ref: string
  enabled?: boolean
}

/**
 * The plugin's live configuration section. Every field is a {@link Volatile}
 * read, so a saved settings edit reaches the next operation without a remount.
 */
export interface TavilyConfig {
  keys: Volatile<TavilyKeyConfig[]>
  endpoint: Volatile<string>
  searchDepth: Volatile<string>
  maxResults: Volatile<number>
  timeoutMs: Volatile<number>
}

export declare const Config: z<TavilyConfig>

export interface TavilySearchOptions {
  apiKey?: string
  resolveApiKey?: () => Promise<string | undefined>
  endpoint: string
  searchDepth: string
  maxResults: number
  timeoutMs: number
}

export declare class TavilySearchProvider implements WebSearchProvider {
  readonly id: 'tavily'
  constructor(resolveOptions: () => TavilySearchOptions)
  available(): boolean
  search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>
  apiKey(options: TavilySearchOptions, signal?: AbortSignal): Promise<string>
}

export declare function apply(ctx: Context, config: TavilyConfig): void

export {}
