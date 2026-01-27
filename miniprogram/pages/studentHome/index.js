// pages/studentHome/index.js
const app = getApp();

Page({
  data: {
    userInfo: {},
    assignments: [],
    classes: [],
    classCount: 0,
    pendingCount: 0,
    debugInfo: ''
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
    wx.showLoading({ title: '加载中...' });
    wx.cloud.callFunction({
      name: 'getStudentTodoList',
      data: {},
      success: (res) => {
        wx.hideLoading();
        console.log('getStudentTodoList 返回:', res.result);
        if (res.result.success) {
          const { assignments, classes } = res.result.data;
          const debug = res.result.debug || {};
          const pendingCount = assignments.filter(a => !a.submitted).length;

          let debugInfo = '';
          if (assignments.length === 0) {
            if (debug.message) {
              debugInfo = debug.message;
            }
            if (debug.classIds) {
              debugInfo += `\n查询的班级ID: ${debug.classIds.join(', ')}`;
            }
          }

          this.setData({
            assignments,
            classes,
            classCount: classes.length,
            pendingCount,
            debugInfo
          });
        } else {
          const debug = res.result.debug || {};
          let errorMsg = res.result.error || '获取失败';
          if (debug.openid) {
            errorMsg += `\nopenid: ${debug.openid}`;
          }
          if (debug.step) {
            errorMsg += `\n失败步骤: ${debug.step}`;
          }
          this.setData({ debugInfo: errorMsg });
        }
      },
      fail: (err) => {
        wx.hideLoading();
        console.error('加载数据失败:', err);
        this.setData({ debugInfo: '云函数调用失败: ' + JSON.stringify(err) });
      }
    });
  },

  refreshAssignments() {
    this.setData({ debugInfo: '' });
    this.loadData();
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

  goToProfile() {
    wx.navigateTo({
      url: '/pages/myProfile/index'
    });
  },

  onShareAppMessage() {
    return {
      title: '智能背诵助手 - 加入班级一起学习',
      path: '/pages/login/index'
    };
  }
});
