import type { FastifyInstance } from 'fastify'

export default async function (fastify: FastifyInstance) {
  fastify.get('/health', async () => {
    // 顺便测一下 DB
    let dbOk = false
    try {
      await fastify.prisma.$queryRaw`SELECT 1`
      dbOk = true
    } catch (e) {
      fastify.log.warn({ err: e }, 'DB health check failed')
    }
    return {
      ok: dbOk,
      timestamp: new Date().toISOString(),
      version: '0.1.0',
    }
  })
}