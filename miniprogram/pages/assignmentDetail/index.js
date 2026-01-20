// pages/assignmentDetail/index.js
const app = getApp();

Page({
  data: {
    assignmentId: '',
    className: '',
    loading: true,
    assignment: null,
    submissions: [],
    submittedCount: 0,
    studentCount: 0
  },

  onLoad(options) {
    if (options.assignmentId) {
      this.setData({
        assignmentId: options.assignmentId,
        className: options.className || ''
      });
      this.loadData();
    }
  },

  loadData() {
    this.setData({ loading: true });

    // 获取作业详情和提交情况
    wx.cloud.callFunction({
      name: 'getAssignmentSubmissions',
      data: { assignmentId: this.data.assignmentId },
      success: (res) => {
        if (res.result.success) {
          const assignments = res.result.data;
          const assignment = assignments.find(a => a._id === this.data.assignmentId);
          if (assignment) {
            // 获取该作业的所有提交
            this.loadSubmissions(assignment);
          }
        }
      },
      fail: (err) => {
        console.error('加载失败:', err);
        this.setData({ loading: false });
      }
    });
  },

  loadSubmissions(assignment) {
    const db = wx.cloud.database();
    const _ = db.command;

    db.collection('submissions')
      .where({ assignment_id: this.data.assignmentId })
      .orderBy('created_at', 'desc')
      .get()
      .then((res) => {
        const submissions = res.data.map(s => ({
          ...s,
          statusText: s.status === 'graded' ? '已评分' : '评分中',
          created_atText: this.formatDate(s.created_at)
        }));

        this.setData({
          assignment,
          submissions,
          submittedCount: submissions.length,
          studentCount: assignment.studentCount || 0,
          loading: false
        });
      })
      .catch((err) => {
        console.error('获取提交列表失败:', err);
        this.setData({ loading: false });
      });
  },

  formatDate(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${month}月${day}日 ${hours}:${minutes}`;
  },

  viewSubmission(e) {
    const submissionId = e.currentTarget.dataset.id;
    // 可以跳转到详情页，或弹出评分结果
    wx.showModal({
      title: '评分详情',
      content: '功能开发中，可通过后台查看详细评分',
      showCancel: false
    });
  }
});
