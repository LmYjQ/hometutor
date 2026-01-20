// pages/classDetail/index.js
Page({
  data: {
    classId: '',
    classInfo: {
      name: '',
      invite_code: '',
      student_ids: []
    },
    assignments: []
  },

  onLoad(options) {
    if (options.classId) {
      this.setData({ classId: options.classId });
      this.loadClassDetail();
    }
  },

  loadClassDetail() {
    wx.showLoading({ title: '加载中...' });

    // 获取班级详情
    wx.cloud.callFunction({
      name: 'getMyClasses',
      data: {},
      success: (res) => {
        if (res.result.success) {
          const classInfo = res.result.data.find(c => c._id === this.data.classId);
          if (classInfo) {
            this.setData({ classInfo });
          }
        }
      }
    });

    // 获取作业列表
    wx.cloud.callFunction({
      name: 'getAssignmentSubmissions',
      data: { classId: this.data.classId },
      success: (res) => {
        if (res.result.success) {
          const assignments = res.result.data.map(a => ({
            ...a,
            statusText: a.status === 'active' ? '进行中' : '已结束'
          }));
          this.setData({ assignments });
        }
      },
      fail: (err) => {
        console.error('加载作业列表失败:', err);
      },
      complete: () => {
        wx.hideLoading();
      }
    });
  },

  copyInviteCode() {
    wx.setClipboardData({
      data: this.data.classInfo.invite_code,
      success: () => {
        wx.showToast({ title: '已复制邀请码', icon: 'success' });
      }
    });
  },

  goToAssignmentDetail(e) {
    const assignmentId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/assignmentDetail/index?assignmentId=${assignmentId}&className=${this.data.classInfo.name}`
    });
  }
});
