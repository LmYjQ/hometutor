// pages/assignmentDetail/index.js
const app = getApp();

Page({
  data: {
    assignmentId: '',
    className: '',
    loading: true,
    assignment: null,
    studentStats: [],
    submittedCount: 0,
    totalStudentCount: 0
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
          const { assignment, studentStats, submittedCount, totalStudentCount } = res.result.data;
          // 格式化截止时间
          const deadline = new Date(assignment.deadline);
          const deadlineText = this.formatDate(deadline);

          this.setData({
            assignment: {
              ...assignment,
              deadlineText,
              statusText: assignment.status === 'active' ? '进行中' : '已结束'
            },
            studentStats,
            submittedCount,
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

  viewStudentSubmissions(e) {
    const { studentId, studentName } = e.currentTarget.dataset;
    wx.showModal({
      title: studentName,
      content: '可进入学生详情页查看该学生的所有提交记录',
      confirmText: '查看详情',
      success: (res) => {
        if (res.confirm) {
          wx.navigateTo({
            url: `/pages/studentSubmissionDetail/index?assignmentId=${this.data.assignmentId}&studentId=${studentId}&studentName=${studentName}`
          });
        }
      }
    });
  }
});
