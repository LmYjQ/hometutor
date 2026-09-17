// pages/myProfile/index.js
const app = getApp();
const { request, uploadToCloud } = require('../../utils/request');

// 开发者专属的 openid：只有这个微信号能看到「切换身份」入口（用于开发测试）
// ⚠️ 这是硬编码字符串，不是密钥，公开了不影响安全（云函数端还会再校验一次）
const DEV_OPENID = 'oiVIk7edZTVoBqYBkMAIU6PixJDk';

Page({
  data: {
    userInfo: {},
    uploadingAvatar: false,
    showSwitchRole: false,    // 是否显示「切换身份」入口
    switchTargetRole: '',     // 'student' | 'teacher'
    switchInviteCode: '',      // student → teacher 时需要
    switching: false
  },

  onLoad() {
    // 第一次进入时同步读一次缓存（onShow 之前，避免渲染出空白 userInfo）
    this.ensureUserInfo();
  },

  onShow() {
    // 每次显示都重新读缓存（onShow 触发时可能从其他页面带回新的 globalData）
    this.ensureUserInfo();
  },

  // 兜底：如果 globalData 和 storage 都空（罕见，比如清缓存后第一次进）
  // 直接读 storage 兜底
  ensureUserInfo() {
    let userInfo = app.globalData.userInfo;
    if (!userInfo || !userInfo._openid) {
      userInfo = wx.getStorageSync('userInfo');
    }
    if (userInfo) {
      this.setData({
        userInfo,
        showSwitchRole: userInfo._openid === DEV_OPENID
      });
      app.globalData.userInfo = userInfo;
    }
  },

  get roleText() {
    const role = this.data.userInfo.role;
    return role === 'teacher' ? '老师' : '学生';
  },

  // ====== 修改昵称：弹 modal 输入 ======
  editNickname() {
    console.log('[editNickname] 进入，userInfo:', this.data.userInfo);
    const currentName = this.data.userInfo.name || '';

    // 用 showModal 的 editable 模式：用户输入新名字，点确认拿到 res.content
    // 注意：content 为空字符串时部分客户端可能吞掉回调，所以加个兜底
    wx.showModal({
      title: '修改昵称',
      editable: true,
      placeholderText: '请输入新昵称',
      content: currentName || ' ',
      success: async (res) => {
        console.log('[editNickname] modal success:', res);
        if (!res.confirm) {
          wx.showToast({ title: '已取消', icon: 'none' });
          return;
        }
        const newName = (res.content || '').trim();
        if (!newName) {
          wx.showToast({ title: '昵称不能为空', icon: 'none' });
          return;
        }
        if (newName === currentName) {
          wx.showToast({ title: '昵称未变化', icon: 'none' });
          return;
        }
        if (newName.length > 30) {
          wx.showToast({ title: '昵称不能超过 30 个字符', icon: 'none' });
          return;
        }
        await this.callUpdateProfile({ name: newName });
      },
      fail: (err) => {
        console.error('[editNickname] modal fail:', err);
        wx.showToast({ title: '弹窗失败', icon: 'none' });
      }
    });
  },

  // ====== 修改头像 ======
  editAvatar() {
    // 实际触发逻辑在 onChooseAvatar
  },

  // button open-type="chooseAvatar" 的回调
  async onChooseAvatar(e) {
    console.log('[onChooseAvatar] 触发，event:', e);
    const tempPath = e.detail.avatarUrl;
    if (!tempPath) {
      console.warn('[onChooseAvatar] 没拿到 avatarUrl');
      return;
    }
    this.setData({ uploadingAvatar: true });
    wx.showLoading({ title: '上传头像中...', mask: true });
    try {
      const fileID = await this.uploadAvatar(tempPath);
      console.log('[onChooseAvatar] 上传成功 fileID:', fileID);
      await this.callUpdateProfile({ avatarUrl: fileID });
    } catch (err) {
      console.error('[onChooseAvatar] 换头像失败:', err);
      wx.showToast({ title: '头像上传失败，请重试', icon: 'none' });
    } finally {
      this.setData({ uploadingAvatar: false });
      wx.hideLoading();
    }
  },

  async uploadAvatar(tempPath) {
    const openid = wx.getStorageSync('openid') || 'anon';
    const ext = (tempPath.match(/\.(\w{2,5})$/) || ['', 'jpg'])[1];
    const cloudPath = `avatar/${openid}_${Date.now()}.${ext}`;
    const res = await uploadToCloud({ cloudPath, filePath: tempPath });
    if (!res.fileID) throw new Error('uploadFile 返回空 fileID');
    return res.fileID;
  },

  /**
   * 调 updateProfile 云函数，成功后更新本地缓存 + globalData
   */
  async callUpdateProfile(payload) {
    wx.showLoading({ title: '保存中...', mask: true });
    try {
      const res = await request('/api/profile/update', {
        method: 'POST',
        data: payload,
      });
      wx.hideLoading();

      if (res && res.success && res.data) {
        const newUser = res.data;
        newUser._openid = newUser._openid || newUser.openid;
        app.globalData.userInfo = { ...this.data.userInfo, ...newUser };
        wx.setStorageSync('userInfo', app.globalData.userInfo);
        this.setData({ userInfo: app.globalData.userInfo });
        wx.showToast({ title: '已更新', icon: 'success' });
      } else {
        wx.showToast({ title: (res && res.error) || '更新失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      console.error('[callUpdateProfile] 失败:', err);
      wx.showToast({ title: '更新失败，请重试', icon: 'none' });
    }
  },

  // ====== 开发者专属：身份切换 ======
  // teacher → student：直接切
  // student → teacher：需要重新输入邀请码（沿用 invite_codes 校验）
  switchRole() {
    // 简化：点一下直接取反。teacher → student 直接确认；student → teacher 要邀请码。
    const target = this.data.userInfo.role === 'teacher' ? 'student' : 'teacher';

    if (target === 'student') {
      // teacher → student，直接确认
      wx.showModal({
        title: '切换身份',
        content: '确定从「老师」切换到「学生」？老师身份下创建的班级和作业不会被删除。',
        confirmText: '切换',
        success: async (res) => {
          if (res.confirm) await this.doSwitchRole('student');
        }
      });
    } else {
      // student → teacher，需要邀请码
      wx.showModal({
        title: '切换到老师',
        editable: true,
        placeholderText: '请输入邀请码',
        content: '',
        confirmText: '确认切换',
        success: async (res) => {
          if (!res.confirm) return;
          const code = (res.content || '').trim().toUpperCase();
          if (!code) {
            wx.showToast({ title: '请输入邀请码', icon: 'none' });
            return;
          }
          await this.doSwitchRole('teacher', code);
        }
      });
    }
  },

  async doSwitchRole(targetRole, inviteCode = '') {
    this.setData({ switching: true });
    wx.showLoading({ title: '切换中...', mask: true });
    try {
      const res = await request('/api/profile/update', {
        method: 'POST',
        data: { role: targetRole, inviteCode },
      });
      wx.hideLoading();
      this.setData({ switching: false });

      if (res && res.success && res.data) {
        const newUser = res.data;
        newUser._openid = newUser._openid || newUser.openid;
        app.globalData.userInfo = { ...this.data.userInfo, ...newUser };
        wx.setStorageSync('userInfo', app.globalData.userInfo);
        this.setData({ userInfo: app.globalData.userInfo });
        wx.showToast({ title: '切换成功', icon: 'success' });

        // 切完身份跳到对应首页
        setTimeout(() => {
          if (newUser.role === 'teacher') {
            wx.redirectTo({ url: '/pages/teacherHome/index' });
          } else {
            wx.redirectTo({ url: '/pages/studentHome/index' });
          }
        }, 800);
      } else {
        wx.showToast({ title: (res && res.error) || '切换失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      this.setData({ switching: false });
      console.error('[doSwitchRole] 失败:', err);
      wx.showToast({ title: '切换失败，请重试', icon: 'none' });
    }
  },

  goToTest() {
    wx.navigateTo({ url: '/pages/testFFmpeg/index' });
  },

  logout() {
    wx.removeStorageSync('userInfo');
    wx.removeStorageSync('openid');
    app.globalData.userInfo = null;
    app.globalData.role = null;
    wx.reLaunch({ url: '/pages/login/index' });
  },

  onShareAppMessage() {
    return {
      title: '智能背诵助手 - AI帮你检查背诵作业',
      path: '/pages/login/index'
    };
  }
});