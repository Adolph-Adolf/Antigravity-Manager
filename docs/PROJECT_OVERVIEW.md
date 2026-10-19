# 项目理解总览（Antigravity Tools）

> 本文件为「读懂本仓库」的研究笔记，基于当前 HEAD 源码与 git 历史整理。
> 记录时间：HEAD = `675b98d`（`fix(ci): 修正发布步骤 find 的转义括号`），版本 `4.7.6`。
> 每条结论后标注来源（文件路径 / git 提交）。

---

## 1. 一句话定位

**Antigravity Tools** 是一个 **Tauri 桌面应用**，把 Google / Anthropic 的 **Web 端 Session（OAuth 凭证）** 转成标准 API 中继，对外暴露 OpenAI / Anthropic / Gemini 四套协议，并附带多账号矩阵管理、配额监控、模型路由、限流与代理池等运维能力。

- 来源：`README.md`（"本地 AI 协议中继"、"将 Web 端 Session (Google/Anthropic) 转化为标准化 API 接口"）
- 来源：`package.json`、`src-tauri/Cargo.toml`（`name = "antigravity-tools"`, `version = "4.7.6"`）

## 2. 仓库溯源（git 历史）

| 项 | 值 | 来源 |
| --- | --- | --- |
| origin | `https://github.com/Adolph-Adolf/Antigravity-Manager.git` | `git remote -v` |
| 上游 | `lbjlaq/Antigravity-Manager` | `README.md` 开头 |
| 总提交数 | 933 | `git rev-list --count HEAD` |
| 首个提交 | `94a8b06` 2026-01-26（v4.0.0） | `git log --reverse` |
| 当前 HEAD | `675b98d` 2026-09-19（v4.7.6） | `git log -1` |
| 主要贡献者 | lbjlaq 626、new-Beginner 31、buluw 16、诺墨 16、AdolphJau 11 | `git shortlog -sn` |
| fork 基线 | 上游 v4.7.5 = `0840203` | `README.md` / `git tag` |

**结论**：这是一个**上游 fork（自用分支）**，主体功能来自上游；`AdolphJau` 的 11 个提交是"本分支相对上游的改动"（见第 8 节）。

## 3. 技术栈

**桌面外壳 / 后端（Rust + Tauri 2）** —— `src-tauri/Cargo.toml`
- `tauri 2.2.5`（含 `tray-icon`、`single-instance` 深链、`autostart`、`updater`、`window-state`、`process`、`dialog`、`fs`、`opener` 插件）
- HTTP 服务：`axum 0.7` + `hyper 1` + `tower-http`
- 异步：`tokio`、`futures`、`async-stream`、`eventsource-stream`
- 存储：`rusqlite 0.32`（bundled SQLite）
- 上游请求：同时依赖 `reqwest 0.12` 与 `rquest 5.1`（指纹浏览器网络栈）；`reqwest 0.13` 别名供 updater 用
- 其他：`aes-gcm`、`sha2`、`flate2`、`image`、`plist`、`machine-uid`、`sysinfo`

**前端（React 19 + Vite 7 + TypeScript）** —— `package.json`
- 路由 `react-router 7`；状态 `zustand 5`
- UI：`antd 5` + `@lobehub/ui` + `tailwindcss 3` + `daisyui 5` + `framer-motion`
- 图表 `recharts`；虚拟滚动 `@tanstack/react-virtual`（大报文日志优化）
- 国际化 `i18next` / `react-i18next`，12 种语言（`src/locales/*.json`）

## 4. 目录结构

```
Antigravity-Manager/
├── src/                    前端 (React)
│   ├── pages/              8 个页面：Dashboard/Accounts/ApiProxy/Monitor/
│   │                       TokenStats/UserToken/Security/Settings
│   ├── components/         accounts/ proxy/ dashboard/ settings/ layout/ debug/ ...
│   ├── stores/             zustand stores
│   ├── services/           accountService / configService
│   ├── locales/            12 语言包
│   └── utils/request.ts    ★ 统一调用层：Tauri invoke ↔ HTTP /api 双模式
├── src-tauri/              后端 (Rust)
│   ├── src/
│   │   ├── commands/       Tauri 命令（proxy / security / user_token / patch / autostart）
│   │   ├── modules/        业务域：account / quota / db / proxy_db / scheduler /
│   │   │                   security_db / token_stats / user_token_db / oauth / tray /
│   │   │                   migration / update_checker / cloudflared ...
│   │   ├── proxy/          ★ API 反代服务（约 10 万行 Rust 的主力）
│   │   ├── models/         account / config / quota / token
│   │   └── utils/          command / crypto / fs / http / protobuf / win_shortcut
│   ├── tauri.conf.json     identifier=com.adolphjau.antigravity-tools, version=4.7.6
│   └── Cargo.toml
├── docker/                 Headless（无 GUI）部署方案
├── docs/                   开发者文档（见 docs/README.md 索引）
├── deploy/arch/            Arch Linux 打包
├── workflows/ + .github/   CI / Pages / Release
└── web_site/               项目宣传静态页
```

