// pages/studentSubmissionDetail/index.js
// 展示「某学生在某作业」下的所有提交记录（按时间倒序），含每次的分数、背诵内容、评语、遗漏点。

const app = getApp();

Page({
  data: {
    assignmentId: '',
    studentId: '',
    studentName: '',
    loading: true,
    studentInfo: null,
    submissions: [],
    bestScore: 0,
    lastScore: 0
  },

  onLoad(options) {
    this.setData({
      assignmentId: options.assignmentId || '',
      studentId: options.studentId || '',
      studentName: options.studentName || '学生'
    });
    if (this.data.assignmentId && this.data.studentId) {
      wx.setNavigationBarTitle({ title: `${this.data.studentName}的提交` });
      this.loadData();
    } else {
      wx.showToast({ title: '参数错误', icon: 'none' });
    }
  },

  async loadData() {
    this.setData({ loading: true });
    wx.showLoading({ title: '加载中...', mask: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'getAssignmentSubmissions',
        data: {
          assignmentId: this.data.assignmentId,
          includeSubmissions: true   // ← 关键：拿回 audio_text / evaluation 等完整字段
        }
      });

      if (!res.result.success) {
        wx.showToast({ title: res.result.error || '加载失败', icon: 'none' });
        this.setData({ loading: false });
        return;
      }

      // 后端返回的 data 是作业数组，每个作业的 submissions[] 是该作业的全部提交
      // 我们要的是当前作业的那一项
      const assignments = res.result.data || [];
      const currentAssignment = assignments.find(a => a._id === this.data.assignmentId);
      const allSubmissions = currentAssignment?.submissions || [];

      // 按 studentId 过滤出该学生的提交
      const mine = allSubmissions.filter(s => s.student_id === this.data.studentId);

      // 排序：按 created_at 倒序（最新在最上）
      mine.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      // 算最高分 / 最近分
      const bestScore = mine.reduce((max, s) => Math.max(max, s.score || 0), 0);
      const lastScore = mine.length > 0 ? (mine[0].score || 0) : 0;

      // 格式化展示字段
      const formatted = mine.map((s, idx) => {
        const created = new Date(s.created_at);
        const isLatest = idx === 0;
        return {
          _id: s._id,
          // round 从大到小（第 N 次，最新是 N=1）
          round: mine.length - idx,
          score: s.score || 0,
          audioText: s.audio_text || '',
          comment: s.evaluation?.comment || '',
          missingPoints: s.evaluation?.missing_points || [],
          status: s.status,
          statusText: s.status === 'graded' ? '已完成' : (s.status === 'failed' ? '失败' : '处理中'),
          error: s.error || '',
          createdAtText: this.formatDateTime(created)
        };
      });

      const studentInfo = {
        student_id: this.data.studentId,
        student_name: this.data.studentName,
        avatarUrl: mine[0]?.avatarUrl || ''
      };

      this.setData({
        studentInfo,
        submissions: formatted,
        bestScore,
        lastScore,
        loading: false
      });
    } catch (err) {
      console.error('[studentSubmissionDetail] loadData 失败:', err);
      wx.showToast({ title: '加载失败，请重试', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ loading: false });
    }
  },

  formatDateTime(date) {
    const M = (date.getMonth() + 1).toString().padStart(2, '0');
    const D = date.getDate().toString().padStart(2, '0');
    const h = date.getHours().toString().padStart(2, '0');
    const m = date.getMinutes().toString().padStart(2, '0');
    return `${M}-${D} ${h}:${m}`;
  }
});