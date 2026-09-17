import axios, { AxiosError } from 'axios'
import FormData from 'form-data'
import { config } from '../config'
import { createError } from './errors'

const BASE_URL = 'https://api.siliconflow.cn/v1'

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: {
    Authorization: `Bearer ${config.SILICONFLOW_API_KEY}`,
  },
})

export interface ASRResult {
  text: string
}

export async function speechToText(
  audioBuffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<ASRResult> {
  const form = new FormData()
  form.append('file', audioBuffer, { filename, contentType: mimeType })
  form.append('model', config.SILICONFLOW_ASR_MODEL)

  try {
    const { data } = await client.post('/audio/transcriptions', form, {
      headers: form.getHeaders(),
      maxBodyLength: 100 * 1024 * 1024,
      maxContentLength: 100 * 1024 * 1024,
      timeout: 30000,
    })
    return { text: data.text ?? '' }
  } catch (e) {
    const ax = e as AxiosError
    const msg = ax.response?.data ? JSON.stringify(ax.response.data) : ax.message
    throw createError(502, 'ASR_FAILED', `ASR 调用失败: ${msg}`)
  }
}

export interface LLMScoreResult {
  score: number
  missing_points: string[]
  comment: string
}

const LLM_PROMPT = `你是一位语文老师，正在批改学生的背诵作业。请对比【参考文本】和【学生背诵文本】，按以下 JSON 格式输出评分结果：

{
  "score": "0-100 的整数，越高越好",
  "missing_points": ["漏背的内容片段", "..."],
  "comment": "给学生的鼓励评语，30 字以内"
}

评分标准：
- 100 分：完全一致，无错漏
- 80-99 分：有个别错字、漏字
- 60-79 分：部分段落漏背
- 60 分以下：严重缺失或跑题
- 仅当确实漏背具体内容时，才把对应原文片段填入 missing_points

【参考文本】：
{reference}

【学生背诵文本】：
{student}`

export async function scoreRecitation(
  referenceText: string,
  studentText: string,
): Promise<LLMScoreResult> {
  const prompt = LLM_PROMPT
    .replace('{reference}', referenceText)
    .replace('{student}', studentText)

  try {
    const { data } = await client.post(
      '/chat/completions',
      {
        model: config.SILICONFLOW_LLM_MODEL,
        messages: [
          { role: 'system', content: '你是一个返回严格 JSON 的助手。' },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 500,
        enable_thinking: false,
        temperature: 0.3,
      },
      { timeout: 15000 },
    )

    const content = data?.choices?.[0]?.message?.content
    if (!content) throw new Error('LLM 返回内容为空')

    const parsed = JSON.parse(content)
    return {
      score: typeof parsed.score === 'number' ? parsed.score : parseInt(parsed.score) || 0,
      missing_points: Array.isArray(parsed.missing_points) ? parsed.missing_points : [],
      comment: typeof parsed.comment === 'string' ? parsed.comment : '',
    }
  } catch (e) {
    const ax = e as AxiosError
    const msg = ax.response?.data ? JSON.stringify(ax.response.data) : (e as Error).message
    throw createError(502, 'LLM_FAILED', `LLM 调用失败: ${msg}`)
  }
}