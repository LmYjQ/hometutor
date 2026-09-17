# 阶段 1：后端 + Tunnel + 鉴权端到端跑通

> **目标**：把 `login` 这一个流程从 CloudBase 云函数迁到 NAS 自建后端，**端到端跑通**。
> 
> 完成此阶段 = 证明整套链路（Tunnel + Docker + Postgres + Fastify + code2Session + JWT + 小程序调用）可行，后续 14 个云函数照此平移。

## 验收清单

阶段 1 跑通 = 全部勾完下面：

- [ ] `docker compose up` 起 Postgres + Fastify 容器
- [ ] `curl http://localhost:3000/health` 返回 `{ok: true}`
- [ ] Cloudflare Tunnel 状态 HEALTHY
- [ ] `curl https://api.hometutor.top/health` 返回 `{ok: true}`
- [ ] Postgres 跑 Prisma migration，6 张表建好
- [ ] 微信公众平台合法域名已配
- [ ] `curl https://api.hometutor.top/api/auth/login` 用合法 code 拿到 JWT
- [ ] 小程序 `pages/login` 改完调自建后端能登录成功
- [ ] 全程保留 CloudBase 云函数可调用（灰度开关 `useNasApi = false`）

## 目录结构

阶段 1 完成时 `backend/` 长这样：

```
backend/
├── docker-compose.yml
├── Dockerfile
├── package.json
├── tsconfig.json
├── .env.example              # git 跟踪
├── .env                      # git 忽略（按 .env.example 复制填值）
├── .gitignore                # node_modules/ dist/ .env *.log
├── prisma/
│   └── schema.prisma         # 6 张表
└── src/
    ├── server.ts             # Fastify 入口
    ├── config.ts             # 读环境变量 + zod 校验
    ├── plugins/
    │   ├── db.ts             # Prisma client 注入
    │   └── auth.ts           # JWT 鉴权中间件
    ├── routes/
    │   ├── health.ts         # GET /health
    │   └── auth.ts           # POST /api/auth/login
    └── lib/
        ├── wechat.ts         # code2Session 封装
        ├── jwt.ts            # JWT 签发/校验
        └── errors.ts         # createError + 全局 handler
```

## Step 1：项目初始化

### 1.1 `package.json`

```json
{
  "name": "hometutor-backend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "typecheck": "tsc --noEmit",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:studio": "prisma studio"
  },
  "dependencies": {
    "@fastify/cors": "^9.0.1",
    "@fastify/rate-limit": "^9.1.0",
    "@prisma/client": "^5.20.0",
    "axios": "^1.7.7",
    "dotenv": "^16.4.5",
    "fastify": "^4.28.1",
    "fastify-plugin": "^4.5.1",
    "jsonwebtoken": "^9.0.2",
    "pino-pretty": "^11.2.2",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/jsonwebtoken": "^9.0.7",
    "@types/node": "^22.7.5",
    "prisma": "^5.20.0",
    "tsx": "^4.19.1",
    "typescript": "^5.6.3"
  }
}
```

### 1.2 `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "noImplicitAny": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": false,
    "sourceMap": true,
    "forceConsistentCasingInFileNames": true,
    "allowJs": false
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### 1.3 `.gitignore`

```gitignore
node_modules/
dist/
.env
*.log
.DS_Store
coverage/
.vscode/
```

### 1.4 安装依赖

```bash
cd backend
pnpm install   # 或 npm install
```

---

## Step 2：Prisma schema

### 2.1 `prisma/schema.prisma`

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ==================== 用户 ====================
model User {
  id        String   @id @default(cuid())
  openid    String   @unique
  unionid   String?  @unique
  role      Role
  name      String   @default("未命名")
  avatarUrl String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  taughtClasses    Class[]           @relation("TeacherClasses")
  classMemberships ClassMember[]
  authoredBatches  AssignmentBatch[] @relation("TeacherBatches")
  submissions      Submission[]      @relation("StudentSubmissions")

  @@index([role])
}

