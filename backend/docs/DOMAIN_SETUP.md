# 域名 + Cloudflare Tunnel 接入全流程

> 本文档目标：从零开始把 NAS 上的 Fastify 后端通过 Cloudflare Tunnel 暴露给小程序调用。
> 
> 全程预计 **30 分钟到半天**（主要时间花在 DNS 生效等待和微信公众平台审核）。

## 目录

1. [买域名（腾讯云 .top）](#1-买域名腾讯云-top)
2. [Cloudflare 账号 + 接入域名](#2-cloudflare-账号--接入域名)
3. [创建 Cloudflare Tunnel](#3-创建-cloudflare-tunnel)
4. [配置 Public Hostname](#4-配置-public-hostname)
5. [微信公众平台合法域名](#5-微信公众平台合法域名)
6. [后端 Docker Compose + .env](#6-后端-docker-compose--env)
7. [验证清单](#7-验证清单)
8. [常见错误排查](#8-常见错误排查)
9. [续费 / 长期维护](#9-续费--长期维护)

---

## 1. 买域名（腾讯云 .top）

### 1.1 账号注册 + 实名

1. 访问 [cloud.tencent.com](https://cloud.tencent.com) → 右上角「注册」
2. 用微信扫码注册（最快），或手机号
3. 注册成功后访问 [console.cloud.tencent.com/developer](https://console.cloud.tencent.com/developer) → 「实名认证」→ 个人认证
4. 填身份证号 + 微信扫码 → 大约 **5 分钟**通过

### 1.2 查询 + 购买 `.top`

1. 访问 [buy.cloud.tencent.com/domain](https://buy.cloud.tencent.com/domain)
2. 输入想注册的名称（如 `hometutor`），点「查询」
3. 在结果列表选 `.top` 后缀 → `.top` 一般 **首年 9 元**
4. 域名名建议：
   - 避免敏感词（test/demo/xxx）
   - 最好带项目/个人标识
   - 长度 3-15 字符易记
5. 加购物车 → 付款（支付宝/微信）→ **9 元到账**

> **注意**：腾讯云续费 `.top` 一般 **30-60 元/年**（首年便宜的代价），9 元用一年够了；如果长期用，考虑 Cloudflare Registrar 买 `.com`（首年/续费同价 50-80 元/年）。

### 1.3 域名管理后台位置

买完后访问 [console.cloud.tencent.com/domain](https://console.cloud.tencent.com/domain) → 看到刚买的域名 → 点「解析」进入 DNS 配置页。

---

## 2. Cloudflare 账号 + 接入域名

### 2.1 注册 Cloudflare

访问 [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up) → 用邮箱注册（建议 Gmail / Outlook，不用 QQ/163 邮箱避免收不到验证邮件）。

### 2.2 添加站点

1. 登录后 Dashboard 主页 → 「Add a site」→ 输入你的域名（不带 www，例如 `hometutor.top`）
2. 选 **Free** 套餐 → 「Continue」
3. Cloudflare 会自动扫描现有 DNS 记录（腾讯云默认有几条空记录，会被扫出来）
4. **关键**：Cloudflare 会给你两个 NS 记录，类似：
   ```
   anna.ns.cloudflare.com
   bob.ns.cloudflare.com
   ```
   **把这两个记下来**，下一步要用

### 2.3 修改 NS 到 Cloudflare

回到腾讯云域名管理后台：

1. [console.cloud.tencent.com/domain](https://console.cloud.tencent.com/domain) → 点你域名的「解析」
2. 顶部右上角有「**修改 DNS 服务器**」按钮（或「更多」→「修改 DNS」）
3. 把上一步那两个 Cloudflare NS 填进去：
   ```
   DNS 服务器 1: anna.ns.cloudflare.com
   DNS 服务器 2: bob.ns.cloudflare.com
   ```
4. 保存

### 2.4 等 DNS 生效

回到 Cloudflare Dashboard：

- 域名状态会从 `Pending` 变 `Active`
- **多数情况 10-30 分钟**，最坏 4-24 小时
- 可以用 `dig NS hometutor.top` 在本地验证（应该看到 cloudflare.com 的 NS）

生效后 Cloudflare 会邮件通知。

---

## 3. 创建 Cloudflare Tunnel

### 3.1 Zero Trust 入口

1. Cloudflare Dashboard → 左侧菜单选「**Zero Trust**」
2. 第一次进入会让你选套餐，选 **Free**（0 元/月，够用）
3. 可能要求你填组织名（随便起一个，比如 `personal`）

### 3.2 创建 Tunnel

1. 左侧菜单 → **Networks** → **Tunnels**
2. 点 「**Create a tunnel**」→ 选「**Cloudflared**」类型
3. 命名：填 `hometutor-nas`（或任何你喜欢的名字）
4. 保存后会显示一个 **TUNNEL_TOKEN**，长这样：
   ```
   eyJhIjoiYWJjZGVmMTIzNDU2Nzg5MGFiY2RlZiIsInR5cGUiOiJjbG91ZGZsYXJlZCIsImFwcF9pZCI6IjlhODc2NTQzMjEiLCJpbnN0YWxsX2lkIjoi...
   ```
   **复制下来保存**，后面 Docker Compose 要用

### 3.3 验证 Tunnel 状态

创建后回到 Tunnels 列表，能看到 `hometutor-nas` 状态应该是 **Inactive**（还没接 host）。

---

## 4. 配置 Public Hostname

继续在 Cloudflare Zero Trust → Networks → Tunnels → `hometutor-nas` → 「**Configure**」：

### 4.1 添加 Public Hostname

1. 切到 **Public Hostname** tab
2. 点 「**Add a public hostname**」
3. 填表：

   | 字段 | 填什么 | 说明 |
   | --- | --- | --- |
   | Subdomain | `api` | 你最终访问的是 `api.hometutor.top` |
   | Domain | `hometutor.top` | 从下拉里选你 Cloudflare 接入的域名 |
   | Service | `http://api:3000` | ⚠️ `api` 是 docker-compose 里的服务名（不是 localhost）|
   | Path | *留空* | 暂时所有路径都转发 |

4. 点 「**Save hostname**」

> **可选**：再加一个 Public Hostname 给将来的 MinIO（阶段 3 用），比如 `files.hometutor.top` → `http://minio:9000`。

### 4.2 TLS 模式

左上角导航回到「**SSL/TLS**」→「**Overview**」：

| 阶段 | 模式 | 解释 |
| --- | --- | --- |
| 阶段 1（当前） | **Full** | Cloudflare ↔ NAS 加密（接受自签证书） |
| 阶段 3 | **Full (Strict)** | 校验 NAS 真实证书（Caddy 自动签发） |

阶段 1 先选 **Full**。阶段 3 用 Caddy 签真实证书后改 **Full (Strict)**。

---

## 5. 微信公众平台合法域名

小程序调任何外部 HTTPS 接口，必须在公众平台白名单里。

### 5.1 进入配置页

1. 登录 [mp.weixin.qq.com](https://mp.weixin.qq.com)
2. 左侧菜单 → **开发** → **开发管理** → **服务器域名**

### 5.2 配置三类白名单

分别填（**不要带尾部斜杠**）：

```
request 合法域名:    https://api.hometutor.top
uploadFile 合法域名:  https://api.hometutor.top
downloadFile 合法域名: https://api.hometutor.top
```

> 如果你直接用 MinIO 预签名 URL 给小程序上传，还要把 MinIO 域名加进去（阶段 3 再加）。

### 5.3 等审核

- 保存后微信会做合法性检查，一般 **几分钟到几小时** 生效
- 生效前小程序调用会报 `url not in domain list`
- 可以用「微信开发者工具 → 真机调试」实时看效果

---

## 6. 后端 Docker Compose + .env

### 6.1 `.env.example` 模板

放在 `backend/.env.example`（git 跟踪，给团队参考，**值留空**）：

```bash
# ============ Cloudflare Tunnel ============
# 从 Cloudflare Zero Trust → Tunnels → hometutor-nas 复制
TUNNEL_TOKEN=

# ============ 微信小程序 ============
# 公众平台 → 开发管理 → 开发设置
WECHAT_APPID=
WECHAT_SECRET=

# ============ JWT 鉴权 ============
# 生成命令: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
JWT_SECRET=

# ============ Postgres ============
POSTGRES_USER=hometutor
POSTGRES_PASSWORD=hometutor_dev
POSTGRES_DB=hometutor
DATABASE_URL=postgres://hometutor:hometutor_dev@postgres:5432/hometutor

# ============ SiliconFlow AI ============
# https://cloud.siliconflow.cn/account/ak
SILICONFLOW_API_KEY=

# ============ CloudBase（阶段 1 仍需）============
# 公众平台 → 云开发 → 环境 → 环境 ID
CLOUDBASE_ENV_ID=hometutor-dev-d2gz5nh53c67ecd73

# ============ 业务开关 ============
NODE_ENV=development
LOG_LEVEL=info
PORT=3000
```

### 6.2 `backend/.env`

**复制 `.env.example` 到 `.env`**：

```bash
cd backend
cp .env.example .env
```

**填值**（每个字段怎么拿详见上方注释）：
- `TUNNEL_TOKEN`：第 3.2 节复制
- `WECHAT_APPID` / `WECHAT_SECRET`：公众平台
- `JWT_SECRET`：跑生成命令贴进去
- `SILICONFLOW_API_KEY`：硅基流动账号后台
- `CLOUDBASE_ENV_ID`：原项目用的，复制过来即可

> **`.env` 一定要在 `.gitignore` 里**（backend 项目自带，无需额外配）

### 6.3 `docker-compose.yml`

放在 `backend/docker-compose.yml`：

```yaml
services:
  # ============ API Server ============
  api:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: hometutor-api
    restart: unless-stopped
    env_file: .env
    environment:
      NODE_ENV: production
      DATABASE_URL: postgres://hometutor:hometutor_dev@postgres:5432/hometutor
    depends_on:
      postgres:
        condition: service_healthy
    # ⚠️ 不暴露 3000 端口！只让 cloudflared 内网访问
    expose:
      - "3000"
    networks:
      - hometutor-net

  # ============ Postgres ============
  postgres:
    image: postgres:16-alpine
    container_name: hometutor-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: hometutor
      POSTGRES_PASSWORD: hometutor_dev
      POSTGRES_DB: hometutor
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./scripts/postgres-init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U hometutor -d hometutor"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - hometutor-net

  # ============ Cloudflare Tunnel ============
  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: hometutor-cloudflared
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN}
    depends_on:
      - api
    networks:
      - hometutor-net

volumes:
  pgdata:

networks:
  hometutor-net:
    driver: bridge
```

> **关键**：`api` 容器**不暴露 `3000` 到公网**（用 `expose` 而不是 `ports`），公网入口只有 Cloudflare edge。

### 6.4 `Dockerfile`

放在 `backend/Dockerfile`：

```dockerfile
FROM node:20-alpine AS base
RUN corepack enable

# ---- deps stage ----
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

# ---- build stage ----
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate
RUN pnpm build

# ---- runtime stage ----
FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY package.json ./
EXPOSE 3000
USER node
CMD ["node", "dist/server.js"]
```

> ⚠️ 这个 Dockerfile 是阶段 1 实施计划里的，**阶段 0 还没建后端代码**，先列着。

---

## 7. 验证清单

按顺序跑通下面 5 步，阶段 0 完成：

### ✅ 步骤 1：Cloudflare 域名已接管

```bash
dig NS hometutor.top
```

应该看到 `cloudflare.com` 的 NS。

### ✅ 步骤 2：Tunnel 状态 Active

Cloudflare Dashboard → Zero Trust → Networks → Tunnels → `hometutor-nas` → 状态应是 **HEALTHY**（绿点）。

### ✅ 步骤 3：DNS 解析

```bash
dig api.hometutor.top
```

应该解析到 Cloudflare 的 edge IP（不是 NAS IP）。

### ✅ 步骤 4：API 容器跑通 + Tunnel 转发

```bash
# NAS 上
docker compose up -d
docker logs hometutor-api
docker logs hometutor-cloudflared

# 本地 mac
curl -v https://api.hometutor.top/health
```

应该看到 200 + Fastify 响应。

### ✅ 步骤 5：微信合法域名生效

```bash
# 在小程序里测试
wx.request({ url: 'https://api.hometutor.top/health' })
```

应该成功返回，不报 `url not in domain list`。

---

## 8. 常见错误排查

### ❌ `curl` 返回 502 Bad Gateway

**原因**：Tunnel 找不到上游服务。

**排查**：

```bash
docker logs hometutor-cloudflared --tail 50
```

常见：
- `dial tcp: lookup api on ... no such host` → docker-compose 里 `api` 容器没起来或网络不通
- `connection refused` → API 容器没监听 3000（看 `docker logs hometutor-api`）
- Public Hostname 的 `Service` 写错了（应该是 `http://api:3000`，不是 `http://localhost:3000`）

### ❌ Tunnel 状态显示 `INACTIVE`

**原因**：`TUNNEL_TOKEN` 没读到或者过期了。

**排查**：

```bash
docker exec hometutor-cloudflared env | grep TUNNEL
```

如果为空 → `.env` 没 mount 进去（检查 `env_file: .env`），或 token 复制错。

### ❌ 微信小程序 `url not in domain list`

**原因**：合法域名白名单没配或还没审核过。

**排查**：
- 公众平台 → 开发管理 → 服务器域名，确认三个白名单都加了
- 域名要 `https://` 开头，**不要带尾部斜杠**
- 等几分钟到几小时生效

### ❌ 微信开发者工具能调通，手机体验版调不通

**原因**：手机体验版用的是另一个环境配置。

**排查**：
- 微信开发者工具 → 右上角「详情」→ 「本地设置」勾上「不校验合法域名、xxx 域名」先调试
- 真实测试时去掉勾选，体验版扫码测试

### ❌ DNS 切换 24 小时还没生效

**排查**：

```bash
# 在不同 DNS 上验证
nslookup hometutor.top 8.8.8.8
nslookup hometutor.top 1.1.1.1
```

如果 8.8.8.8 已经是 Cloudflare NS 但本地还是老的，**清本地 DNS 缓存**：

```bash
# macOS
sudo dscacheutil -flushcache
sudo killall -HUP mDNSResponder

# Windows
ipconfig /flushdns

# Linux (systemd-resolved)
sudo systemd-resolve --flush-caches
```

如果全球都还是老的 NS，**回腾讯云确认 NS 改对了**（`anna.ns.cloudflare.com` 拼写无误）。

---

## 9. 续费 / 长期维护

### 9.1 域名续费

- **腾讯云 .top 续费 ~30-60 元/年**，到期前 30 天会有邮件提醒
- 续费入口：[console.cloud.tencent.com/domain](https://console.cloud.tencent.com/domain)
- 忘记续费 30 天后域名进入赎回期（赎回费几百），**设个日历提醒**

### 9.2 Cloudflare Tunnel 长期

- 免费版无限带宽（合理使用）
- 单 IP 1000 请求/10 分钟限流（你量级够用）
- cloudflared 容器会自动更新：`--no-autoupdate` 改成 `--autoupdate` 就让镜像自动升

### 9.3 备份策略

- **Postgres 数据**：每天 cron 跑 `pg_dump`，存到 NAS 其他位置
- **.env**：**单独备份**（别只放在 NAS 上，机器坏了就丢）
- **代码**：git 推到 origin 即可

### 9.4 一年后怎么办

如果不续费 `.top`：
- 域名到期 30 天后释放
- Cloudflare Tunnel 自动断（域名没了）
- 小程序无法调用 → 用户感知到「服务不可用」
- 此时快速方案：换一个新域名，改 Tunnel Public Hostname 的 Domain 字段（5 分钟搞定）；不可用窗口 < 10 分钟

---

## 下一步

阶段 0 完成后，进入 **阶段 1：后端 + Tunnel + 鉴权端到端跑通**。

详见 [`PHASE_1_PLAN.md`](PHASE_1_PLAN.md)。