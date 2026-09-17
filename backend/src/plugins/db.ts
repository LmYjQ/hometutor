import fp from 'fastify-plugin'
import { PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient
  }
}

export default fp(async (fastify: FastifyInstance) => {
  const prisma = new PrismaClient({
    log:
      fastify.log.level === 'debug' || fastify.log.level === 'trace'
        ? ['query', 'error', 'warn']
        : ['error'],
  })

  try {
    await prisma.$connect()
    fastify.log.info('✓ Prisma connected to Postgres')
  } catch (e) {
    fastify.log.error({ err: e }, 'Prisma 连接失败')
    throw e
  }

  fastify.decorate('prisma', prisma)

  fastify.addHook('onClose', async () => {
    await prisma.$disconnect()
  })
})