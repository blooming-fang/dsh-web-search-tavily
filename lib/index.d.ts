/** Type declarations for dsh-web-search-tavily. */
import type { Context } from '@deepseek-ai/cordis'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import type z from '@deepseek-ai/schemastery'

export declare const TAVILY_PROVIDER_ID: 'tavily'
export declare const WEB_SEARCH_TAVILY_SETTINGS_NAMESPACE: string
export declare const TAVILY_USAGE_PATH: string
export declare const name: string
export declare const inject: string[]

export interface TavilyKeyConfig {
  id: string
  name: string
  ref: string
  enabled?: boolean
}

export declare const Config: z<{
  keys?: TavilyKeyConfig[]
  endpoint?: string
  searchDepth?: string
  maxResults?: number
  timeoutMs?: number
}>

export interface TavilySearchOptions {
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

export declare function apply(ctx: Context, config?: Partial<{
  keys: TavilyKeyConfig[]
  endpoint: string
  searchDepth: string
  maxResults: number
  timeoutMs: number
}>): void

export {}
