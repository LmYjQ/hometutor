/**
 * 严格走 NAS 后端的请求封装。
 *
 * 用法：
 *   const { request } = require('../../utils/request')
 *   const res = await request('/api/auth/login', {
 *     method: 'POST',
 *     skipAuth: true,
 *     data: { code, role, name, avatarUrl, inviteCode },
 *   })
 *
 * 设计原则：
 * - 阶段 1+：所有业务接口**只走 NAS 后端**，不再 fallback 到 CloudBase 云函数
 * - NAS 登录失败就直接报错，**不静默 fallback**
 * - 视频上传仍走 CloudBase（阶段 1+2 过渡期）：用 uploadToCloud
 * - 阶段 3 切 MinIO 后：uploadToCloud 也会被替换
 */

function assertNasMode() {
  const app = getApp()
  if (!app || !app.globalData || !app.globalData.apiBase) {
    throw new Error('NAS API 未初始化：app.js 缺少 apiBase 配置')
  }
  // ⚠️ 严格模式：不再支持 useNasApi=false 走 CloudBase 的方式
  // 阶段 1 起所有业务接口只走 NAS 后端
  if (app.globalData.useNasApi === false) {
    throw new Error('NAS API 模式被关闭，请检查 app.js useNasApi 配置（必须为 true）')
  }
}

function request(url, options = {}) {
  const { method = 'GET', data, header, timeout = 10000, skipAuth = false } = options || {}

  assertNasMode()

  const app = getApp()
  const baseUrl = app.globalData.apiBase
  const token = skipAuth ? null : wx.getStorageSync('token')

  return new Promise((resolve, reject) => {
    wx.request({
      url: baseUrl + url,
      method,
      data,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(header || {}),
      },
      timeout,
      success: (res) => {
        if (res.statusCode === 401) {
          handleAuthFail()
          return reject(res.data || { error: 'UNAUTHORIZED' })
        }
        resolve(res.data)
      },
      fail: (err) => reject(err),
    })
  })
}

/**
 * 上传文件到 CloudBase（仅头像 / 视频文件）
 * 阶段 1+2：业务接口走 NAS，但 fileID 仍存 CloudBase（NAS submitRecitation 用 fileID 下载）
 * 阶段 3：切 MinIO 后这个函数也会被替换
 */
function uploadToCloud(options) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud) {
      reject(new Error('wx.cloud 不可用'))
      return
    }
    wx.cloud.uploadFile({
      cloudPath: options.cloudPath,
      filePath: options.filePath,
    }).then(resolve).catch(reject)
  })
}

function handleAuthFail() {
  wx.removeStorageSync('token')
  wx.removeStorageSync('userInfo')
  wx.removeStorageSync('openid')
  const app = getApp()
  if (app && app.globalData) {
    app.globalData.userInfo = null
    app.globalData.role = null
  }
  wx.showToast({ title: '请重新登录', icon: 'none' })
  setTimeout(() => {
    wx.reLaunch({ url: '/pages/login/index' })
  }, 800)
}

module.exports = { request, uploadToCloud }