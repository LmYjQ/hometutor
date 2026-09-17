import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { config } from '../config'
import {
  downloadFile,
  deleteFile,
  inferMimeType,
  inferExtension,
} from '../lib/cloudbase'
import { speechToText, scoreRecitation } from '../lib/siliconflow'

const submitSchema = z.object({
  assignmentId: z.string(),
  fileID: z.string().min(1),
})

export default async function (fastify: FastifyInstance) {
  // 核心：提交背诵
  fastify.post(
    '/submit-recitation',
    {
      preHandler: [fastify.authenticate],
      config: {
        rateLimit: { max: 20, timeWindow: '1 minute' },
      },
    },
    async (req, reply) => {
      const parsed = submitSchema.safeParse(req.body)
      if (!parsed.success) {
        reply.code(400)
        return { success: false, error: 'INVALID_INPUT', message: parsed.error.message }
      }
      const { assignmentId, fileID } = parsed.data
      const studentId = req.user!.uid

      // 1. 校验作业存在
      const assignment = await fastify.prisma.assignment.findUnique({
        where: { id: assignmentId },
      })
      if (!assignment) {
        reply.code(404)
        return { success: false, error: 'ASSIGNMENT_NOT_FOUND' }
      }
      if (assignment.status === 'DELETED') {
        reply.code(410)
        return { success: false, error: 'ASSIGNMENT_DELETED' }
      }

      // 2. 校验提交次数
      const submittedCount = await fastify.prisma.submission.count({
        where: { assignmentId, studentId },
      })
      if (submittedCount >= config.MAX_SUBMISSIONS_PER_ASSIGNMENT) {
        reply.code(429)
        return { success: false, error: 'MAX_SUBMISSIONS_EXCEEDED' }
      }

      // 3. 拿学生信息（用于冗余字段）
      const student = await fastify.prisma.user.findUnique({
        where: { id: studentId },
      })
      if (!student) {
        reply.code(404)
        return { success: false, error: 'STUDENT_NOT_FOUND' }
      }

      // 4. 写 PENDING 记录
      const submission = await fastify.prisma.submission.create({
        data: {
          assignmentId,
          studentId,
          studentName: student.name,
          avatarUrl: student.avatarUrl,
          videoFileId: fileID,
          status: 'PENDING',
        },
      })

      try {
        // 5. 下载视频（15s 超时）
        const { buffer } = await downloadFile(fileID, 15000)
        const mimeType = inferMimeType(fileID)
        const filename = `recitation.${inferExtension(fileID)}`

        // 6. ASR（30s 超时）
        const { text: audioText } = await speechToText(buffer, filename, mimeType)

        // 7. LLM 评分（15s 超时）
        const { score, missing_points, comment } = await scoreRecitation(
          assignment.referenceText,
          audioText,
        )

        // 8. 更新为 GRADED
        await fastify.prisma.submission.update({
          where: { id: submission.id },
          data: {
            audioText,
            score: Math.max(0, Math.min(100, score)),
            missingPoints: missing_points,
            comment,
            status: 'GRADED',
          },
        })

        // 9. 删除视频（节省成本；失败不阻塞）
        deleteFile(fileID).catch(() => {})

        return {
          success: true,
          data: {
            submissionId: submission.id,
            audioText,
            score: Math.max(0, Math.min(100, score)),
            missingPoints: missing_points,
            comment,
            status: 'GRADED',
          },
        }
      } catch (e) {
        // 评分失败：标 FAILED
        const msg = (e as Error).message || '评分失败'
        await fastify.prisma.submission.update({
          where: { id: submission.id },
          data: { status: 'FAILED', comment: msg },
        })
        reply.code(500)
        return { success: false, error: 'SCORING_FAILED', message: msg }
      }
    },
  )
}