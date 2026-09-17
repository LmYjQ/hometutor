# 家校背诵助手 · NAS 自建后端实验

> **⚠️ 这是实验分支** `experiment/nas-migration`，不要把实验中的代码直接 merge 回 `main`。
>
> 原 CloudBase 云函数继续在 `miniapp/`（main 分支）维护，可独立运行；本目录用于验证"全部迁到 NAS 自建后端"的可行性。

## 目标

把原 15 个 CloudBase 云函数逐步迁移到 NAS 上的自建后端（Node.js + Fastify + PostgreSQL），通过 Cloudflare Tunnel 暴露 HTTPS 给小程序调用。

## 为什么

| 痛点 | NAS 自建的解 |
| --- | --- |
| CloudBase 个人版 SCF 256MB 内存上限 | 自建后端内存自由配 |
| 90 秒超时不够长视频 ASR+LLM | 自建可配 5-10 分钟 |
| 视频存储成本高 | 阶段 3 切 MinIO 自托管 |
| 想学全栈 DevOps | 这套迁移打通客户端/服务端/数据库/部署 |
| 想脱离单一云厂商 | 业务 + 数据全在自己机器 |

## 分阶段

| 阶段 | 范围 | 状态 |
| --- | --- | --- |
| 0. 准备工作 | 域名、Cloudflare Tunnel、Tunnel token、微信合法域名 | 🔧 进行中 |
| 1. 后端 + Tunnel + 鉴权 | Fastify + Postgres + Docker Compose + `login` 端到端跑通；**视频仍走 CloudBase 存储** | ⏳ 待开始 |
| 2. 数据库迁移 | NoSQL 6 集合 → Postgres + Prisma；15 个云函数全部平移为 HTTP endpoint | ⏳ 待开始 |
| 3. 视频迁 MinIO | `wx.uploadFile` 直传 MinIO；视频保留 30 天清理 | ⏳ 待开始 |

详见 [`backend/docs/PHASE_1_PLAN.md`](backend/docs/PHASE_1_PLAN.md)。

## 目录结构

```
miniapp-nas/                    # 本目录
├── README.md                   # 本文件
├── cloudfunctions/             # ⚠️ 保留原样，阶段 2/3 迁完才删
├── miniprogram/                # 小程序前端，改 wx.cloud.callFunction → request
├── backend/                    # 新后端代码（当前只有 docs/）
│   ├── docs/
│   │   ├── DOMAIN_SETUP.md     # 域名 + Cloudflare Tunnel 接入全流程
│   │   └── PHASE_1_PLAN.md     # 阶段 1 实施计划
│   └── README.md               # 后端总览
├── seed_data/
└── project.config.json         # 微信开发者工具配置
```

## 与原 `miniapp/`（main 分支）的关系

| 维度 | `miniapp/` (main) | `miniapp-nas/` (experiment) |
| --- | --- | --- |
| CloudBase 云函数 | ✅ 主力运行 | ⚠️ 保留可调用，作为回滚兜底 |
| 后端 API | ❌ 无 | ✅ Fastify（阶段 1 起） |
| 数据库 | CloudBase NoSQL | CloudBase NoSQL + 本地 Postgres（双写期） |
| 视频存储 | CloudBase 存储 | 阶段 1 仍用 CloudBase，阶段 3 切 MinIO |
| Tunnel | 无 | 阶段 1 起 |

## 切换灰度

阶段 1 完成后，前端代码里有一个全局开关：

```javascript
// miniprogram/app.js
globalData.useNasApi = false  // 默认 false 走老路径；true 切到 NAS 后端
```

出问题立即回滚，无需改后端。

## 快速开始

1. **买域名**：见 [`backend/docs/DOMAIN_SETUP.md`](backend/docs/DOMAIN_SETUP.md) 第 1 节
2. **建后端**：见 [`backend/docs/PHASE_1_PLAN.md`](backend/docs/PHASE_1_PLAN.md)
3. **小程序切项目**：微信开发者工具导入 `miniapp-nas/` 而不是 `miniapp/`

## 后续

每个阶段跑稳 1-2 周再进下一个，**全程保留 CloudBase 回滚能力**。