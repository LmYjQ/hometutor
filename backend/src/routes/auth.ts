import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { code2Session } from '../lib/wechat'
import { signToken } from '../lib/jwt'
import { createError } from '../lib/errors'

const loginSchema = z.object({
  code: z.string().min(1),
  role: z.enum(['teacher', 'student']),
  name: z.string().min(1).optional(),
  // ⚠️ 阶段 1：avatarUrl 可能是 CloudBase fileID（cloud://...），不强制 URL 校验
  // 阶段 3 切 MinIO 后，前端会上传 https URL，那时再加 url() 校验
  avatarUrl: z.string().optional(),
  inviteCode: z.string().optional(),
})

export default async function (fastify: FastifyInstance) {
  fastify.post('/auth/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) {
      reply.code(400)
      return {
        success: false,
        error: 'INVALID_INPUT',
        message: parsed.error.message,
      }
    }
    const { code, role, name, avatarUrl, inviteCode } = parsed.data

    // 1. 微信 code → openid
    const { openid } = await code2Session(code)

    // 2. 老师角色：校验邀请码 + 原子自增（修原 login 云函数的并发 bug）
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
      // ⚠️ 已用 $transaction 原子自增（修复 Bug #3）
      const updated = await fastify.prisma.inviteCode.updateMany({
        where: {
          id: ic.id,
          usedCount: { lt: ic.maxUses },
          isActive: true,
        },
        data: { usedCount: { increment: 1 } },
      })
      if (updated.count === 0) {
        reply.code(400)
        return { success: false, error: 'INVALID_INVITE_CODE' }
      }
    }

    // 3. upsert user（区分 create vs update，用于 isNew）
    const existing = await fastify.prisma.user.findUnique({ where: { openid } })
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
    const isNew = !existing

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
        isNew,
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