enum Role {
  teacher
  student
}

// ==================== 班级 ====================
model Class {
  id          String   @id @default(cuid())
  teacherId   String
  teacherName String
  name        String
  inviteCode  String   @unique
  createdAt   DateTime @default(now())

  teacher User           @relation("TeacherClasses", fields: [teacherId], references: [id], onDelete: Cascade)
  members ClassMember[]
  batches AssignmentBatch[]

  @@index([teacherId])
}

model ClassMember {
  id        String       @id @default(cuid())
  classId   String
  studentId String
  joinedAt  DateTime     @default(now())
  status    MemberStatus @default(ACTIVE)

  class   Class @relation(fields: [classId], references: [id], onDelete: Cascade)
  student User  @relation(fields: [studentId], references: [id], onDelete: Cascade)

  @@unique([classId, studentId])
  @@index([studentId])
}

enum MemberStatus {
  ACTIVE
  QUIT
}

// ==================== 作业批次 ====================
model AssignmentBatch {
  id              String      @id @default(cuid())
  classId         String
  className       String
  teacherId       String
  teacherName     String
  title           String
  assignmentCount Int         @default(0)
  status          BatchStatus @default(ACTIVE)
  createdAt       DateTime    @default(now())
  deletedAt       DateTime?

  class       Class @relation(fields: [classId], references: [id], onDelete: Cascade)
  teacher     User           @relation("TeacherBatches", fields: [teacherId], references: [id])
  assignments Assignment[]

  @@index([classId, status])
  @@index([teacherId])
}

enum BatchStatus {
  ACTIVE
  DELETED
}

// ==================== 作业 ====================
model Assignment {
  id            String           @id @default(cuid())
  batchId       String?
  classId       String
  className     String
  teacherId     String
  questionTitle String
  referenceText String           @db.Text
  deadline      DateTime?
  status        AssignmentStatus @default(ACTIVE)
  createdAt     DateTime         @default(now())

  batch       Batch?       @relation(fields: [batchId], references: [id])
  submissions Submission[]

  @@index([classId, status])
  @@index([batchId])
  @@index([teacherId])
  @@index([deadline])
}

enum AssignmentStatus {
  ACTIVE
  DELETED
}

// ==================== 提交 ====================
model Submission {
  id            String           @id @default(cuid())
  assignmentId  String
  studentId     String
  studentName   String
  avatarUrl     String?
  videoFileId   String?
  audioText     String?          @db.Text
  score         Int?
  comment       String?          @db.Text
  missingPoints String[]
  status        SubmissionStatus @default(PENDING)
  createdAt     DateTime         @default(now())

  assignment Assignment @relation(fields: [assignmentId], references: [id], onDelete: Cascade)
  student    User       @relation("StudentSubmissions", fields: [studentId], references: [id])

  @@index([assignmentId])
  @@index([studentId])
  @@index([status])
}

enum SubmissionStatus {
  PENDING
  GRADED
  FAILED
}

// ==================== 邀请码 ====================
model InviteCode {
  id        String    @id @default(cuid())
  code      String    @unique
  isActive  Boolean   @default(true)
  usedCount Int       @default(0)
  maxUses   Int       @default(1)
  expiresAt DateTime?
  createdAt DateTime  @default(now())

  @@index([code, isActive])
}
```

### 2.2 跑迁移

```bash
cd backend
npx prisma migrate dev --name init
```

会自动在 `prisma/migrations/` 生成 SQL，并应用到 Postgres。

### 2.3 seed 邀请码

等阶段 1 后期加 `prisma/seed.ts`：

```typescript
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  await prisma.inviteCode.upsert({
    where: { code: 'TEACH2026' },
    update: {},
    create: {
      code: 'TEACH2026',
      isActive: true,
      maxUses: 1000,           // 阶段 1 用大数；阶段 2 改严
      expiresAt: new Date('2027-12-31'),
    },
  })
  console.log('✓ seed TEACH2026')
}