来源：`ls` 各目录、`src/App.tsx`（路由表）、`src-tauri/src/lib.rs`（mod 声明）

## 5. 运行时架构

### 5.1 双形态：GUI 模式 vs Headless 模式
- **GUI**：Tauri 窗口 + 前端 React；前端通过 `@tauri-apps/api` 的 `invoke` 调 Rust 命令。
- **Headless（Docker）**：同一二进制以 `--headless` 启动（`docker/Dockerfile.backend` 的 `ENTRYPOINT`），静态资源由 `ABV_DIST_PATH` 指定，浏览器访问管理后台。
- 关键桥接：`src/utils/request.ts` 用 `COMMAND_MAPPING` 把每个 Tauri command 映射成 `/api/...` HTTP 路由，实现"桌面 / Web 共用一套前端"。
- 默认端口 **8045**（`docker/Dockerfile.backend` `ENV PORT=8045`、README）。

### 5.2 请求主链路（API 反代）
```
客户端 (Claude Code / OpenAI SDK / Gemini SDK / Codex)
   │  OpenAI /v1/chat/completions · /v1/responses
   │  Anthropic /v1/messages        · Gemini /v1beta/models/*
   ▼
Axum Server (src-tauri/src/proxy/server.rs)
   ▼ 中间件洋葱：ip_filter → auth → monitor   (proxy/middleware/)
   ▼ handlers/  (openai.rs 7.4k 行 / claude.rs / gemini.rs / audio.rs / mcp.rs)
   ▼ mappers/   协议转换（openai/ claude/ gemini/ + 公共 cleaner / compressor）
   ▼ token_manager.rs  账号选择、限流、429/401 自动重试轮换
   ▼ upstream/client.rs  出站到 Google / Anthropic / z.ai
   ▼ 响应反向映射 + SSE 流式 + 用量统计 (monitor.rs / token_stats)
   ▼ 落库 proxy_db.rs（报文审计、日志、限流记录）
```
来源：`src-tauri/src/proxy/server.rs` 路由段（约 L618–960）、`proxy/mod.rs`、`proxy/handlers/`、`proxy/mappers/`、`proxy/upstream/`

### 5.3 统一 Pipeline（v4.7.4 引入）
`src-tauri/src/proxy/pipeline/` 是较新的"统一中间领域对象"层：
- `canonical.rs`：Canonical IR，以 **Gemini 标准报文**（`contents` + `generationConfig`）为中间表示
- `inbound.rs` / `outbound.rs` / `events.rs` / `policy.rs` / `usage.rs`
- 目标：把四大协议（OpenAI Chat、Anthropic、OpenAI Responses、Gemini Native）抹平，统一思考链回填与用量换算。
- 来源：`proxy/pipeline/mod.rs` 头注释；`CHANGELOG.md` v4.7.4

## 6. 后端模块详解

### 6.1 `proxy/`（核心，~10 万行）
| 子模块 | 职责 |
| --- | --- |
| `server.rs` (4.4k) | Axum 路由装配：AI 代理路由 + 管理路由（admin）+ 静态资源 |
| `handlers/` | 端点处理器：`openai.rs`(7.5k)、`claude.rs`、`gemini.rs`、`audio.rs`、`mcp.rs`、`thinking.rs`、`warmup.rs` |
| `mappers/` | 协议双向转换：`openai/` `claude/` `gemini/` + `caveman_cleaner` `prompt_sanitizer` `rtk_cleaner` `tool_result_compressor` `context_manager` `signature_store` |
| `pipeline/` | 统一 IR 与流式事件（见 5.3） |
| `token_manager.rs` (5.4k) | 账号调度：轮询 / 权重 / 粘性会话 / 429 熔断切换 |
| `upstream/` | 出站客户端与重试（`client.rs` `retry.rs` `models.rs`） |
| `middleware/` | `auth` `cors` `ip_filter` `logging` `monitor` `service_status` |
| `adapters/` | 工具调用适配：`apply_patch_preflight` `apply_patch_trace` `artifact_store` |
| `thinking_store.rs` (2.5k) | 服务端思考链持久化（L1 DashMap + L2 `thinking_store.db`，AGZ1 gzip 压缩） |
| `signature_cache.rs` / `cache_manager.rs` | `thoughtSignature` 缓存、Context Cache 前缀哈希→cache_id |
| `rate_limit.rs` / `sticky_config.rs` / `session_manager.rs` | 限流跟踪、粘性调度、会话指纹 |
| `monitor.rs` / `payload_audit.rs` / `debug_logger.rs` | 监控打点、报文脱敏审计、调试日志桥 |
| `providers/` | 第三方上游（`zai_anthropic.rs`，z.ai/GLM Anthropic 兼容直通） |
| `zai_vision_mcp.rs` / `zai_vision_tools.rs` | 内置 Vision MCP Server（Search / Reader / Vision） |
| `cli_sync.rs` / `opencode_sync.rs` / `droid_sync.rs` | 向 Claude Code / OpenCode / Droid 写配置 |
| `proxy_pool.rs` / `config.rs` / `security.rs` | 代理池、配置模型、安全配置 |

