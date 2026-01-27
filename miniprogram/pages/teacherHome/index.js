// pages/teacherHome/index.js
const app = getApp();

Page({
  data: {
    userInfo: {},
    classes: [],
    classCount: 0,
    studentCount: 0,
    showModal: false,
    newClassName: '',
    creating: false
  },

  onShow() {
    this.loadUserInfo();
    this.loadClasses();
  },

  loadUserInfo() {
    const userInfo = app.globalData.userInfo || wx.getStorageSync('userInfo');
    if (userInfo) {
      this.setData({ userInfo });
    } else {
      wx.redirectTo({ url: '/pages/login/index' });
    }
  },

  loadClasses() {
    wx.cloud.callFunction({
      name: 'getMyClasses',
      data: {},
      success: (res) => {
        if (res.result.success) {
          const classes = res.result.data;
          const studentCount = classes.reduce((sum, cls) => sum + (cls.student_ids?.length || 0), 0);
          this.setData({
            classes,
            classCount: classes.length,
            studentCount
          });
        }
      },
      fail: (err) => {
        console.error('加载班级失败:', err);
      }
    });
  },

  showCreateClassModal() {
    this.setData({ showModal: true, newClassName: '' });
  },

  hideModal() {
    this.setData({ showModal: false });
  },

  onClassNameInput(e) {
    this.setData({ newClassName: e.detail.value });
  },

  createClass() {
    const name = this.data.newClassName.trim();
    if (!name) {
      wx.showToast({ title: '请输入班级名称', icon: 'none' });
      return;
    }

    this.setData({ creating: true });

    wx.cloud.callFunction({
      name: 'createClass',
      data: { name },
      success: (res) => {
        if (res.result.success) {
          wx.showToast({ title: '创建成功', icon: 'success' });
          this.hideModal();
          this.loadClasses();
        } else {
          wx.showToast({ title: res.result.error || '创建失败', icon: 'none' });
        }
      },
      fail: (err) => {
        console.error('创建班级失败:', err);
        wx.showToast({ title: '创建失败', icon: 'none' });
      },
      complete: () => {
        this.setData({ creating: false });
      }
    });
  },

  goToClassDetail(e) {
    const classId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/classDetail/index?classId=${classId}`
    });
  },

  goToProfile() {
    wx.navigateTo({
      url: '/pages/myProfile/index'
    });
  },

  onShareAppMessage() {
    return {
      title: '智能背诵助手 - 快速创建班级',
      path: '/pages/login/index'
    };
  }
});
