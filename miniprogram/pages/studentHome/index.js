// pages/studentHome/index.js
const app = getApp();
const { request } = require('../../utils/request');

Page({
  data: {
    userInfo: {},
    assignments: [],          // 兼容旧 UI（暂不用，保留）
    batches: [],              // 批次化作业列表（UI 用这个）
    expandedBatchIdsMap: {},  // { batchId: true } 当前展开的批次
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
      return;
    }
    this.refreshUserInfoFromBackend();
  },

  async refreshUserInfoFromBackend() {
    const cached = this.data.userInfo;
    if (!cached) return;
    const openid = cached._openid || cached.openid;
    if (!openid) return;
    try {
      const res = await request('/api/profile/me', { method: 'GET' });
      if (res && res.success && res.data) {
        const fresh = res.data;
        fresh._openid = fresh._openid || fresh.openid;
        app.globalData.userInfo = fresh;
        wx.setStorageSync('userInfo', fresh);
        this.setData({ userInfo: fresh });
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

  async loadData() {
    wx.showLoading({ title: '加载中...' });
    try {
      const res = await request('/api/student/todo-list', { method: 'GET' });
      wx.hideLoading();
      if (res && res.success && res.data) {
        const { assignments, batches } = res.data;
        // classes 不在 todo-list 里，从 getMyClasses 单独拉一次（合并到 loadClasses 也可以）
        let classes = this.data.classes;
        if (!classes || classes.length === 0) {
          try {
            const clsRes = await request('/api/classes', { method: 'GET' });
            if (clsRes && clsRes.success && clsRes.data) {
              classes = clsRes.data.studying || [];
            }
          } catch (e) {
            console.warn('拉班级失败', e);
          }
        }

        // 第一次进入时，只展开最新批次（兼容老字段 _id 和新字段 id）
        const expandedBatchIdsMap = {};
        if (batches && batches.length > 0) {
          const firstId = batches[0].id || batches[0]._id;
          if (firstId) expandedBatchIdsMap[firstId] = true;
        }

        const pendingCount = (assignments || []).filter((a) => !a.submitted).length;

        this.setData({
          assignments: assignments || [],
          batches: batches || [],
          expandedBatchIdsMap,
          classes,
          classCount: classes.length,
          pendingCount,
          debugInfo: '',
        });
      } else {
        this.setData({
          debugInfo: (res && res.error) || '获取失败',
        });
      }
    } catch (err) {
      wx.hideLoading();
      console.error('加载数据失败:', err);
      this.setData({ debugInfo: '后端调用失败: ' + JSON.stringify(err) });
    }
  },

  refreshAssignments() {
    this.setData({ debugInfo: '' });
    this.loadData();
  },

  // 折叠 / 展开批次
  toggleBatch(e) {
    const id = e.currentTarget.dataset.id;
    const map = { ...this.data.expandedBatchIdsMap };
    if (map[id]) {
      delete map[id];
    } else {
      map[id] = true;
    }
    this.setData({ expandedBatchIdsMap: map });
  },

  goToJoinClass() {
    wx.navigateTo({ url: '/pages/joinClass/index' });
  },

  goToRecitation(e) {
    const assignmentId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/recitation/index?assignmentId=${assignmentId}`,
    });
  },

  goToProfile() {
    wx.navigateTo({
      url: '/pages/myProfile/index',
    });
  },

  onShareAppMessage() {
    return {
      title: '智能背诵助手 - 加入班级一起学习',
      path: '/pages/login/index',
    };
  },
});