main().finally(() => prisma.$disconnect())
```

`package.json` 加：

```json
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  }
```

---

## Step 3：核心代码骨架

### 3.1 `src/config.ts`

```typescript
import 'dotenv/config'
import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  WECHAT_APPID: z.string().min(1, 'WECHAT_APPID 必填'),
  WECHAT_SECRET: z.string().min(1, 'WECHAT_SECRET 必填'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET 必须 ≥32 字节'),

  DATABASE_URL: z.string().url(),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('❌ 环境变量配置错误：')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const config = parsed.data
```

### 3.2 `src/lib/errors.ts`

```typescript
import type { FastifyError } from 'fastify'

export class AppError extends Error {
  statusCode: number
  code: string
  constructor(statusCode: number, code: string, message: string) {
    super(message)
    this.statusCode = statusCode
    this.code = code
  }
}

export function createError(statusCode: number, code: string, message: string) {
  return new AppError(statusCode, code, message)
}

// 常用错误
export const errors = {
  missingToken: () => createError(401, 'MISSING_TOKEN', '未提供 token'),
  invalidToken: () => createError(401, 'INVALID_TOKEN', 'token 无效或已过期'),
  forbidden: () => createError(403, 'FORBIDDEN', '无权限'),
  notFound: (what = '资源') => createError(404, 'NOT_FOUND', `${what}不存在`),
  invalidInviteCode: () => createError(400, 'INVALID_INVITE_CODE', '邀请码无效或已用完'),
  rateLimited: () => createError(429, 'RATE_LIMITED', '请求过于频繁'),
  internal: (msg = '服务器内部错误') => createError(500, 'INTERNAL_ERROR', msg),
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError
}
```

### 3.3 `src/lib/wechat.ts`

```typescript
import axios from 'axios'
import { config } from '../config'
import { createError } from './errors'

interface Code2SessionResult {
  openid: string
  unionid?: string
  sessionKey: string
}

// 错误码对应表
const ERROR_MAP: Record<number, { code: string; retryable: boolean }> = {
  40029: { code: 'INVALID_CODE', retryable: false },        // code 失效
  40163: { code: 'CODE_USED', retryable: false },           // code 被用过
  40226: { code: 'INVALID_APPID', retryable: false },       // appid/secret 错（高危）
  45011: { code: 'RATE_LIMIT', retryable: true },           // 频率超限
  [-1]: { code: 'WECHAT_SYSTEM_BUSY', retryable: true } as any, // 系统繁忙
}

export async function code2Session(code: string): Promise<Code2SessionResult> {
  let response
  try {
    response = await axios.get(
      'https://api.weixin.qq.com/sns/jscode2session',
      {
        params: {
          appid: config.WECHAT_APPID,
          secret: config.WECHAT_SECRET,
          js_code: code,
          grant_type: 'authorization_code',
        },
        timeout: 5000,
      },
    )
  } catch (e) {
    throw createError(503, 'WECHAT_UNREACHABLE', '微信服务暂时不可达')
  }

  const data = response.data
  if (data.errcode && data.errcode !== 0) {
    const mapped = ERROR_MAP[data.errcode] ?? {
      code: `WECHAT_ERR_${data.errcode}`,
      retryable: false,
    }
    throw createError(
      400,
      mapped.code,
      `code2Session 失败: ${data.errmsg}`,
    )
  }

  return {
    openid: data.openid,
    unionid: data.unionid,
    sessionKey: data.session_key,
  }
}
```

### 3.4 `src/lib/jwt.ts`

```typescript
import jwt from 'jsonwebtoken'
import { config } from '../config'

export interface TokenPayload {
  uid: string
  openid: string
  role: 'teacher' | 'student'
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: '7d',
    issuer: 'hometutor-nas',
  })
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, config.JWT_SECRET, {
    issuer: 'hometutor-nas',
  }) as TokenPayload
}
```

### 3.5 `src/plugins/db.ts`

```typescript
import fp from 'fastify-plugin'
import { PrismaClient } from '@prisma/client'

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient
  }
}

