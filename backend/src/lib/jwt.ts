import jwt from 'jsonwebtoken'
import { config } from '../config'

export interface TokenPayload {
  uid: string
  openid: string
  role: 'teacher' | 'student'
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: '7d',
    issuer: 'hometutor-nas',
  })
}

export function verifyToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, config.JWT_SECRET, {
    issuer: 'hometutor-nas',
  })
  if (typeof decoded === 'string') {
    throw new Error('Token 格式错误')
  }
  return decoded as unknown as TokenPayload
}