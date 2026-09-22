# dsh-tavily-web-search

Tavily 支持的 `WebSearchProvider`，用于 DeepSeek Harness 的 web 能力缝（`ctx.web`）。

它把模型侧 `web_search` 工具的后端从 **DeepSeek 官方搜索** 换成 **Tavily** —— 每次搜索直接调用 `POST https://api.tavily.com/search`，不再走 DeepSeek API（不再消耗 DeepSeek 的模型 token/配额）。**其他一切不变**：`web_search` / `web_fetch` 工具照旧，LLM、会话等不受影响。

> 当前版本适配 **DSH 0.1.7-alpha.1**（`@deepseek-ai/dsh-*` 0.1.7 / `@deepseek-ai/cordis` 4.0.3）。

## 特性

- **多 Key 池**：在 Web 设置页添加、重命名、替换、启停和删除多个 Tavily API Key。
- **轮询搜索**：搜索在「启用且已配置」的 Key 之间轮询（round-robin）；被停用的 Key 不参与搜索。
- **用量查询**：每个 Key 均可点击「查询用量」，调用 Tavily 官方 `GET /usage` 读取**实时积分用量**，界面显示 **已用 / 总量** 和进度条（如 `79 / 1000 积分`）。
  - 停用的 Key 仍可查询用量，只是不参与搜索。
- **凭据安全**：Key 值通过凭据服务（`ctx.credentials`）存储，**永不写入配置文件，也不会返回浏览器**；配置里只保存 Key 的显示名称、生成的凭据引用和启用状态。
- **超时保护**：`timeoutMs` 会与调用方的取消信号合并，超时报中文错误。
- **中文报错/提示**：插件产生的错误与提示均为中文，便于排查。

## 工作原理

- 插件导出一个 `Config` schema 和一个 `apply`，注册 id 为 `tavily` 的 `WebSearchProvider`（通过 `ctx.web.registerSearchProvider`）。
- bundle patch 把 `web` 服务的 `searchProvider` 从 `deepseek-official` 改为 `tavily`，并插入本插件的行 `web-search-tavily`。
- 每次 `web_search` 调用 → 直接向 Tavily REST API 发请求 → 结果映射为 DSH 标准 `WebSearchResult`（url / title / snippet / publishedAt）。
- 模型侧的 `web_search` 工具本身（`@deepseek-ai/dsh-tool-web`）**完全不动**，所以模型看到的能力没有任何变化。

### DSH 0.1.7 的配置模型

0.1.7 取消了「插件注册设置命名空间」的旧模型（`ctx.settings.installSection` / `ctx.settingsScope`）：

- **插件自己的 `Config` 就是配置界面**。配置服务的 `describe()` 按 profile 行 id 暴露每个插件条目的 schema 与实时取值，浏览器端用 `ctx.configForms.get('<行 id>')` 拿到共享表单。
- 因此**行 id = 设置命名空间**：本插件的行 id 是 `web-search-tavily`，客户端 `TAVILY_NS` 与之一致。
- 只有声明为 `.volatile()` 的字段才会被渲染为可编辑项，并且**每次操作都读取实时值**（无需重启、无需重挂插件）。
- 保存走 `mutate(ops, revision)` 的**路径写入 + 版本栅栏**，一次保存是一次原子写入。
- 本插件自己提供设置页面，所以 `apply` 里调用 `ctx.settings.configure({ auto: false }, ctx.fiber)`，避免配置服务再自动生成一个重复的页面。

## API Key 配置（推荐：Web 设置页）

配置路径：**设置 → Tavily 搜索**（`settings.section` 槽位，与「飞书通知」同级）。API Key 池为空或全部停用时，搜索不可用。

- 支持添加、重命名、替换、启停和删除多个 API Key；搜索在启用且已配置的 Key 之间轮询。
- Key 是只写控件：通过凭据服务（`ctx.credentials`）存储，永不写入配置文件，也不会返回浏览器。
- 每个 Key 可以按需调用 Tavily 官方 `GET /usage` 查询实时积分用量、上限和搜索用量。
- 同时可以配置 **接口地址 / 搜索深度 / 最大结果数**，下一次搜索立即生效。

## 安装

### 1. 打包

```bash
npm install
npm run build      # 生成 lib/client.js
npm pack           # 生成 dsh-tavily-web-search-<version>.tgz
```

### 2. 装进 profile

把 tgz 安装为 profile 的依赖，并**加入 bundle 列表**（否则插件的 `cordis.patch.yml` 不会生效）：

```bash
cd "$DSH_HOME/profiles/web"
pnpm add file:/path/to/dsh-tavily-web-search-0.7.0.tgz
```

`package.json`：

```jsonc
"dsh": {
  "profile": {
    "bundles": [
      "@deepseek-ai/dsh-base",
      "@deepseek-ai/dsh-web-app",
      "dsh-tavily-web-search"   // ← 新增，放在 dsh-web-app 之后
    ]
  }
}
```

### 3. 迁移旧 Key 池（从 0.6.x 升级时）

0.6.x 的 Key 池存在旧的 `$DSH_HOME/settings.yaml` 里，0.1.7 已不再读取该文件。把该 section 原样搬进 profile 的 `cordis.patch.yml`（凭据引用不变，因此已存的密钥继续可用）：

```yaml
- id: web-search-tavily
  name: dsh-tavily-web-search
  config:
    keys:
      - id: mth3iduzu7kb77
        name: 我的
        ref: TAVILY_API_KEY_MTH3IDUZU7KB77
        enabled: false
```

### 4. 重启生效

重启 `dsh web`。此后模型侧每次 `web_search` 都会走 Tavily。

## 配置项

| 键 | 默认值 | 含义 |
|---|---|---|
| `keys` | `[]` | API Key 池的非敏感元数据；Key 值存储在凭据服务中 |
| `endpoint` | `https://api.tavily.com/search` | Tavily 搜索端点 |
| `searchDepth` | `advanced` | 搜索深度：`basic` / `advanced` |
| `maxResults` | `8` | 每次搜索返回的最大结果数 |
| `timeoutMs` | `30000` | 单次请求超时（毫秒），与调用方取消信号合并 |

## 验证

安装并重启后，让模型做一次 `web_search`（例如查一个时效性问题）。如果调用成功，说明已走 Tavily；失败时错误信息为中文且以 `Tavily ...` 开头。

## 文件

```
dsh-tavily-web-search/
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
│       ├── service.ts    # TavilyTabController（共享表单 + 凭据/用量管理）
│       ├── TavilyTab.tsx # 设置页 Tavily 卡片 UI
│       ├── TavilyTab.module.css
│       └── locales.ts    # 中英文案（settings.tavily 命名空间）
├── scripts/
│   ├── build.mjs         # 构建包装（Windows 代码页处理）
│   ├── verify-bundle.mjs # bundle 静态检查（handoff / 平台模块 / 无旧 API）
│   ├── verify-client.mjs # 浏览器半运行时检查（注册、渲染、表单写入、Key 池）
│   ├── smoke.mjs         # host 半集成测试（真实 web 缝 + webserver + 路由）
│   └── test-search.mjs   # 真实 Tavily 搜索/用量探测（需要真实凭据）
├── tsdown.config.ts      # 浏览器 bundle 配置（CSS Modules 内联）
└── README.md
```

## 开发

```bash
npm install
npm run typecheck   # tsc -p tsconfig.typecheck.json
npm run build       # tsdown → lib/client.js
npm run verify      # bundle 静态检查 + 浏览器半运行时检查 + host 半集成测试
npm pack
```

## License

[MIT](./LICENSE)
