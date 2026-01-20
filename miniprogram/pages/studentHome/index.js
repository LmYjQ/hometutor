// pages/studentHome/index.js
const app = getApp();

Page({
  data: {
    userInfo: {},
    assignments: [],
    classes: [],
    classCount: 0,
    pendingCount: 0
  },

  onShow() {
    this.loadUserInfo();
    this.loadData();
  },

  loadUserInfo() {
    const userInfo = app.globalData.userInfo || wx.getStorageSync('userInfo');
    if (userInfo) {
      this.setData({ userInfo });
    } else {
      wx.redirectTo({ url: '/pages/login/index' });
    }
  },

  loadData() {
    wx.cloud.callFunction({
      name: 'getStudentTodoList',
      data: {},
      success: (res) => {
        if (res.result.success) {
          const { assignments, classes } = res.result.data;
          const pendingCount = assignments.filter(a => !a.submitted).length;
          this.setData({
            assignments,
            classes,
            classCount: classes.length,
            pendingCount
          });
        }
      },
      fail: (err) => {
        console.error('加载数据失败:', err);
      }
    });
  },

  goToJoinClass() {
    wx.navigateTo({ url: '/pages/joinClass/index' });
  },

  goToRecitation(e) {
    const assignmentId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/recitation/index?assignmentId=${assignmentId}`
    });
  },

  onShareAppMessage() {
    return {
      title: '智能背诵助手 - 加入班级一起学习',
      path: '/pages/login/index'
    };
  }
});
