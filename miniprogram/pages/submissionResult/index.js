// pages/submissionResult/index.js
const app = getApp();

Page({
  data: {
    submissionId: '',
    loading: true,
    error: '',
    submission: null
  },

  onLoad(options) {
    if (options.submissionId) {
      this.setData({ submissionId: options.submissionId });
      this.loadResult();
    }
  },

  loadResult() {
    this.setData({ loading: true, error: '' });

    wx.cloud.callFunction({
      name: 'getStudentSubmissions',
      data: { submissionId: this.data.submissionId },
      success: (res) => {
        if (res.result.success) {
          const submission = res.result.data[0];
          if (submission) {
            this.setData({
              submission,
              loading: false
            });
          } else {
            this.setData({
              error: '未找到提交记录',
              loading: false
            });
          }
        } else {
          this.setData({
            error: res.result.error || '获取结果失败',
            loading: false
          });
        }
      },
      fail: (err) => {
        console.error('获取结果失败:', err);
        this.setData({
          error: '网络错误，请重试',
          loading: false
        });
      }
    });
  },

  get scoreColor() {
    const score = this.data.submission?.score || 0;
    if (score >= 80) return '#52c41a';
    if (score >= 60) return '#faad14';
    return '#ff4d4f';
  },

  goToRecitation() {
    const assignmentId = this.data.submission?.assignment_id;
    wx.redirectTo({
      url: `/pages/recitation/index?assignmentId=${assignmentId}`
    });
  },

  goBack() {
    wx.navigateBack();
  }
});
