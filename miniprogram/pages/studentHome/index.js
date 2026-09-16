// pages/studentHome/index.js
const app = getApp();

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
    this.refreshUserInfoFromCloud();
  },

  async refreshUserInfoFromCloud() {
    const cached = this.data.userInfo;
    if (!cached || !cached._openid) return;
    try {
      const res = await wx.cloud.callFunction({
        name: 'login',
        data: {
          role: cached.role,
          name: cached.name,
          avatarUrl: cached.avatarUrl
        }
      });
      if (res.result.success) {
        const fresh = res.result.data;
        app.globalData.userInfo = fresh;
        wx.setStorageSync('userInfo', fresh);
        this.setData({ userInfo: fresh });
        if (fresh.role !== cached.role) {
          wx.redirectTo({
            url: fresh.role === 'teacher'
              ? '/pages/teacherHome/index'
              : '/pages/studentHome/index'
          });
        }
      }
    } catch (e) {
      console.log('[refreshUserInfo] 静默失败', e);
    }
  },

  loadData() {
    wx.showLoading({ title: '加载中...' });
    wx.cloud.callFunction({
      name: 'getStudentTodoList',
      data: {},
      success: (res) => {
        wx.hideLoading();
        if (res.result.success) {
          const { assignments, batches, classes } = res.result.data;
          const debug = res.result.debug || {};

          // 第一次进入时，只展开最新批次
          const expandedBatchIdsMap = {};
          if (batches && batches.length > 0) {
            expandedBatchIdsMap[batches[0]._id] = true;
          }

          const pendingCount = (assignments || []).filter(a => !a.submitted).length;

          let debugInfo = '';
          if (!assignments || assignments.length === 0) {
            if (debug.message) debugInfo = debug.message;
            if (debug.classIds) debugInfo += `\n查询的班级ID: ${debug.classIds.join(', ')}`;
          }

          this.setData({
            assignments: assignments || [],
            batches: batches || [],
            expandedBatchIdsMap,
            classes,
            classCount: classes.length,
            pendingCount,
            debugInfo
          });
        } else {
          const debug = res.result.debug || {};
          let errorMsg = res.result.error || '获取失败';
          if (debug.openid) errorMsg += `\nopenid: ${debug.openid}`;
          if (debug.step) errorMsg += `\n失败步骤: ${debug.step}`;
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