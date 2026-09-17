import type { FastifyInstance } from 'fastify'
import { config } from '../config'

/**
 * 一键建邀请码 seed
 * 原 cloudfunctions/initDatabase 功能
 */
export default async function (fastify: FastifyInstance) {
  fastify.post('/init-database', async (req) => {
    const { force } = (req.body as any) || {}

    // 默认 seed：TEACH2026
    const code = config.INVITE_SEED_CODE || 'TEACH2026'

    if (force) {
      // force 重新 seed（先删除再创建）
      await fastify.prisma.inviteCode.deleteMany({ where: { code } })
    }

    const result = await fastify.prisma.inviteCode.upsert({
      where: { code },
      update: {},
      create: {
        code,
        isActive: true,
        maxUses: 1000,
        expiresAt: new Date('2027-12-31'),
      },
    })

    return {
      success: true,
      data: {
        message: 'Invite code seeded',
        inviteCode: result,
      },
    }
  })
}