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
    return this.data.userInfo.role === 'teacher' ? '老师' : '学生';
  },

  switchRole() {
    wx.showModal({
      title: '切换身份',
      content: '切换身份后需要重新登录',
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
