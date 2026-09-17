import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { verifyToken, TokenPayload } from '../lib/jwt'
import { errors } from '../lib/errors'

declare module 'fastify' {
  interface FastifyRequest {
    user?: TokenPayload
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireRole: (role: 'teacher' | 'student') => (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

export default fp(async (fastify: FastifyInstance) => {
  fastify.decorate('authenticate', async (req, reply) => {
    const auth = req.headers.authorization
    if (!auth?.startsWith('Bearer ')) {
      reply.code(401).send({ success: false, error: 'MISSING_TOKEN' })
      return
    }
    try {
      req.user = verifyToken(auth.slice(7))
    } catch {
      reply.code(401).send({ success: false, error: 'INVALID_TOKEN' })
    }
  })

  fastify.decorate('requireRole', (role) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      if (!req.user) {
        reply.code(401).send({ success: false, error: 'MISSING_TOKEN' })
        return
      }
      if (req.user.role !== role) {
        reply.code(403).send({ success: false, error: 'FORBIDDEN' })
      }
    }
  })
})