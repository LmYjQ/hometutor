// pages/myProfile/index.js
const app = getApp();

Page({
  data: {
    userInfo: {}
  },

  onShow() {
    const userInfo = app.globalData.userInfo || wx.getStorageSync('userInfo');
    this.setData({ userInfo });
  },

  get roleText() {
    const role = this.data.userInfo.role;
    return role === 'teacher' ? '老师' : '学生';
  },

  switchIdentity() {
    wx.showModal({
      title: '切换身份',
      content: '切换身份需要重新注册，是否继续？',
      success: (res) => {
        if (res.confirm) {
          this.logout();
        }
      }
    });
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
