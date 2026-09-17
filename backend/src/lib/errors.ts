export class AppError extends Error {
  statusCode: number
  code: string
  constructor(statusCode: number, code: string, message: string) {
    super(message)
    this.statusCode = statusCode
    this.code = code
    this.name = 'AppError'
  }
}

export function createError(statusCode: number, code: string, message: string) {
  return new AppError(statusCode, code, message)
}

export const errors = {
  missingToken: () => createError(401, 'MISSING_TOKEN', '未提供 token'),
  invalidToken: () => createError(401, 'INVALID_TOKEN', 'token 无效或已过期'),
  forbidden: () => createError(403, 'FORBIDDEN', '无权限访问该资源'),
  notFound: (what = '资源') => createError(404, 'NOT_FOUND', `${what}不存在`),
  invalidInviteCode: () => createError(400, 'INVALID_INVITE_CODE', '邀请码无效或已用完'),
  inviteCodeRequired: () => createError(400, 'INVITE_CODE_REQUIRED', '老师注册需要邀请码'),
  rateLimited: () => createError(429, 'RATE_LIMITED', '请求过于频繁'),
  internal: (msg = '服务器内部错误') => createError(500, 'INTERNAL_ERROR', msg),
  badRequest: (msg: string) => createError(400, 'BAD_REQUEST', msg),
  conflict: (msg: string) => createError(409, 'CONFLICT', msg),
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError
}