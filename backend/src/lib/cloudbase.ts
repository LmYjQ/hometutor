/**
 * 阶段 1：仍用 CloudBase SDK 下载视频
 * 阶段 2/3：替换为 MinIO SDK
 */
import cloudbase from '@cloudbase/node-sdk'
import axios from 'axios'
import { config } from '../config'
import { createError } from './errors'

let _app: ReturnType<typeof cloudbase.init> | null = null

export function getCloudBaseApp() {
  if (!_app) {
    _app = cloudbase.init({
      env: config.CLOUDBASE_ENV_ID,
    })
  }
  return _app
}

interface DownloadResult {
  buffer: Buffer
  contentType: string
}

/**
 * 从 CloudBase fileID 下载文件 Buffer
 * @param fileID cloud://env.xxx/路径
 * @param timeoutMs 下载超时（默认 15s，留给 ASR/LLM 空间）
 */
export async function downloadFile(
  fileID: string,
  timeoutMs = 15000,
): Promise<DownloadResult> {
  const app = getCloudBaseApp()
  const { fileList } = await app.getTempFileURL({
    fileList: [fileID],
  })
  const tempUrl = fileList?.[0]?.tempFileURL
  if (!tempUrl) {
    throw createError(404, 'FILE_NOT_FOUND', 'fileID 不存在或已过期')
  }

  try {
    const response = await axios.get<ArrayBuffer>(tempUrl, {
      responseType: 'arraybuffer',
      timeout: timeoutMs,
      maxContentLength: 100 * 1024 * 1024,
    })
    const buffer = Buffer.from(response.data)
    const contentType =
      (response.headers['content-type'] as string) || 'application/octet-stream'
    return { buffer, contentType }
  } catch (e) {
    throw createError(502, 'FILE_DOWNLOAD_FAILED', `视频下载失败: ${(e as Error).message}`)
  }
}

/**
 * 删除 CloudBase 上的文件
 */
export async function deleteFile(fileID: string): Promise<void> {
  try {
    const app = getCloudBaseApp()
    await app.deleteFile({ fileList: [fileID] })
  } catch (e) {
    // 删除失败不阻塞主流程，只警告
    console.warn(`删除文件 ${fileID} 失败:`, (e as Error).message)
  }
}

/**
 * 根据 fileID 推断 MIME 类型
 */
export function inferMimeType(fileID: string): string {
  const ext = fileID.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    m4a: 'audio/mp4',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
  }
  return map[ext] || 'application/octet-stream'
}

export function inferExtension(fileID: string): string {
  return fileID.split('.').pop()?.toLowerCase() ?? 'mp4'
}