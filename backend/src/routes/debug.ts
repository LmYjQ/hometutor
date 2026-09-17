import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { downloadFile, inferMimeType, inferExtension } from '../lib/cloudbase'
import { speechToText, scoreRecitation } from '../lib/siliconflow'

const speechSchema = z.object({
  fileID: z.string(),
})

const llmSchema = z.object({
  referenceText: z.string(),
  studentText: z.string(),
})

export default async function (fastify: FastifyInstance) {
  // 调试用：纯 ASR
  fastify.post(
    '/debug/speech',
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const parsed = speechSchema.safeParse(req.body)
      if (!parsed.success) {
        reply.code(400)
        return { success: false, error: 'INVALID_INPUT' }
      }
      const { buffer } = await downloadFile(parsed.data.fileID)
      const { text } = await speechToText(
        buffer,
        `audio.${inferExtension(parsed.data.fileID)}`,
        inferMimeType(parsed.data.fileID),
      )
      return { success: true, data: { text } }
    },
  )

  // 调试用：纯 LLM
  fastify.post(
    '/debug/llm',
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const parsed = llmSchema.safeParse(req.body)
      if (!parsed.success) {
        reply.code(400)
        return { success: false, error: 'INVALID_INPUT' }
      }
      const result = await scoreRecitation(parsed.data.referenceText, parsed.data.studentText)
      return { success: true, data: result }
    },
  )
}