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
            // 检查是否为失败状态
            if (submission.status === 'failed') {
              this.setData({
                submission,
                error: submission.error || '评分失败，请重新提交',
                loading: false
              });
            } else if (submission.status === 'pending') {
              // 待评分状态，显示提示
              this.setData({
                submission,
                loading: false
              });
              wx.showToast({
                title: '评分中，请稍候...',
                icon: 'none',
                duration: 3000
              });
            } else {
              // 评分完成
              this.setData({
                submission,
                loading: false
              });
            }
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

  get isFailed() {
    return this.data.submission?.status === 'failed';
  },

  get isPending() {
    return this.data.submission?.status === 'pending';
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