export default fp(async (fastify) => {
  const prisma = new PrismaClient({
    log: fastify.log.level === 'debug' ? ['query', 'error', 'warn'] : ['error'],
  })

  await prisma.$connect()
  fastify.log.info('✓ Prisma connected')

  fastify.decorate('prisma', prisma)

  fastify.addHook('onClose', async () => {
    await prisma.$disconnect()
  })
})
```

### 3.6 `src/plugins/auth.ts`

```typescript
import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { verifyToken, TokenPayload } from '../lib/jwt'
import { errors } from '../lib/errors'

declare module 'fastify' {
  interface FastifyRequest {
    user?: TokenPayload
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

export default fp(async (fastify: FastifyInstance) => {
  fastify.decorate('authenticate', async (req, reply) => {
    const auth = req.headers.authorization
    if (!auth?.startsWith('Bearer ')) {
      reply.code(401).send({ success: false, error: errors.missingToken().code })
      return
    }
    try {
      req.user = verifyToken(auth.slice(7))
    } catch {
      reply.code(401).send({ success: false, error: errors.invalidToken().code })
    }
  })
})
```

### 3.7 `src/routes/health.ts`

```typescript
import type { FastifyInstance } from 'fastify'

export default async function (fastify: FastifyInstance) {
  fastify.get('/health', async () => {
    return { ok: true, timestamp: new Date().toISOString() }
  })
}
```

### 3.8 `src/routes/auth.ts` —— 阶段 1 核心

```typescript
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { code2Session } from '../lib/wechat'
import { signToken } from '../lib/jwt'
import { createError, errors } from '../lib/errors'

const loginSchema = z.object({
  code: z.string().min(1),
  role: z.enum(['teacher', 'student']),
  name: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  inviteCode: z.string().optional(),
})

export default async function (fastify: FastifyInstance) {
  fastify.post('/api/auth/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) {
      reply.code(400)
      return { success: false, error: 'INVALID_INPUT', message: parsed.error.message }
    }
    const { code, role, name, avatarUrl, inviteCode } = parsed.data

    // 1. 调微信 code2Session 拿 openid
    const { openid, sessionKey } = await code2Session(code)
    // sessionKey 立刻丢弃，不持久化

    // 2. 老师角色校验邀请码
    if (role === 'teacher') {
      if (!inviteCode) {
        reply.code(400)
        return { success: false, error: 'INVITE_CODE_REQUIRED' }
      }

      const ic = await fastify.prisma.inviteCode.findUnique({
        where: { code: inviteCode },
      })
      if (!ic || !ic.isActive || ic.usedCount >= ic.maxUses) {
        reply.code(400)
        return { success: false, error: 'INVALID_INVITE_CODE' }
      }

      // ⚠️ 关键：用事务原子自增（修原 login 云函数的并发 bug）
      // 这里先用 read 看看，阶段 2 改 $transaction 原子自增
      await fastify.prisma.inviteCode.update({
        where: { id: ic.id },
        data: { usedCount: { increment: 1 } },
      })
    }

    // 3. upsert user
    const user = await fastify.prisma.user.upsert({
      where: { openid },
      update: {
        role,
        ...(name && { name }),
        ...(avatarUrl && { avatarUrl }),
      },
      create: {
        openid,
        role,
        name: name ?? '未命名',
        ...(avatarUrl && { avatarUrl }),
      },
    })

    // 4. 签 JWT
    const token = signToken({
      uid: user.id,
      openid: user.openid,
      role: user.role as 'teacher' | 'student',
    })

    return {
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          openid: user.openid,
          role: user.role,
          name: user.name,
          avatarUrl: user.avatarUrl,
        },
      },
    }
  })
}
```

### 3.9 `src/server.ts` —— Fastify 入口

```typescript
import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { config } from './config'
import dbPlugin from './plugins/db'
import authPlugin from './plugins/auth'
import healthRoutes from './routes/health'
import authRoutes from './routes/auth'
import { errors } from './lib/errors'

