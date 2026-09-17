import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const updateSchema = z.object({
  name: z.string().min(1).max(20).optional(),
  // 阶段 1：avatarUrl 可能是 CloudBase fileID（cloud://...），不强制 URL
  // 阶段 3 切 MinIO 后再加 url() 校验
  avatarUrl: z.string().optional(),
  role: z.enum(['teacher', 'student']).optional(),
  inviteCode: z.string().optional(),
})

// 开发者专属 openid（与原 cloudfunctions/updateProfile/index.js 保持一致）
const DEV_OPENIDS = ['oiVIk7edZTVoBqYBkMAIU6PixJDk']

export default async function (fastify: FastifyInstance) {
  // ============== 当前用户信息（用 JWT 拿，不要 code）==============
  // 用于「静默刷新」场景：页面 onShow 想从后端拉一次最新 userInfo，
  // 但不能再调 /api/auth/login（那个需要 wx.login() 拿 code）
  fastify.get(
    '/profile/me',
    { preHandler: [fastify.authenticate] },
    async (req) => {
      const user = await fastify.prisma.user.findUnique({
        where: { id: req.user!.uid },
      })
      if (!user) {
        return { success: false, error: 'USER_NOT_FOUND' }
      }
      return {
        success: true,
        data: {
          id: user.id,
          openid: user.openid,
          role: user.role,
          name: user.name,
          avatarUrl: user.avatarUrl,
        },
      }
    },
  )

  fastify.post(
    '/profile/update',
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const parsed = updateSchema.safeParse(req.body)
      if (!parsed.success) {
        reply.code(400)
        return { success: false, error: 'INVALID_INPUT', message: parsed.error.message }
      }
      const { name, avatarUrl, role, inviteCode } = parsed.data
      const userId = req.user!.uid
      const openid = req.user!.openid

      // role 切换仅 DEV_OPENID 允许
      if (role && role !== req.user!.role) {
        if (!DEV_OPENIDS.includes(openid)) {
          reply.code(403)
          return { success: false, error: 'ROLE_SWITCH_FORBIDDEN' }
        }

        if (role === 'teacher') {
          // 老师注册需要有效邀请码
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
          // 原子自增
          const updated = await fastify.prisma.inviteCode.updateMany({
            where: { id: ic.id, usedCount: { lt: ic.maxUses }, isActive: true },
            data: { usedCount: { increment: 1 } },
          })
          if (updated.count === 0) {
            reply.code(400)
            return { success: false, error: 'INVALID_INVITE_CODE' }
          }
        }
      }

      const user = await fastify.prisma.user.update({
        where: { id: userId },
        data: {
          ...(name !== undefined && { name }),
          ...(avatarUrl !== undefined && { avatarUrl }),
          ...(role !== undefined && { role }),
        },
      })

      return {
        success: true,
        data: {
          id: user.id,
          openid: user.openid,
          role: user.role,
          name: user.name,
          avatarUrl: user.avatarUrl,
        },
      }
    },
  )
}