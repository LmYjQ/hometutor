// pages/assignmentDetail/index.js
const app = getApp();

Page({
  data: {
    assignmentId: '',
    className: '',
    loading: true,
    assignment: null,
    studentStats: [],          // 已提交学生
    notSubmittedStudents: [],  // 未提交学生
    submittedCount: 0,
    notSubmittedCount: 0,
    totalStudentCount: 0,
    showNotSubmitted: false    // 默认折叠未提交列表
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

    wx.cloud.callFunction({
      name: 'getAssignmentStudentStats',
      data: { assignmentId: this.data.assignmentId },
      success: (res) => {
        if (res.result.success) {
          const {
            assignment,
            studentStats,
            notSubmittedStudents,
            submittedCount,
            notSubmittedCount,
            totalStudentCount
          } = res.result.data;

          const deadline = new Date(assignment.deadline);
          const deadlineText = this.formatDate(deadline);

          this.setData({
            assignment: {
              ...assignment,
              deadlineText,
              statusText: assignment.status === 'active' ? '进行中' : '已结束'
            },
            studentStats,
            notSubmittedStudents,
            submittedCount,
            notSubmittedCount,
            totalStudentCount,
            loading: false
          });
        } else {
          console.error(res.result.error);
          this.setData({ loading: false });
        }
      },
      fail: (err) => {
        console.error('加载失败:', err);
        this.setData({ loading: false });
      }
    });
  },

  formatDate(date) {
    if (!date) return '';
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${month}月${day}日 ${hours}:${minutes}`;
  },

  // 折叠/展开未提交学生
  toggleNotSubmitted() {
    this.setData({ showNotSubmitted: !this.data.showNotSubmitted });
  },

  // 点学生卡片 → 跳学生提交详情
  // 注意：之前是 wx.showModal 提示，体验差；现在直接跳转（页面已存在）
  viewStudentSubmissions(e) {
    const { studentId, studentName } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/studentSubmissionDetail/index?assignmentId=${this.data.assignmentId}&studentId=${studentId}&studentName=${studentName}`
    });
  }
});