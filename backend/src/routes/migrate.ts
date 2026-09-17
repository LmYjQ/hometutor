import type { FastifyInstance } from 'fastify'

/**
 * 一次性迁移脚本的 HTTP 入口（也可直接用 scripts/migrate-from-cloudbase.ts）
 * 给旧 assignment 补 batch_id（按 class_id + ISO 周分组）
 */
export default async function (fastify: FastifyInstance) {
  fastify.post(
    '/migrate-legacy-assignments',
    { preHandler: [fastify.authenticate] },
    async (req) => {
      const { dryRun } = (req.body as any) || {}

      const legacy = await fastify.prisma.assignment.findMany({
        where: { batchId: null },
        orderBy: { createdAt: 'asc' },
      })

      if (legacy.length === 0) {
        return { success: true, data: { message: 'no legacy assignments', migrated: 0 } }
      }

      // 按 class_id + ISO 周分组
      const groups = new Map<string, typeof legacy>()
      for (const a of legacy) {
        const week = getISOWeek(a.createdAt)
        const key = `${a.classId}::${week}`
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(a)
      }

      if (dryRun) {
        return {
          success: true,
          data: {
            message: 'dry run',
            totalLegacy: legacy.length,
            groups: Array.from(groups.entries()).map(([k, v]) => ({
              key,
              count: v.length,
            })),
          },
        }
      }

      let migratedBatches = 0
      for (const [key, items] of groups) {
        const [classId, week] = key.split('::')
        const first = items[0]
        const batch = await fastify.prisma.assignmentBatch.create({
          data: {
            classId,
            className: first.className,
            teacherId: first.teacherId,
            teacherName: '',
            title: `历史作业 ${week}`,
            assignmentCount: items.length,
          },
        })
        await fastify.prisma.assignment.updateMany({
          where: { id: { in: items.map((a) => a.id) } },
          data: { batchId: batch.id },
        })
        migratedBatches++
      }

      return {
        success: true,
        data: { migratedBatches, totalLegacy: legacy.length },
      }
    },
  )
}

function getISOWeek(d: Date): string {
  const date = new Date(d)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7))
  const week1 = new Date(date.getFullYear(), 0, 4)
  const weekNum =
    1 +
    Math.round(
      ((date.getTime() - week1.getTime()) / 86400000 -
        3 +
        ((week1.getDay() + 6) % 7)) /
        7,
    )
  return `${date.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
}