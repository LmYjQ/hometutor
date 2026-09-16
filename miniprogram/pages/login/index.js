// pages/login/index.js
const app = getApp();

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
        const res = await wx.cloud.callFunction({
          name: 'login',
          data: {
            role: userInfo.role,
            name: userInfo.name,
            avatarUrl: userInfo.avatarUrl
          }
        });

        if (res.result.success) {
          const user = res.result.data;
          app.globalData.userInfo = user;
          app.globalData.role = user.role;
          wx.setStorageSync('userInfo', user);
          wx.setStorageSync('openid', user._openid);
          this.navigateToHome(user.role);
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
  // 注意：返回的 avatarUrl 是 wxfile:// 临时路径，必须立刻上传到云存储，
  // 否则下次冷启动就失效。传失败就让用户重试，不让进 confirmLogin。
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
   * 把本地临时路径上传到云存储，返回永久 fileID
   * 路径：avatar/<openid>_<timestamp>.jpg（用 openid 防止同名覆盖冲突，
   *       同一用户再次上传会留下旧文件，不主动删除以避免影响加载）
   */
  async uploadAvatar(tempPath) {
    const openid = wx.getStorageSync('openid') || 'anon';
    const ext = (tempPath.match(/\.(\w{2,5})$/) || ['', 'jpg'])[1];
    const cloudPath = `avatar/${openid}_${Date.now()}.${ext}`;

    const res = await wx.cloud.uploadFile({
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
      const res = await wx.cloud.callFunction({
        name: 'login',
        data: {
          role: tempRole,
          name: tempNickName,
          avatarUrl: tempAvatarUrl,
          inviteCode: tempInviteCode || ''
        }
      });

      if (res.result.success) {
        const user = res.result.data;
        app.globalData.userInfo = user;
        app.globalData.role = user.role;
        wx.setStorageSync('userInfo', user);
        wx.setStorageSync('openid', user._openid);

        wx.showToast({
          title: user.isNew ? '注册成功' : '登录成功',
          icon: 'success'
        });

        setTimeout(() => {
          this.navigateToHome(user.role);
        }, 1500);
      } else {
        wx.showToast({
          title: res.result.error || '登录失败',
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

  // 根据角色跳转到对应首页
  navigateToHome(role) {
    if (role === 'teacher') {
      wx.redirectTo({ url: '/pages/teacherHome/index' });
    } else {
      wx.redirectTo({ url: '/pages/studentHome/index' });
    }
  }
});
