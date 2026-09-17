import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const publishSchema = z.object({
  classId: z.string(),
  batchTitle: z.string().min(1),
  fileContent: z.string().min(1), // base64（csv 文本可直接传，excel 转 base64）
  fileType: z.enum(['csv', 'excel']),
  className: z.string().optional(),
})

/** 解析 CSV 文本，跳过表头，返 [{title, text}, ...] */
function parseCSV(content: string): Array<{ title: string; text: string }> {
  const lines = content.split(/\r?\n/).filter((l) => l.trim())
  // 第一行是表头：title,text 或 question,text
  const result: Array<{ title: string; text: string }> = []
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i])
    if (cols.length < 2) continue
    const title = cols[0].trim()
    const text = cols.slice(1).join(',').trim()
    if (title && text) result.push({ title, text })
  }
  return result
}

function parseCSVLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"'
        i++
      } else inQuote = !inQuote
    } else if (c === ',' && !inQuote) {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

export default async function (fastify: FastifyInstance) {
  // ============== 发布作业（老师）==============
  fastify.post(
    '/assignments/publish',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('teacher')],
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const parsed = publishSchema.safeParse(req.body)
      if (!parsed.success) {
        reply.code(400)
        return { success: false, error: 'INVALID_INPUT', message: parsed.error.message }
      }
      const { classId, batchTitle, fileContent, fileType, className } = parsed.data
      const teacherId = req.user!.uid

      const cls = await fastify.prisma.class.findUnique({ where: { id: classId } })
      if (!cls) {
        reply.code(404)
        return { success: false, error: 'CLASS_NOT_FOUND' }
      }
      if (cls.teacherId !== teacherId) {
        reply.code(403)
        return { success: false, error: 'NOT_CLASS_OWNER' }
      }

      // 1. 创建 batch
      const batch = await fastify.prisma.assignmentBatch.create({
        data: {
          classId,
          className: className ?? cls.name,
          teacherId,
          teacherName: cls.teacherName,
          title: batchTitle,
          assignmentCount: 0,
        },
      })

      // 2. 解析文件
      let items: Array<{ title: string; text: string }>
      try {
        if (fileType === 'csv') {
          // fileContent 直接是文本
          items = parseCSV(fileContent)
        } else {
          // excel：base64 编码的 xlsx（依赖 xlsx 库，阶段 1 先只支持 csv）
          reply.code(400)
          return {
            success: false,
            error: 'EXCEL_NOT_SUPPORTED',
            message: '阶段 1 暂不支持 Excel，请转 CSV',
          }
        }
      } catch (e) {
        reply.code(400)
        return { success: false, error: 'PARSE_FAILED', message: (e as Error).message }
      }

      if (items.length === 0) {
        reply.code(400)
        return { success: false, error: 'NO_QUESTIONS' }
      }

      // 3. 批量创建 assignment
      const assignments = await fastify.prisma.$transaction(
        items.map((q) =>
          fastify.prisma.assignment.create({
            data: {
              batchId: batch.id,
              classId,
              className: cls.name,
              teacherId,
              questionTitle: q.title,
              referenceText: q.text,
            },
          }),
        ),
      )

      // 4. 回写 batch 的 assignmentCount
      await fastify.prisma.assignmentBatch.update({
        where: { id: batch.id },
        data: { assignmentCount: assignments.length },
      })

      return {
        success: true,
        data: {
          batchId: batch.id,
          count: assignments.length,
        },
      }
    },
  )

  // ============== 学生待办（按批次）==============
  fastify.get(
    '/student/todo-list',
    { preHandler: [fastify.authenticate, fastify.requireRole('student')] },
    async (req) => {
      const studentId = req.user!.uid

      // 1. 我加入的所有班级
      const memberships = await fastify.prisma.classMember.findMany({
        where: { studentId, status: 'ACTIVE' },
        include: { class: true },
      })
      const classIds = memberships.map((m) => classId(m))

      // 2. 这些班级的所有 active batch
      const batches = await fastify.prisma.assignmentBatch.findMany({
        where: { classId: { in: classIds }, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
      })

      // 3. 每个 batch 的 active assignments
      const batchesWithAssignments = await Promise.all(
        batches.map(async (batch) => {
          const assignments = await fastify.prisma.assignment.findMany({
            where: { batchId: batch.id, status: 'ACTIVE' },
            orderBy: { createdAt: 'asc' },
          })
          return { ...batch, assignments }
        }),
      )

      // 4. legacy 兼容：无 batchId 的 assignment 合成虚拟 batch
      const legacy = await fastify.prisma.assignment.findMany({
        where: {
          classId: { in: classIds },
          status: 'ACTIVE',
          batchId: null,
        },
        orderBy: { createdAt: 'desc' },
      })

      return {
        success: true,
        data: {
          batches: batchesWithAssignments,
          legacy,
          assignments: [
            ...batchesWithAssignments.flatMap((b) => b.assignments),
            ...legacy,
          ],
        },
      }
    },
  )

  // ============== 老师：班级作业列表（按批次）==============
  fastify.get(
    '/teacher/assignments',
    { preHandler: [fastify.authenticate, fastify.requireRole('teacher')] },
    async (req) => {
      const teacherId = req.user!.uid
      const { classId, includeSubmissions, includeDeleted } = (req.query as any) || {}

      const where: any = { teacherId }
      if (classId) where.classId = classId
      if (!includeDeleted) where.status = { not: 'DELETED' }

      const batches = await fastify.prisma.assignmentBatch.findMany({
        where: { teacherId, ...(classId && { classId }), ...(includeDeleted ? {} : { status: 'ACTIVE' }) },
        orderBy: { createdAt: 'desc' },
      })

      const withAssignments = await Promise.all(
        batches.map(async (batch) => {
          const assignments = await fastify.prisma.assignment.findMany({
            where: { batchId: batch.id, ...(includeDeleted ? {} : { status: 'ACTIVE' }) },
            orderBy: { createdAt: 'asc' },
            ...(includeSubmissions && {
              include: {
                submissions: {
                  orderBy: { createdAt: 'desc' },
                  take: 50,
                },
              },
            }),
          })
          return { ...batch, assignments }
        }),
      )

      return { success: true, data: { batches: withAssignments } }
    },
  )

  // ============== 单作业统计（老师）==============
  fastify.get(
    '/assignments/:id/stats',
    { preHandler: [fastify.authenticate, fastify.requireRole('teacher')] },
    async (req, reply) => {
      const { id } = req.params as { id: string }
      const teacherId = req.user!.uid

      const assignment = await fastify.prisma.assignment.findUnique({
        where: { id },
        include: {
          submissions: { orderBy: { createdAt: 'desc' } },
        },
      })
      if (!assignment) {
        reply.code(404)
        return { success: false, error: 'ASSIGNMENT_NOT_FOUND' }
      }
      if (assignment.teacherId !== teacherId) {
        reply.code(403)
        return { success: false, error: 'NOT_ASSIGNMENT_OWNER' }
      }

      // 班级所有学生
      const members = await fastify.prisma.classMember.findMany({
        where: { classId: assignment.classId, status: 'ACTIVE' },
        include: { student: true },
      })

      const submittedIds = new Set(assignment.submissions.map((s) => s.studentId))
      const notSubmitted = members
        .filter((m) => !submittedIds.has(m.studentId))
        .map((m) => ({
          id: m.student.id,
          name: m.student.name,
          avatarUrl: m.student.avatarUrl,
        }))

      return {
        success: true,
        data: {
          assignment: {
            id: assignment.id,
            questionTitle: assignment.questionTitle,
            referenceText: assignment.referenceText,
            deadline: assignment.deadline,
          },
          submissionCount: assignment.submissions.length,
          studentCount: members.length,
          notSubmittedStudents: notSubmitted,
          submissions: assignment.submissions,
        },
      }
    },
  )

  // ============== 学生：我的提交历史 ==============
  fastify.get(
    '/student/submissions',
    { preHandler: [fastify.authenticate, fastify.requireRole('student')] },
    async (req) => {
      const { assignmentId } = (req.query as any) || {}
      const studentId = req.user!.uid

      const where: any = { studentId }
      if (assignmentId) where.assignmentId = assignmentId

      const submissions = await fastify.prisma.submission.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      })

      let remainingAttempts: number | null = null
      if (assignmentId) {
        const assignment = await fastify.prisma.assignment.findUnique({
          where: { id: assignmentId },
        })
        if (assignment) {
          const max = (fastify as any).config?.MAX_SUBMISSIONS_PER_ASSIGNMENT ?? 10
          remainingAttempts = Math.max(0, max - submissions.length)
        }
      }

      return {
        success: true,
        data: { submissions, remainingAttempts },
      }
    },
  )

  // ============== 老师：班级学生列表（带用户信息）==============
  fastify.post(
    '/classes/students',
    { preHandler: [fastify.authenticate, fastify.requireRole('teacher')] },
    async (req) => {
      const { studentIds } = (req.body || {}) as { studentIds: string[] }
      if (!Array.isArray(studentIds)) {
        return { success: false, error: 'INVALID_INPUT' }
      }
      const users = await fastify.prisma.user.findMany({
        where: { id: { in: studentIds } },
        select: { id: true, name: true, avatarUrl: true, openid: true },
      })
      return { success: true, data: users }
    },
  )
}

// 辅助：classId 类型守卫（用 Prisma 生成的类型更稳，这里简化）
function classId(m: { classId: string }) {
  return m.classId
}