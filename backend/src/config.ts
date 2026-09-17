import 'dotenv/config'
import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  WECHAT_APPID: z.string().min(1, 'WECHAT_APPID 必填'),
  WECHAT_SECRET: z.string().min(1, 'WECHAT_SECRET 必填'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET 必须 ≥32 字节'),

  DATABASE_URL: z.string().min(1),

  SILICONFLOW_API_KEY: z.string().min(1, 'SILICONFLOW_API_KEY 必填'),
  SILICONFLOW_ASR_MODEL: z.string().default('FunAudioLLM/SenseVoiceSmall'),
  SILICONFLOW_LLM_MODEL: z.string().default('Qwen/Qwen2.5-7B-Instruct'),

  CLOUDBASE_ENV_ID: z.string().default('hometutor-dev-d2gz5nh53c67ecd73'),

  MAX_SUBMISSIONS_PER_ASSIGNMENT: z.coerce.number().default(10),
  INVITE_SEED_CODE: z.string().default('TEACH2026'),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('❌ 环境变量配置错误：')
  console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2))
  process.exit(1)
}

export const config = parsed.data