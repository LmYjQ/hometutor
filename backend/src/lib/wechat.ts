import axios from 'axios'
import { config } from '../config'
import { createError } from './errors'

interface Code2SessionResult {
  openid: string
  unionid?: string
  sessionKey: string
}

const ERROR_MAP: Record<number, { code: string; retryable: boolean }> = {
  40029: { code: 'INVALID_CODE', retryable: false },
  40163: { code: 'CODE_USED', retryable: false },
  40226: { code: 'INVALID_APPID', retryable: false },
  45011: { code: 'RATE_LIMIT', retryable: true },
  [-1]: { code: 'WECHAT_SYSTEM_BUSY', retryable: true },
}

export async function code2Session(code: string): Promise<Code2SessionResult> {
  let response
  try {
    response = await axios.get(
      'https://api.weixin.qq.com/sns/jscode2session',
      {
        params: {
          appid: config.WECHAT_APPID,
          secret: config.WECHAT_SECRET,
          js_code: code,
          grant_type: 'authorization_code',
        },
        timeout: 5000,
      },
    )
  } catch (e) {
    throw createError(503, 'WECHAT_UNREACHABLE', '微信服务暂时不可达')
  }

  const data = response.data as {
    errcode?: number
    errmsg?: string
    openid?: string
    unionid?: string
    session_key?: string
  }

  if (data.errcode && data.errcode !== 0) {
    const mapped = ERROR_MAP[data.errcode] ?? {
      code: `WECHAT_ERR_${data.errcode}`,
      retryable: false,
    }
    throw createError(400, mapped.code, `code2Session 失败: ${data.errmsg}`)
  }

  if (!data.openid || !data.session_key) {
    throw createError(500, 'WECHAT_BAD_RESPONSE', '微信返回数据异常')
  }

  return {
    openid: data.openid,
    unionid: data.unionid,
    sessionKey: data.session_key,
  }
}