### 6.2 `modules/`（业务域）
`account.rs`(2.5k) 账号与凭证、`db.rs` 读 Antigravity 原生 `state.vscdb`、`proxy_db.rs`(1.6k) 反代库、`token_stats.rs` 用量、`quota.rs` 配额、`security_db.rs` IP 黑白名单、`user_token_db.rs` 用户令牌、`scheduler.rs` 定时刷新、`oauth*.rs` OAuth 授权、`migration.rs` 版本迁移、`update_checker.rs` 更新检查、`cloudflared.rs` 内网穿透、`tray.rs` 托盘。
来源：`ls src-tauri/src/modules`

### 6.3 对外 API 端点（节选）
- **OpenAI**：`/v1/models`、`/v1/chat/completions`、`/v1/completions`、`/v1/responses`（含 WebSocket，兼容 Codex CLI）、`/responses/compact`、`/v1/images/generations`、`/v1/images/edits`、`/v1/audio/transcriptions`
- **Anthropic**：`/v1/messages`、`/v1/messages/count_tokens`、`/v1/models/claude`
- **Gemini**：`/v1beta/models`、`/v1beta/models/:model`(GET/POST)、`/v1beta/models/:model/countTokens`
- **MCP（z.ai）**：`/mcp/web_search_prime/mcp`、`/mcp/web_reader/mcp`、`/mcp/zai-mcp-server/mcp`
- **Thinking**：`/v1/thinking/end`、`/v1/thinking/sessions/:session_id`
- **管理 API**：`/api/accounts/*`、`/api/stats/*`、`/api/logs/*`、`/api/config`、`/api/proxy/*`、`/api/security/*`、`/api/system/updates/*`、`/api/debug/*` 等（`server.rs` L618 起）
- 来源：`src-tauri/src/proxy/server.rs`

## 7. 前端结构

- 路由（`src/App.tsx`）：`/`=Dashboard、`/accounts`、`/api-proxy`、`/monitor`、`/token-stats`、`/user-token`、`/security`、`/settings`；外层 `Layout` + `AdminAuthGuard`。
- 状态（`src/stores/`）：`useConfigStore`、`useAccountStore`、`useViewStore`、`useDebugConsole`、`networkMonitorStore`。
- 最大的页面文件：`ApiProxy.tsx`(2.9k)、`ProxyMonitor.tsx`(2.0k)、`Settings.tsx`(1.8k)、`Accounts.tsx`(1.3k)。
- 事件：监听 `tray://account-switched`、`tray://refresh-current`、`accounts://refreshed` 等 Tauri 事件刷新 UI。
- 来源：`src/App.tsx`、`ls src/stores`、文件行数统计

## 8. 本分支（fork）相对上游 v4.7.5 的改动

**总计**：`git diff --stat 0840203 HEAD` = 55 文件，+588 / −1833（其中删除 `src/pages/ApiKeyFun.tsx` 824 行）。
`AdolphJau` 的 11 个提交：`ae72166 46ea0f0 9ad8a9e e2e3f33 16cfb16 5d1126d bba055f a054d05 4786317 18eeb56 675b98d`。

1. **`/v1/models` 系列改按「模型目录」返回**
   - 三个列表端点（`/v1/models`、`/v1/models/claude`、`/v1beta/models`）从 76 条别名改为 **17 条规范名**，共用唯一出口 `get_catalog_models`。
   - 旧函数 `get_supported_models` / `get_all_dynamic_models` 被 `#[allow(dead_code)]` 保留以便回滚。
   - 来源：`src-tauri/src/proxy/common/model_mapping.rs`、`proxy/config.rs`（`ModelCatalogEntry`、`DEFAULT_MODEL_CATALOG_IDS`）、提交 `46ea0f0` / `9ad8a9e`
