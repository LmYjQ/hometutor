/**
 * 双路径请求封装：
 * - app.globalData.useNasApi === false → 走 wx.cloud.callFunction（云函数，老路径）
 * - app.globalData.useNasApi === true  → 走 wx.request（NAS 后端，新路径）
 *
 * 用法：
 *   const { request } = require('../../utils/request')
 *   const res = await request('/api/auth/login', {
 *     method: 'POST',
 *     data: { code, role, name, avatarUrl, inviteCode },
 *   })
 *
 * 灰度策略：app.js 里 globalData.useNasApi 控制开关；阶段 1 默认 false
 */

const app = getApp()

/**
 * 老路径：把 URL 翻译成云函数名
 *   /api/auth/login          → auth-login
 *   /api/classes/join        → classes-join
 *   /api/assignments/publish → assignments-publish
 */
function pathToFnName(url) {
  return url
    .replace(/^\/api\//, '')
    .replace(/\//g, '-')
}

function isWeChatCall(client) {
  return typeof client === 'object' && typeof client.callFunction === 'function'
}

function request(url, options = {}) {
  const { method = 'GET', data, header, timeout = 10000, skipAuth = false } = options || {}
  const useNas = app && app.globalData && app.globalData.useNasApi
  const token = skipAuth ? null : wx.getStorageSync('token')

  return new Promise((resolve, reject) => {
    if (!useNas) {
      // 老路径：wx.cloud.callFunction（仅支持 POST 风格调用云函数）
      const fnName = pathToFnName(url)
      const wxCloud = (typeof wx !== 'undefined' && wx.cloud) ? wx.cloud : null
      if (!wxCloud) {
        reject(new Error('wx.cloud 不可用'))
        return
      }
      wxCloud.callFunction({
        name: fnName,
        data: data || {},
        config: { timeout },
      }).then((res) => {
        const result = res && res.result
        if (result && result.success === false && result.error === 'INVALID_TOKEN') {
          handleAuthFail()
        }
        resolve(result)
      }).catch(reject)
      return
    }

    // 新路径：wx.request
    const baseUrl = app.globalData.apiBase
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
 * 上传文件（新路径：直接 wx.uploadFile 到后端）
 * 老路径：保留 wx.cloud.uploadFile 不变（头像/视频上传走云存储阶段 1+2 不动）
 *
 * 阶段 3 才切 MinIO，所以这里只暴露 uploadToCloud（wx.cloud.uploadFile 包装）
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