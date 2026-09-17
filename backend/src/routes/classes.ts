import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const createSchema = z.object({
  name: z.string().min(1).max(50),
})

const joinSchema = z.object({
  inviteCode: z.string().length(6),
})

// 生成6位邀请码（去重，最多重试5次）
async function generateUniqueInviteCode(prisma: any): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, '0')
    const exists = await prisma.class.findUnique({ where: { inviteCode: code } })
    if (!exists) return code
  }
  throw new Error('生成邀请码失败')
}

export default async function (fastify: FastifyInstance) {
  // ============== 创建班级（老师）==============
  fastify.post(
    '/classes',
    { preHandler: [fastify.authenticate, fastify.requireRole('teacher')] },
    async (req, reply) => {
      const parsed = createSchema.safeParse(req.body)
      if (!parsed.success) {
        reply.code(400)
        return { success: false, error: 'INVALID_INPUT', message: parsed.error.message }
      }

      const teacherId = req.user!.uid
      const teacher = await fastify.prisma.user.findUnique({ where: { id: teacherId } })
      if (!teacher) {
        reply.code(404)
        return { success: false, error: 'USER_NOT_FOUND' }
      }

      const inviteCode = await generateUniqueInviteCode(fastify.prisma)
      const cls = await fastify.prisma.class.create({
        data: {
          teacherId,
          teacherName: teacher.name,
          name: parsed.data.name,
          inviteCode,
        },
      })

      return { success: true, data: cls }
    },
  )

  // ============== 加入班级（学生）==============
  fastify.post(
    '/classes/join',
    { preHandler: [fastify.authenticate, fastify.requireRole('student')] },
    async (req, reply) => {
      const parsed = joinSchema.safeParse(req.body)
      if (!parsed.success) {
        reply.code(400)
        return { success: false, error: 'INVALID_INPUT', message: parsed.error.message }
      }

      const cls = await fastify.prisma.class.findUnique({
        where: { inviteCode: parsed.data.inviteCode },
      })
      if (!cls) {
        reply.code(404)
        return { success: false, error: 'CLASS_NOT_FOUND' }
      }

      const studentId = req.user!.uid
      try {
        await fastify.prisma.classMember.create({
          data: { classId: cls.id, studentId },
        })
      } catch (e: any) {
        if (e.code === 'P2002') {
          // 已加入过
          return { success: true, data: cls, alreadyMember: true }
        }
        throw e
      }
      return { success: true, data: cls }
    },
  )

  // ============== 我的班级（老师+学生通用）==============
  fastify.get(
    '/classes',
    { preHandler: [fastify.authenticate] },
    async (req) => {
      const { openid, uid, role } = req.user!

      if (role === 'teacher') {
        const teaching = await fastify.prisma.class.findMany({
          where: { teacherId: uid },
          orderBy: { createdAt: 'desc' },
          include: {
            members: {
              where: { status: 'ACTIVE' },
              include: { student: { select: { id: true, name: true, avatarUrl: true, openid: true } } },
              orderBy: { joinedAt: 'asc' },
            },
            _count: { select: { members: { where: { status: 'ACTIVE' } } } },
          },
        })
        return { success: true, data: { teaching, studying: [] } }
      }

      // 学生
      const memberships = await fastify.prisma.classMember.findMany({
        where: { studentId: uid, status: 'ACTIVE' },
        include: { class: true },
      })
      const studying = memberships.map((m) => m.class)
      return { success: true, data: { teaching: [], studying } }
    },
  )
}