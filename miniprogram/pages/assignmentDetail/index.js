// pages/assignmentDetail/index.js
const app = getApp();
const { request } = require('../../utils/request');

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

  async loadData() {
    this.setData({ loading: true });
    try {
      const res = await request(`/api/assignments/${this.data.assignmentId}/stats`, {
        method: 'GET',
      });
      if (res && res.success && res.data) {
        const {
          assignment,
          submissions = [],
          notSubmittedStudents = [],
          submissionCount,
          studentCount,
        } = res.data;

        const submittedCount = submissionCount != null
          ? submissionCount
          : submissions.length;
        const totalStudentCount = studentCount != null
          ? studentCount
          : (submittedCount + (notSubmittedStudents.length || 0));
        const notSubmittedCount = Math.max(0, totalStudentCount - submittedCount);

        // 构造简化版 studentStats（按 studentId 聚合最新一条）
        const byStudent = new Map();
        for (const s of submissions) {
          if (!byStudent.has(s.studentId)) byStudent.set(s.studentId, s);
        }
        const studentStats = Array.from(byStudent.values()).map((s) => ({
          student: {
            id: s.studentId,
            name: s.studentName,
            avatarUrl: s.avatarUrl,
          },
          latestSubmission: s,
          submissionCount: submissions.filter((x) => x.studentId === s.studentId).length,
        }));

        const deadlineText = assignment && assignment.deadline
          ? this.formatDate(new Date(assignment.deadline))
          : '';
        const statusText = (assignment && (assignment.status === 'DELETED' || assignment.status === 'deleted'))
          ? '已结束'
          : '进行中';

        this.setData({
          assignment: {
            id: assignment?.id,
            question_title: assignment?.questionTitle,
            reference_text: assignment?.referenceText,
            deadline: assignment?.deadline,
            deadlineText,
            statusText,
          },
          studentStats,
          notSubmittedStudents,
          submittedCount,
          notSubmittedCount,
          totalStudentCount,
          loading: false,
        });
      } else {
        console.error((res && res.error) || '加载失败');
        this.setData({ loading: false });
      }
    } catch (err) {
      console.error('加载失败:', err);
      this.setData({ loading: false });
    }
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