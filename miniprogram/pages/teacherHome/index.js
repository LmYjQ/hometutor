// pages/teacherHome/index.js
const app = getApp();
const { request } = require('../../utils/request');

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
      return;
    }
    // 后台静默刷新：从后端拉一次最新 userInfo
    this.refreshUserInfoFromBackend();
  },

  async refreshUserInfoFromBackend() {
    const cached = this.data.userInfo;
    if (!cached) return;
    const openid = cached._openid || cached.openid;
    if (!openid) return;
    try {
      // 用 JWT 拉当前用户（不再调 /api/auth/login，那个需要 wx.login() 的 code）
      const res = await request('/api/profile/me', { method: 'GET' });
      if (res && res.success && res.data) {
        const fresh = res.data;
        // 同时更新 openid 字段兼容老格式
        fresh._openid = fresh._openid || fresh.openid;
        app.globalData.userInfo = fresh;
        wx.setStorageSync('userInfo', fresh);
        this.setData({ userInfo: fresh });
        // role 不一致则跳到对应首页
        if (fresh.role !== cached.role) {
          wx.redirectTo({
            url: fresh.role === 'teacher'
              ? '/pages/teacherHome/index'
              : '/pages/studentHome/index',
          });
        }
      }
    } catch (e) {
      console.log('[refreshUserInfo] 静默失败', e);
    }
  },

  async loadClasses() {
    try {
      const res = await request('/api/classes', { method: 'GET' });
      if (res && res.success && res.data) {
        const classes = res.data.teaching || [];
        // 兼容老格式：student_ids[] 与新格式：_count.members
        const studentCount = classes.reduce((sum, cls) => {
          if (cls._count && typeof cls._count.members === 'number') {
            return sum + cls._count.members;
          }
          if (Array.isArray(cls.student_ids)) {
            return sum + cls.student_ids.length;
          }
          return sum;
        }, 0);
        this.setData({
          classes,
          classCount: classes.length,
          studentCount,
        });
      }
    } catch (err) {
      console.error('加载班级失败:', err);
    }
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

  async createClass() {
    const name = this.data.newClassName.trim();
    if (!name) {
      wx.showToast({ title: '请输入班级名称', icon: 'none' });
      return;
    }

    this.setData({ creating: true });
    try {
      const res = await request('/api/classes', {
        method: 'POST',
        data: { name },
      });
      if (res && res.success) {
        wx.showToast({ title: '创建成功', icon: 'success' });
        this.hideModal();
        this.loadClasses();
      } else {
        wx.showToast({ title: (res && res.error) || '创建失败', icon: 'none' });
      }
    } catch (err) {
      console.error('创建班级失败:', err);
      wx.showToast({ title: '创建失败', icon: 'none' });
    } finally {
      this.setData({ creating: false });
    }
  },

  goToClassDetail(e) {
    const classId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/classDetail/index?classId=${classId}`,
    });
  },

  goToProfile() {
    wx.navigateTo({
      url: '/pages/myProfile/index',
    });
  },

  onShareAppMessage() {
    return {
      title: '智能背诵助手 - 快速创建班级',
      path: '/pages/login/index',
    };
  },
});