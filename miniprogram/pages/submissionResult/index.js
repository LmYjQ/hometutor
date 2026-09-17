// pages/submissionResult/index.js
const app = getApp();
const { request } = require('../../utils/request');

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

  async loadResult() {
    this.setData({ loading: true, error: '' });
    try {
      const res = await request(`/api/submissions/${this.data.submissionId}`, {
        method: 'GET',
      });
      if (res && res.success && res.data) {
        const submission = res.data;
        // 兼容老字段
        submission._id = submission.id || submission._id;
        submission.audio_text = submission.audioText || submission.audio_text;

        if (submission.status === 'FAILED') {
          this.setData({
            submission,
            error: submission.error || '评分失败，请重新提交',
            loading: false,
          });
        } else if (submission.status === 'PENDING') {
          this.setData({ submission, loading: false });
          wx.showToast({
            title: '评分中，请稍候...',
            icon: 'none',
            duration: 3000,
          });
        } else {
          this.setData({ submission, loading: false });
        }
      } else {
        this.setData({
          error: (res && res.error) || '获取结果失败',
          loading: false,
        });
      }
    } catch (err) {
      console.error('获取结果失败:', err);
      this.setData({
        error: '网络错误，请重试',
        loading: false,
      });
    }
  },

  get scoreColor() {
    const score = this.data.submission?.score || 0;
    if (score >= 80) return '#52c41a';
    if (score >= 60) return '#faad14';
    return '#ff4d4f';
  },

  get isFailed() {
    return this.data.submission?.status === 'FAILED'
      || this.data.submission?.status === 'failed';
  },

  get isPending() {
    return this.data.submission?.status === 'PENDING'
      || this.data.submission?.status === 'pending';
  },

  goToRecitation() {
    const assignmentId = this.data.submission?.assignmentId
      || this.data.submission?.assignment_id;
    wx.redirectTo({
      url: `/pages/recitation/index?assignmentId=${assignmentId}`,
    });
  },

  goBack() {
    wx.navigateBack();
  }
});