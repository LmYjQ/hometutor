# hometutor-backend

NAS 自建后端，目标是平移 `miniapp/cloudfunctions/` 下 15 个云函数。

## 技术栈

| 层 | 选型 | 理由 |
| --- | --- | --- |
| 运行时 | Node.js 20 LTS | 与原云函数同语言，零摩擦 |
| 框架 | Fastify + TypeScript | 性能好 + 类型友好；Fastify 插件生态比 Express 丰富 |
| ORM | Prisma | 自动迁移 + 强类型 |
| 数据库 | PostgreSQL 16 | 原 NoSQL 6 集合全是关系数据，PG 比文档库更合适 |
| 对象存储 | MinIO（阶段 3） | S3 兼容，预签名 URL 让小程序绕过 API server 直传 |
| 隧道 | Cloudflare Tunnel | 零证书管理 + 免费 CDN/DDoS |
| 反代 | Caddy（阶段 3，Full Strict 用） | 自动 HTTPS |
| 编排 | Docker Compose | 一键启停 |

## 目录结构（计划）

```
backend/
├── docker-compose.yml          # postgres + api + cloudflared (+ minio 阶段3)
├── Dockerfile                # api 容器构建
├── .env.example              # 环境变量模板（git 跟踪）
├── .env                      # 实际值（git 忽略）
├── .gitignore
├── package.json
├── tsconfig.json
├── prisma/
│   ├── schema.prisma         # 6 张表
│   ├── migrations/           # prisma migrate 生成
│   └── seed.ts               # initDatabase 脚本
├── scripts/
│   └── migrate-from-cloudbase.ts  # 一次性 ETL（NoSQL → PG）
└── src/
    ├── server.ts             # Fastify 入口
    ├── config.ts             # 读环境变量 + 校验
    ├── plugins/
    │   ├── db.ts             # Prisma client 注入
    │   └── auth.ts           # JWT 鉴权中间件
    ├── routes/
    │   ├── health.ts         # GET /health
    │   ├── auth.ts           # POST /api/auth/login
    │   ├── classes.ts        # /api/classes/*
    │   ├── assignments.ts    # /api/assignments/*
    │   ├── submissions.ts    # /api/submit-recitation
    │   ├── profile.ts        # /api/profile
    │   ├── batches.ts        # /api/batches/*
    │   ├── students.ts       # /api/classes/students
    │   ├── init.ts           # /api/init-database
    │   └── debug.ts          # /api/debug/{speech,llm}
    ├── lib/
    │   ├── wechat.ts         # code2Session 封装
    │   ├── jwt.ts            # JWT 签发/校验
    │   ├── siliconflow.ts    # ASR + LLM 调用
    │   ├── cloudbase.ts      # 阶段 1 仍需的 CloudBase SDK 封装
    │   └── errors.ts         # createError + 全局 handler
    └── utils/
        └── crypto.ts         # JWT_SECRET 生成等
```

## 与 CloudBase 的关系

### 阶段 1（业务迁过来，视频不动）
- **后端用 `@cloudbase/node-sdk`**：`cloud.getTempFileURL` 下载视频、`cloud.deleteFile` 清理
- **后端不用 `wx-server-sdk`**：自己接 `code2Session` + JWT
- **小程序 `wx.cloud.uploadFile` 仍可用**：视频 fileID 仍是 CloudBase 存储的

### 阶段 2（数据库迁过来）
- 15 个云函数全部平移为 HTTP endpoint
- 后端不再需要 CloudBase SDK
- 但 `submissions.videoFileId` 字段还是 CloudBase fileID（除非重新上传）

### 阶段 3（视频迁过来）
- 后端用 MinIO SDK 替代 CloudBase SDK
- 小程序 `wx.uploadFile` 直传 MinIO（用预签名 URL）
- `videoFileId` 改为 MinIO objectKey
- 视频保留 30 天后由 cron 清理

## 部署架构

```
┌────────────────┐    HTTPS (Tunnel)    ┌─────────────────┐
│ 微信小程序       │ ◄──────────────────► │ Cloudflare Edge │
└────────────────┘                        └────────┬─────────┘
                                                     ▼
                                          ┌─────────────────┐
                                          │  NAS (Docker)    │
                                          │                  │
                                          │  ┌────────────┐  │
                                          │  │ Fastify+TS │  │ ──► SiliconFlow
                                          │  │  (API)     │  │     (ASR + LLM)
                                          │  └─────┬──────┘  │
                                          │        │         │
                                          │  ┌─────┴──────┐  │
                                          │  │  Postgres  │  │
                                          │  └────────────┘  │
                                          │  ┌────────────┐  │
                                          │  │   MinIO    │  │  (阶段 3)
                                          │  └────────────┘  │
                                          └─────────────────┘
```

## 开发流程

```bash
# 1. 启动依赖
docker compose up -d postgres cloudflared

# 2. 跑 Prisma 迁移
npx prisma migrate dev

# 3. 启动 API（本地热重载）
npm run dev

# 4. 跑 ETL 把 NoSQL 数据迁到 Postgres（仅阶段 2）
npm run migrate:from-cloudbase -- --dry-run  # 先看条数
npm run migrate:from-cloudbase               # 真跑

# 5. 部署到 NAS
git push origin experiment/nas-migration
# 然后在 NAS 上：
git pull && docker compose up -d --build
```

## 文档

- [`docs/DOMAIN_SETUP.md`](docs/DOMAIN_SETUP.md) — 域名 + Cloudflare Tunnel 全流程
- [`docs/PHASE_1_PLAN.md`](docs/PHASE_1_PLAN.md) — 阶段 1 实施计划（含完整代码骨架）

## 安全

- **AppSecret 走 `.env`**（`.gitignore` 覆盖）
- **API Key 走 `.env`**（SiliconFlow 同理）
- **JWT_SECRET ≥32 字节随机**
- **错误日志记录 openid 但绝不记录 session_key**
- 详见 [`docs/PHASE_1_PLAN.md`](docs/PHASE_1_PLAN.md) 的"安全清单"