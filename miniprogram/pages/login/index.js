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
    tempInviteCode: ''
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
      tempInviteCode: ''
    });
  },

  // 返回登录首页
  goBack() {
    this.setData({ showUserInfoModal: false });
  },

  // 选择头像
  chooseAvatar() {
    wx.chooseImage({
      count: 1,
      success: (res) => {
        const tempFilePaths = res.tempFilePaths;
        this.setData({ tempAvatarUrl: tempFilePaths[0] });
      }
    });
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
    const { tempRole, tempNickName, tempAvatarUrl, tempInviteCode } = this.data;

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
