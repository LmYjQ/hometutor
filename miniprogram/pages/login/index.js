// pages/login/index.js
const app = getApp();
const { request, uploadToCloud } = require('../../utils/request');

Page({
  data: {
    loading: false,
    isLoggingIn: false,
    showUserInfoModal: false,
    tempRole: 'student',
    tempNickName: '',
    tempAvatarUrl: '',
    tempInviteCode: '',
    uploadingAvatar: false
  },

  onLoad() {
    this.checkAndLogin();
  },

  // 检查并自动登录
  async checkAndLogin() {
    const userInfo = wx.getStorageSync('userInfo');
    const openid = wx.getStorageSync('openid');

    if (userInfo && openid && userInfo.role) {
      this.setData({ isLoggingIn: true });
      try {
        const res = await this.doLogin({
          role: userInfo.role,
          name: userInfo.name,
          avatarUrl: userInfo.avatarUrl
        });

        if (res && res.success && res.data) {
          this.persistAuth(res.data);
          this.navigateToHome(res.data.user.role);
          return;
        }
      } catch (e) {
        console.log('自动登录失败:', e);
      }
      this.setData({ isLoggingIn: false });
    }
  },

  // 显示用户信息填写页面
  showUserInfoModal(e) {
    const role = e?.currentTarget?.dataset?.role || 'student';
    this.setData({
      showUserInfoModal: true,
      tempRole: role,
      tempNickName: '',
      tempAvatarUrl: '',
      tempInviteCode: '',
      uploadingAvatar: false
    });
  },

  // 返回登录首页
  goBack() {
    this.setData({ showUserInfoModal: false });
  },

  // 微信选择头像（button open-type="chooseAvatar" 的回调）
  async onChooseAvatar(e) {
    const tempPath = e.detail.avatarUrl;
    if (!tempPath) return;

    this.setData({ uploadingAvatar: true });
    try {
      const fileID = await this.uploadAvatar(tempPath);
      this.setData({ tempAvatarUrl: fileID });
      wx.showToast({ title: '头像已上传', icon: 'success', duration: 800 });
    } catch (err) {
      console.error('上传头像失败:', err);
      wx.showToast({ title: '头像上传失败，请重试', icon: 'none' });
    } finally {
      this.setData({ uploadingAvatar: false });
    }
  },

  /**
   * 上传头像到 CloudBase，返回 fileID
   * 阶段 1：仍用 wx.cloud.uploadFile（NAS 后端不存头像，仅透传 fileID）
   * 阶段 3：可改成直传 MinIO
   */
  async uploadAvatar(tempPath) {
    const openid = wx.getStorageSync('openid') || 'anon';
    const ext = (tempPath.match(/\.(\w{2,5})$/) || ['', 'jpg'])[1];
    const cloudPath = `avatar/${openid}_${Date.now()}.${ext}`;

    const res = await uploadToCloud({
      cloudPath,
      filePath: tempPath
    });

    if (!res.fileID) {
      throw new Error('uploadFile 返回空 fileID');
    }
    return res.fileID;
  },

  // 昵称输入
  onNicknameInput(e) {
    this.setData({ tempNickName: e.detail.value });
  },

  // 邀请码输入
  onInviteCodeInput(e) {
    this.setData({ tempInviteCode: e.detail.value });
  },

  // 选择角色
  selectRole(e) {
    this.setData({ tempRole: e.currentTarget.dataset.role });
  },

  // 确认登录
  async confirmLogin() {
    const { tempRole, tempNickName, tempAvatarUrl, tempInviteCode, uploadingAvatar } = this.data;

    if (uploadingAvatar) {
      wx.showToast({ title: '头像还在上传中', icon: 'none' });
      return;
    }
    if (!tempNickName.trim()) {
      wx.showToast({ title: '请输入昵称', icon: 'none' });
      return;
    }
    if (tempRole === 'teacher' && !tempInviteCode.trim()) {
      wx.showToast({ title: '请输入邀请码', icon: 'none' });
      return;
    }

    this.setData({ loading: true });

    try {
      const res = await this.doLogin({
        role: tempRole,
        name: tempNickName,
        avatarUrl: tempAvatarUrl,
        inviteCode: tempInviteCode || ''
      });

      if (res && res.success && res.data) {
        this.persistAuth(res.data);

        wx.showToast({
          title: res.data.isNew ? '注册成功' : '登录成功',
          icon: 'success'
        });

        setTimeout(() => {
          this.navigateToHome(res.data.user.role);
        }, 1500);
      } else {
        wx.showToast({
          title: (res && res.error) || '登录失败',
          icon: 'none'
        });
      }
    } catch (err) {
      console.error('登录失败:', err);
      wx.showToast({ title: '登录失败，请重试', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  /**
   * 登录核心：wx.login() 拿 code，调 request('/api/auth/login')
   * 双路径都在 utils/request.js 里处理
   */
  async doLogin({ role, name, avatarUrl, inviteCode }) {
    const { code } = await new Promise((resolve, reject) => {
      wx.login({
        success: (res) => res.code ? resolve(res) : reject(new Error('wx.login 失败')),
        fail: reject,
      })
    })

    return request('/api/auth/login', {
      method: 'POST',
      skipAuth: true,
      data: {
        code,
        role,
        name,
        avatarUrl,
        inviteCode: role === 'teacher' ? inviteCode : undefined,
      },
    })
  },

  /**
   * 持久化登录态
   * 老路径（云函数）：user 有 _openid
   * 新路径（后端）：user 有 openid（且额外有 token）
   */
  persistAuth(data) {
    const user = data.user || {}
    const useNas = app.globalData.useNasApi

    // 兼容两个字段名（其他页面用 _openid / openid 都有可能）
    user._openid = user._openid || user.openid

    app.globalData.userInfo = user
    app.globalData.role = user.role
    wx.setStorageSync('userInfo', user)
    wx.setStorageSync('openid', user._openid)

    // 仅 NAS 后端返回 token
    if (useNas && data.token) {
      wx.setStorageSync('token', data.token)
    }
  },

  // 根据角色跳转到对应首页
  navigateToHome(role) {
    if (role === 'teacher') {
      wx.redirectTo({ url: '/pages/teacherHome/index' });
    } else {
      wx.redirectTo({ url: '/pages/studentHome/index' });
    }
  }
});