const fastify = Fastify({
  logger: {
    level: config.LOG_LEVEL,
    transport: config.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
  },
  trustProxy: true,  // 信任 Tunnel 转发头
})

async function bootstrap() {
  // CORS（小程序不需要，但浏览器调试有用）
  await fastify.register(cors, {
    origin: ['https://api.hometutor.top'],
    credentials: true,
  })

  // 限流
  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    global: true,
  })

  // 业务路由
  await fastify.register(dbPlugin)
  await fastify.register(authPlugin)
  await fastify.register(healthRoutes)
  await fastify.register(authRoutes)

  // 全局错误处理
  fastify.setErrorHandler((err, req, reply) => {
    req.log.error({ err }, 'request error')
    const statusCode = (err as any).statusCode ?? 500
    const code = (err as any).code ?? 'INTERNAL_ERROR'
    reply.code(statusCode).send({
      success: false,
      error: code,
      message: err.message,
    })
  })

  // 优雅关闭
  const shutdown = async (signal: string) => {
    fastify.log.info(`收到 ${signal}，开始关闭...`)
    await fastify.close()
    process.exit(0)
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  // 启动
  try {
    await fastify.listen({ port: config.PORT, host: '0.0.0.0' })
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

bootstrap()
```

---

## Step 4：Dockerfile + docker-compose.yml

参见 [`DOMAIN_SETUP.md` 第 6 节](DOMAIN_SETUP.md#6-后端-docker-compose--env)，文件直接照抄即可。

---

## Step 5：本地测试

### 5.1 起后端（不用 Docker）

```bash
cd backend
cp .env.example .env
# 填值：WECHAT_APPID / WECHAT_SECRET / JWT_SECRET / DATABASE_URL
pnpm prisma migrate dev
pnpm dev
```

应该看到：

```
{"level":30,"time":...,"msg":"✓ Prisma connected"}
{"level":30,"time":...,"msg":"Server listening at http://0.0.0.0:3000"}
```

### 5.2 测 `/health`

```bash
curl http://localhost:3000/health
# {"ok":true,"timestamp":"2026-09-17T..."}
```

### 5.3 测 `/api/auth/login`

```bash
# 拿一个真实 code（从微信开发者工具 console.log(wx.login()) 拿）
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "code":"001xxxREAL_CODE_FROM_WECHATxxx",
    "role":"student",
    "name":"测试学生"
  }'

# 期望返回
# {"success":true,"data":{"token":"eyJ...","user":{"id":"...","role":"student",...}}}
```

老师角色要加 `inviteCode`：

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "code":"001xxxREAL_CODE_FROM_WECHATxxx",
    "role":"teacher",
    "name":"测试老师",
    "inviteCode":"TEACH2026"
  }'
```

---

## Step 6：Docker Compose 起完整栈

```bash
cd backend
docker compose up -d --build
docker compose ps
```

应该看到 3 个容器都 healthy / running：

```
NAME                          STATUS
hometutor-postgres            Up (healthy)
hometutor-api                 Up
hometutor-cloudflared         Up
```

```bash
docker logs hometutor-api --tail 20
docker logs hometutor-cloudflared --tail 20
```

cloudflared 日志应该看到：

```
... INF Connection established connIndex=0 ...
... INF Connection established connIndex=1 ...
```

表示 Tunnel 已连上 Cloudflare edge。

---

## Step 7：通过 Tunnel 验证

```bash
# 在 mac 上
curl https://api.hometutor.top/health
# {"ok":true,"timestamp":"..."}
```

如果通了，Tunnel 这条路就通了。

---

## Step 8：前端小程序改动

### 8.1 `miniprogram/app.js` 加全局开关

```javascript
// miniprogram/app.js
App({
  globalData: {
    env: 'hometutor-dev-d2gz5nh53c67ecd73',  // 保留原 CloudBase env
    apiBase: 'https://api.hometutor.top',       // 新 NAS 后端
    useNasApi: false,                            // ⚠️ 灰度开关：阶段 1 默认 false
    userInfo: null,
  },

  onLaunch() {
    // 恢复登录态
    const cached = wx.getStorageSync('userInfo')
    if (cached) this.globalData.userInfo = cached
  },
})
```

### 8.2 `miniprogram/utils/request.js` 新文件

```javascript
// miniprogram/utils/request.js
const app = getApp()

function request(url, options = {}) {
  const token = wx.getStorageSync('token')
  const useNas = app.globalData.useNasApi
  const baseUrl = useNas ? app.globalData.apiBase : ''  // 空字符串走云函数

  return new Promise((resolve, reject) => {
    if (!useNas) {
      // 老路径：wx.cloud.callFunction
      wx.cloud.callFunction({
        name: url.replace(/^\/api\//, '').replace(/\//g, '-'),  // /api/auth/login → auth-login
        data: options.data || {},
        config: { timeout: options.timeout || 10000 },
      }).then(res => {
        if (res.result?.success === false && res.result?.error === 'INVALID_TOKEN') {
          handleAuthFail()
        }
        resolve(res.result)
      }).catch(reject)
      return
    }

    // 新路径：wx.request
    wx.request({
      url: baseUrl + url,
      method: options.method || 'GET',
      data: options.data,
      header: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      timeout: options.timeout || 10000,
      success: (res) => {
        if (res.statusCode === 401) {
          handleAuthFail()
          return reject(res.data)
        }
        resolve(res.data)
      },
      fail: reject,
    })
  })
}

function handleAuthFail() {
  wx.removeStorageSync('token')
  wx.removeStorageSync('userInfo')
  app.globalData.userInfo = null
  wx.showToast({ title: '请重新登录', icon: 'none' })
  setTimeout(() => wx.reLaunch({ url: '/pages/login/index' }), 1000)
}

module.exports = { request }
```

### 8.3 `miniprogram/pages/login/index.js` 改动

原代码用 `wx.cloud.callFunction({ name: 'login' })`。改成 `request('/api/auth/login')`。

**关键 diff**：

```diff
// pages/login/index.js
- wx.cloud.callFunction({
-   name: 'login',
-   data: {
-     role: this.data.role,
-     name: userInfo.nickName,
-     avatarUrl: userInfo.avatarUrl,
-     inviteCode: this.data.inviteCode,
-   }
- })
+ const { request } = require('../../utils/request')
+ request('/api/auth/login', {
+   method: 'POST',
+   data: {
+     role: this.data.role,
+     name: userInfo.nickName,
+     avatarUrl: userInfo.avatarUrl,
+     inviteCode: this.data.inviteCode,
+   }
+ })
```

完整页面改动一般还会包括：

```javascript
// pages/login/index.js (核心逻辑段)
const { request } = require('../../utils/request')

async onChooseAvatar(e) {
  const { avatarUrl } = e.detail
  // 原：wx.cloud.uploadFile → 写 avatarFileId → 写 users.avatarUrl
  // 新：直接拿 CDN URL（已是 https），后端存到 User.avatarUrl
  this.setData({ tempAvatarUrl: avatarUrl })
}

async onLogin() {
  const { role, inviteCode, tempAvatarUrl, nickname } = this.data

  // 1. wx.login() 拿 code
  const { code } = await wx.login()

  // 2. 调后端登录
  const res = await request('/api/auth/login', {
    method: 'POST',
    data: {
      code,
      role,
      name: nickname,
      avatarUrl: tempAvatarUrl,
      inviteCode: role === 'teacher' ? inviteCode : undefined,
    },
  })

  if (!res.success) {
    wx.showToast({ title: res.error, icon: 'none' })
    return
  }

  // 3. 存 token + userInfo
  wx.setStorageSync('token', res.data.token)
  wx.setStorageSync('userInfo', res.data.user)
  getApp().globalData.userInfo = res.data.user

  // 4. 跳首页
  wx.reLaunch({
    url: role === 'teacher' ? '/pages/teacherHome/index' : '/pages/studentHome/index',
  })
}
```

### 8.4 微信开发者工具切换项目

1. 微信开发者工具 → 顶部「项目」→ 「导入项目」
2. **项目目录**：选 `miniapp-nas/`（不是 `miniapp/`）
3. AppID：`wx8839977b8283503e`（同原项目）
4. 项目名称：`hometutor-nas`
5. 导入后**关闭**老的 `hometutor` 项目（避免开发者工具实例冲突）

### 8.5 测试登录

1. 在开发者工具里点「编译」
2. 进登录页 → 选角色（老师/学生）→ 选微信头像/昵称 → 点登录
3. Console 应该看到 `request success`
4. Network 应该看到 `POST https://api.hometutor.top/api/auth/login` 返回 200

**如果报 `url not in domain list`**：

- 确认合法域名已配（[`DOMAIN_SETUP.md` 第 5 节](DOMAIN_SETUP.md#5-微信公众平台合法域名)）
- 开发者工具右上角「详情」→「本地设置」勾上「不校验合法域名」临时调试

---

## Step 9：灰度切换

阶段 1 完成后，`useNasApi = false` 默认走老路径。打开开关：

```javascript
// app.js
globalData.useNasApi = true
```

逐个用户测试：

1. **自己 + 1~2 个核心用户**先用新路径
2. 跑 1~2 天没问题 → 扩到 50% 用户（按 openid hash 分流，见 utils/request.js 改造）
3. 跑 1 周没问题 → 100% 切新路径
4. 跑 2 周没问题 → 删云函数

**回滚**：把 `useNasApi` 改回 `false`，立即回老路径。

---

## Step 10：安全清单

阶段 1 跑通后过一遍：

- [ ] `.env` 在 `.gitignore` 里（git status 看不到 `.env`）
- [ ] JWT_SECRET ≥32 字节随机（`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`）
- [ ] `sessionKey` 不返回前端、不进日志
- [ ] `wx-server-sdk` **不要**装到自建后端（避免泄漏 AppID 上下文）
- [ ] Cloudflare Tunnel 状态 HEALTHY
- [ ] 微信合法域名三个白名单都加了
- [ ] 后端限流开启（`@fastify/rate-limit` global: true）
- [ ] API 容器**不暴露 3000 到公网**（docker-compose 用 `expose` 不用 `ports`）
- [ ] Postgres 健康检查通过
- [ ] Postgres 数据每天备份（阶段 2 加 cron）

---

## 阶段 2 衔接（只列大纲，阶段 2 启动时再展开）

1. **数据库迁移 ETL**：`scripts/migrate-from-cloudbase.ts` 把 NoSQL 6 集合导到 PG（参见调研笔记）
2. **剩余 14 个 endpoint 平移**：createClass / joinClass / getMyClasses / publishAssignment / getStudentTodoList / getAssignmentSubmissions / getAssignmentStudentStats / getStudentSubmissions / getClassStudents / updateProfile / deleteAssignmentBatch / initDatabase / speechRecognition / llmScoring / submitRecitation
3. **小程序前端字段适配**：`cls._id` → `cls.id`、`student_ids[]` → `members.map(m => m.student)` 等
4. **submitRecitation 重点**：视频下载 → ASR → LLM → 落库，端到端跑通 90s 内
5. **删除 CloudBase 依赖**：所有 `wx-server-sdk` 引用清零
6. **保留 CloudBase 云函数 1~2 周**：观察稳定后删除

## 阶段 3 衔接（仅提示）

1. MinIO 部署 + lifecycle 配置（30 天清理）
2. `wx.uploadFile` 切 MinIO 预签名 URL
3. 后端 `cloud.getTempFileURL` / `deleteFile` 全部替换为 MinIO SDK
4. `submissions.videoFileId` 字段值从 fileID 改为 MinIO objectKey
5. Caddy 上真实证书，Cloudflare TLS 切 Full Strict
6. 删 CloudBase 存储里的旧视频（节省成本）