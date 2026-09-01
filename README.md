# dsh-web-search-tavily

Tavily 支持的 `WebSearchProvider`，用于 DeepSeek Harness 的 web 能力缝（`ctx.web`）。

它把模型侧 `web_search` 工具的后端从 **DeepSeek 官方搜索** 换成 **Tavily** —— 每次搜索直接调用 `POST https://api.tavily.com/search`，不再走 DeepSeek API（不再消耗 DeepSeek 的模型 token/配额）。**其他一切不变**：`web_search` / `web_fetch` 工具照旧，LLM、会话等不受影响。

## 特性

- **多 Key 池**：在 Web 设置页添加、重命名、替换、启停和删除多个 Tavily API Key。
- **轮询搜索**：搜索在「启用且已配置」的 Key 之间轮询（round-robin）；被停用的 Key 不参与搜索。
- **用量查询**：每个 Key 均可点击「查询用量」，调用 Tavily 官方 `GET /usage` 读取**实时积分用量**，界面显示 **已用 / 总量** 和进度条（如 `79 / 1000 积分`）。
  - 停用的 Key 仍可查询用量，只是不参与搜索。
- **凭据安全**：Key 值通过凭据服务（`ctx.credentials`）存储，**永不写入 `settings.yaml`，也不会返回浏览器**。`settings.yaml` 只保存 Key 的显示名称、生成的凭据引用和启用状态。
- **中文报错/提示**：插件产生的错误与提示均为中文，便于排查。

## 工作原理

- 注册一个 id 为 `tavily` 的 `WebSearchProvider`（通过 `ctx.web.registerSearchProvider`）。
- bundle patch 把 `web` 服务的 `searchProvider` 从 `deepseek-official` 改为 `tavily`，并插入本插件的行。
- 每次 `web_search` 调用 → 直接向 Tavily REST API 发请求 → 结果映射为 DSH 标准 `WebSearchResult`（url / title / snippet / publishedAt）。
- 模型侧的 `web_search` 工具本身（`@deepseek-ai/dsh-tool-web`）**完全不动**，所以模型看到的能力没有任何变化。

## API Key 配置（推荐：Web 设置页）

插件注册了一个 `web-search-tavily` 设置命名空间，并在 Web 设置页提供独立的 **Tavily 搜索** section：

配置路径：**设置 → Tavily 搜索**（与“飞书通知”同级）。API Key 池为空或全部停用时，搜索不可用。

- 支持添加、重命名、替换、启停和删除多个 API Key；搜索在启用且已配置的 Key 之间轮询。
- Key 是只写控件：通过凭据服务（`ctx.credentials`）存储，永不写入 `settings.yaml`，也不会返回浏览器。
- `settings.yaml` 只保存 Key 的显示名称、生成的凭据引用和启用状态。
- 每个 Key 可以按需调用 Tavily 官方 `GET /usage` 查询实时积分用量、上限和搜索用量。
- 同时可以配置 **接口地址 / 搜索深度 / 最大结果数**，下一次搜索立即生效。

## 安装

### 1. 安装插件

在 `dsh --profile web` 所在的环境，把本包安装为 profile 的 bundle：

```bash
# 在 profile 目录里安装本包（把 <path> 换成实际路径）
cd "$HOME/.dsh/profiles/web"
pnpm add file:/path/to/dsh-web-search-tavily
```

> 也可以用 `dsh plugin --profile web install` 完成安装，视你的 dsh 版本而定。

然后把 `dsh-web-search-tavily` 加入 `package.json` 的 `dsh.profile.bundles` 列表（放在 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 之后）：

```jsonc
"dsh": {
  "profile": {
    "bundles": [
      "@deepseek-ai/dsh-base",
      "@deepseek-ai/dsh-web-app",
      "dsh-web-search-tavily"   // ← 新增
    ]
  }
}
```

### 2. 配置 Tavily API Key 池

Web 设置页 → **Tavily 搜索** → **API Key 池**，可以添加、重命名、替换、启停和删除 Key。Key 值存储在凭据服务中，不会写入设置文件或返回到浏览器。

每个 Key 可以单独点击“查询用量”，读取 Tavily 官方实时数据，界面显示「已用 / 总量」和进度条。

### 3. 重启生效

重启 `dsh web`。此后模型侧每次 `web_search` 都会走 Tavily。

## 配置项

| 键 | 默认值 | 含义 |
|---|---|---|
| `keys` | `[]` | API Key 池的非敏感元数据；Key 值存储在凭据服务中 |
| `endpoint` | `https://api.tavily.com/search` | Tavily 搜索端点 |
| `searchDepth` | `advanced` | 搜索深度：`basic` / `advanced` |
| `maxResults` | `8` | 每次搜索返回的最大结果数 |
| `timeoutMs` | `30000` | 单次请求超时（毫秒） |

## 验证

安装并重启后，让模型做一次 `web_search`（例如查一个时效性问题）。如果调用成功，说明已走 Tavily；失败时错误信息为中文且以 `Tavily ...` 开头。

## 文件

```
dsh-web-search-tavily/
├── package.json          # 插件清单 + bundle patch + dsh.client 声明
├── cordis.patch.yml      # 把 searchProvider 指向 tavily 并插入插件行
├── lib/
│   ├── index.js          # TavilySearchProvider 实现（host 端，手写维护）
│   ├── index.d.ts        # 类型声明
│   ├── client.js         # 浏览器端 bundle：设置页 Tavily tab（tsdown 构建）
│   └── types/client/     # 客户端类型声明
├── src/
│   ├── index.ts          # node 入口（转出 lib/index.js）
│   └── client/           # 浏览器端源码（tsdown 构建）
│       ├── index.ts      # 客户端插件主体：注册 settings.section 槽位
│       ├── service.ts    # TavilyTabController（表单状态机 + 凭据/用量管理）
│       ├── TavilyTab.tsx # 设置页 Tavily 卡片 UI
│       ├── TavilyTab.module.css
│       └── locales.ts    # 中英文案（settings.tavily 命名空间）
├── scripts/              # build / smoke / test-search / verify-route / verify-real-env 等
├── tsdown.config.ts      # 浏览器 bundle 配置（CSS Modules 内联）
└── README.md
```

## 开发

```bash
pnpm install
pnpm run typecheck   # tsc -p tsconfig.typecheck.json
pnpm run build       # tsdown → lib/client.js
pnpm pack            # 打包 tarball
```

## License

[MIT](./LICENSE)
