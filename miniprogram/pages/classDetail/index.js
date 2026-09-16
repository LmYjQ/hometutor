// pages/classDetail/index.js
//
// 作业批次化（v2）：
//   - 列表渲染从扁平 assignments[] 改为 batches[].assignments[]
//   - 默认只展开最新批次，历史批次折叠
//   - 「⋯」菜单 → 软删除批次
//   - legacy 批次不显示删除入口（避免误删旧作业）

Page({
  data: {
    classId: '',
    classInfo: { name: '', invite_code: '', student_ids: [] },
    students: [],
    batches: [],                      // [{ _id, title, assignments: [...], isLegacy }]
    expandedBatchIdsMap: {},          // { batchId: true } 仅展开的在里面
    showStudents: false,
    showBatchMenu: false,
    menuBatchId: '',
    menuBatchTitle: ''
  },

  onLoad(options) {
    if (options.classId) {
      this.setData({ classId: options.classId });
      this.loadClassDetail();
    }
  },

  onShow() {
    // 从发布页/详情页返回时刷新列表（新发布的批次要显示）
    if (this.data.classId) {
      this.loadAssignmentBatches();
    }
  },

  loadClassDetail() {
    wx.showLoading({ title: '加载中...' });

    // 1. 班级基本信息
    wx.cloud.callFunction({
      name: 'getMyClasses',
      data: {},
      success: (res) => {
        if (res.result.success) {
          const classInfo = res.result.data.find(c => c._id === this.data.classId);
          if (classInfo) {
            this.setData({ classInfo });
            this.loadStudents(classInfo.student_ids || []);
          }
        }
      }
    });

    // 2. 批次化作业列表
    this.loadAssignmentBatches();
  },

  loadAssignmentBatches() {
    wx.cloud.callFunction({
      name: 'getAssignmentSubmissions',
      data: { classId: this.data.classId },
      success: (res) => {
        if (!res.result.success) return;
        const batches = (res.result.data || []).map(b => ({
          ...b,
          // 给每个 assignment 加 statusText 给 UI 用
          assignments: (b.assignments || []).map(a => ({
            ...a,
            statusText: a.status === 'active' ? '进行中' : '已结束'
          }))
        }));

        // 默认只展开最新批次（数组已经按 created_at desc 排序）
        const expandedBatchIdsMap = {};
        if (batches.length > 0) {
          expandedBatchIdsMap[batches[0]._id] = true;
        }

        this.setData({ batches, expandedBatchIdsMap });
      },
      fail: (err) => console.error('加载作业列表失败:', err),
      complete: () => wx.hideLoading()
    });
  },

  // 拉所有学生的 name / avatarUrl
  loadStudents(studentIds) {
    if (!studentIds.length) {
      this.setData({ students: [] });
      return;
    }
    wx.cloud.callFunction({
      name: 'getClassStudents',
      data: { studentIds },
      success: (res) => {
        if (res.result.success) {
          this.setData({ students: res.result.data || [] });
        }
      },
      fail: (err) => console.error('加载学生列表失败:', err)
    });
  },

  copyInviteCode() {
    wx.setClipboardData({
      data: this.data.classInfo.invite_code,
      success: () => wx.showToast({ title: '已复制邀请码', icon: 'success' })
    });
  },

  toggleStudents() {
    this.setData({ showStudents: !this.data.showStudents });
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

  // 批次菜单入口
  onBatchMenu(e) {
    const id = e.currentTarget.dataset.id;
    const title = e.currentTarget.dataset.title;
    this.setData({
      showBatchMenu: true,
      menuBatchId: id,
      menuBatchTitle: title
    });
  },

  onBatchMenuChange(e) {
    // action-sheet 自身关闭时触发
    this.setData({ showBatchMenu: false });
  },

  // 确认删除批次
  onConfirmDeleteBatch(e) {
    const id = e.currentTarget.dataset.id;
    const title = e.currentTarget.dataset.title;
    this.setData({ showBatchMenu: false });

    // 二次确认 modal
    const batch = this.data.batches.find(b => b._id === id);
    const count = batch ? batch.assignment_count : 0;
    wx.showModal({
      title: '删除作业批次',
      content: `删除「${title}」？\n包含 ${count} 道题\n删除后学生将看不到本批次。\n（如需恢复请联系管理员）`,
      confirmText: '确认删除',
      confirmColor: '#ff4d4f',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) this.doDeleteBatch(id);
      }
    });
  },

  doDeleteBatch(batchId) {
    wx.showLoading({ title: '删除中...', mask: true });
    wx.cloud.callFunction({
      name: 'deleteAssignmentBatch',
      data: { batchId },
      success: (res) => {
        wx.hideLoading();
        if (res.result.success) {
          wx.showToast({ title: '已删除', icon: 'success' });
          // 从本地列表中移除该批次（不再触发网络请求）
          const newBatches = this.data.batches.filter(b => b._id !== batchId);
          this.setData({ batches: newBatches });
        } else {
          wx.showToast({ title: res.result.error || '删除失败', icon: 'none' });
        }
      },
      fail: (err) => {
        wx.hideLoading();
        console.error('删除批次失败:', err);
        wx.showToast({ title: '网络错误', icon: 'none' });
      }
    });
  },

  goToAssignmentDetail(e) {
    const assignmentId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/assignmentDetail/index?assignmentId=${assignmentId}&className=${this.data.classInfo.name}`
    });
  },

  publishAssignment() {
    wx.navigateTo({
      url: `/pages/publishAssignmentChat/index?classId=${this.data.classId}&className=${this.data.classInfo.name}`
    });
  }
});