/**
 * dsh-tavily-web-search, node half — the Tavily search provider with a
 * settings-backed API key. The `dsh.client` declaration on this package serves
 * the browser half (`lib/client.js`) through the client module system.
 */

export {
  TAVILY_PROVIDER_ID,
  WEB_SEARCH_TAVILY_SETTINGS_NAMESPACE,
  Config,
  TavilySearchProvider,
  apply,
  inject,
  name,
} from '../lib/index.js'
