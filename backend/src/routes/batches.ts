import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const deleteSchema = z.object({
  batchId: z.string(),
})

export default async function (fastify: FastifyInstance) {
  // 软删除批次（老师）
  fastify.post(
    '/batches/delete',
    { preHandler: [fastify.authenticate, fastify.requireRole('teacher')] },
    async (req, reply) => {
      const parsed = deleteSchema.safeParse(req.body)
      if (!parsed.success) {
        reply.code(400)
        return { success: false, error: 'INVALID_INPUT' }
      }
      const { batchId } = parsed.data
      const teacherId = req.user!.uid

      const batch = await fastify.prisma.assignmentBatch.findUnique({
        where: { id: batchId },
      })
      if (!batch) {
        reply.code(404)
        return { success: false, error: 'BATCH_NOT_FOUND' }
      }
      if (batch.teacherId !== teacherId) {
        reply.code(403)
        return { success: false, error: 'NOT_BATCH_OWNER' }
      }

      await fastify.prisma.$transaction([
        fastify.prisma.assignment.updateMany({
          where: { batchId },
          data: { status: 'DELETED' },
        }),
        fastify.prisma.assignmentBatch.update({
          where: { id: batchId },
          data: { status: 'DELETED', deletedAt: new Date() },
        }),
      ])

      return { success: true }
    },
  )
}