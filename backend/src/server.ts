import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { config } from './config'
import dbPlugin from './plugins/db'
import authPlugin from './plugins/auth'
import healthRoutes from './routes/health'
import authRoutes from './routes/auth'
import classesRoutes from './routes/classes'
import assignmentsRoutes from './routes/assignments'
import profileRoutes from './routes/profile'
import batchesRoutes from './routes/batches'
import submissionsRoutes from './routes/submissions'
import initRoutes from './routes/init'
import debugRoutes from './routes/debug'
import migrateRoutes from './routes/migrate'
import { isAppError } from './lib/errors'

const fastify = Fastify({
  logger: {
    level: config.LOG_LEVEL,
    transport:
      config.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss.l' } }
        : undefined,
  },
  trustProxy: true,
  bodyLimit: 50 * 1024 * 1024, // 50MB（视频上传分包后会变小，正常 JSON 用不到）
})

async function bootstrap() {
  // CORS（小程序不需要，但浏览器调试 + curl 测试有用）
  await fastify.register(cors, {
    origin: true,
    credentials: true,
  })

  // 全局限流（每个 endpoint 可单独 override）
  await fastify.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
    global: true,
    cache: 10000,
  })

  // 业务插件
  await fastify.register(dbPlugin)
  await fastify.register(authPlugin)

  // 业务路由
  await fastify.register(healthRoutes)
  await fastify.register(authRoutes, { prefix: '/api' })
  await fastify.register(classesRoutes, { prefix: '/api' })
  await fastify.register(assignmentsRoutes, { prefix: '/api' })
  await fastify.register(profileRoutes, { prefix: '/api' })
  await fastify.register(batchesRoutes, { prefix: '/api' })
  await fastify.register(submissionsRoutes, { prefix: '/api' })
  await fastify.register(initRoutes, { prefix: '/api' })
  await fastify.register(debugRoutes, { prefix: '/api' })
  await fastify.register(migrateRoutes, { prefix: '/api' })

  // 全局错误处理
  fastify.setErrorHandler((err, req, reply) => {
    if (isAppError(err)) {
      reply.code(err.statusCode).send({
        success: false,
        error: err.code,
        message: err.message,
      })
      return
    }
    req.log.error({ err }, '未捕获错误')
    reply.code((err as any).statusCode ?? 500).send({
      success: false,
      error: 'INTERNAL_ERROR',
      message: config.NODE_ENV === 'development' ? err.message : '服务器内部错误',
    })
  })

  // 404
  fastify.setNotFoundHandler((req, reply) => {
    reply.code(404).send({
      success: false,
      error: 'NOT_FOUND',
      message: `路由 ${req.method} ${req.url} 不存在`,
    })
  })

  // 优雅关闭
  const shutdown = async (signal: string) => {
    fastify.log.info(`收到 ${signal}，开始关闭...`)
    await fastify.close()
    process.exit(0)
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  // 启动
  try {
    await fastify.listen({ port: config.PORT, host: '0.0.0.0' })
    fastify.log.info(`🚀 Server ready at http://0.0.0.0:${config.PORT}`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

bootstrap()