2. **模型级启用 / 禁用开关**：API 反代页「支持模型与集成」表格新增开关，禁用即不出现在列表接口，保存即时生效（只影响列表，不影响路由）。来源：`proxy/config.rs`、`src/pages/ApiProxy.tsx`、提交 `46ea0f0`
3. **移除「中转站」推广页**：删除页面、导航项及 12 个语言包文案（`src/pages/ApiKeyFun.tsx` 删除）。来源：提交 `ae72166`、`git diff`
4. **更新链路自持**：`update_checker.rs` 的 GitHub API / Raw / jsDelivr / updater.json / release 链接全部指向 `Adolph-Adolf/Antigravity-Manager`；`tauri.conf.json` 的 updater endpoint 与 pubkey 改为本仓库自签密钥。来源：`git diff 0840203 HEAD -- src-tauri/src/modules/update_checker.rs`、`tauri.conf.json`、提交 `e2e3f33 18eeb56`
5. **应用标识**：identifier 改为 `com.adolphjau.antigravity-tools`（与上游 `com.lbjlaq.*` 可共存）；数据目录仍 `~/.antigravity_tools`。来源：`tauri.conf.json`、`README.md`、提交 `16cfb16`
6. **发布范围收窄**：CI 只保留 `release.yml`，仅 Windows 安装包 + 多架构 GHCR 镜像。来源：`README.md`、提交 `bba055f 5d1126d`

## 9. 安装 / 运行 / 发布

- **Windows**：NSIS / MSI 安装包（`src-tauri/installer.nsi`、Releases）。
- **Docker（推荐 NAS/服务器）**：`docker/Dockerfile`（完整构建）与 `docker/Dockerfile.backend`（后端-only + 复用前端 `dist/`），多架构镜像推 GHCR。
- **鉴权优先级**：环境变量 `ABV_WEB_PASSWORD`/`WEB_PASSWORD` > `gui_config.json` 的 `admin_password` > 回退 `API_KEY`。来源：`README.md`
- **CI**：`.github/workflows/ci.yml`（Rust 检查/格式化）、`release.yml`、`deploy-pages.yml`；`workflows/` 为同名副本。

## 10. 数据与存储

- **数据根目录**：`~/.antigravity_tools`（`src-tauri/src/modules/account.rs` 的 `DATA_DIR` = `.antigravity_tools`），可用 `.antigravity_tools_location` 指针文件重定向。
- **配置**：`gui_config.json`（`gui_config` 中的 `proxy` 对象，含 `api_key` / `admin_password`）。
- **SQLite 库**（`rusqlite`）：主代理库（`proxy_db.rs`，报文/日志/限流）、`thinking_store.db`（思考链）、账号库、`security_db`、`user_token_db`。
- **读取上游原生库**：从 Antigravity IDE 的 `state.vscdb` 热迁移账号（`modules/db.rs`、`migration.rs`）。

## 11. 文档约定

- `docs/README.md` 是**开发者文档索引**，按主题分子目录：`proxy/`（鉴权、账号生命周期）、`zai/`（z.ai/GLM 集成、MCP）、`testing/`、`images/`，另有若干专项 md（`API_REFERENCE.md`、`model-remapping-logic.md`、`proxy-monitor-technical.md` 等）。
- 仓库根另有非文档型笔记：`IDEA.md`（"修改自用版 antigravitymanager"）、`request_transform.md`（Codex → Gemini 报文转换图）、`diff_output.txt`（一份 UTF-16 的 patch 转储，属临时/游离产物）。

## 12. 建议阅读路线

1. `README.md` → `CHANGELOG.md`（功能全貌与近期演进）
2. `src-tauri/src/lib.rs`（应用启动）→ `proxy/server.rs` L600–960（路由全景）
3. `proxy/mod.rs` → `proxy/handlers/openai.rs`（入口）→ `proxy/mappers/openai/`
4. `proxy/token_manager.rs`（调度核心）→ `proxy/upstream/client.rs`（出站）
5. `proxy/pipeline/`（统一 IR）与 `proxy/thinking_store.rs`（思考链）
6. `src/App.tsx` → `src/utils/request.ts`（前端如何同时支持桌面与 Web）

---

### 附：关键代码热点（行数，`wc -l`）
`proxy/handlers/openai.rs` 7459 · `proxy/token_manager.rs` 5435 · `proxy/server.rs` 4396 · `proxy/opencode_sync.rs` 3870 · `proxy/mappers/claude/request.rs` 3670 · `proxy/mappers/openai/request.rs` 2866 · `proxy/handlers/claude.rs` 2677 · `modules/account.rs` 2530 · `proxy/thinking_store.rs` 2552
