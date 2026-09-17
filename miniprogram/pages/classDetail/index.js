// pages/classDetail/index.js
//
// 作业批次化（v2）：
//   - 列表渲染从扁平 assignments[] 改为 batches[].assignments[]
//   - 默认只展开最新批次，历史批次折叠
//   - 「⋯」菜单 → 软删除批次
//   - legacy 批次不显示删除入口（避免误删旧作业）

const { request } = require('../../utils/request');

Page({
  data: {
    classId: '',
    classInfo: { name: '', inviteCode: '', members: [] },
    students: [],
    batches: [],                      // [{ id, title, assignments: [...] }]
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

  async loadClassDetail() {
    wx.showLoading({ title: '加载中...' });

    try {
      // 1. 班级基本信息（含 members 列表）
      const clsRes = await request('/api/classes', { method: 'GET' });
      if (clsRes && clsRes.success && clsRes.data) {
        const allTeaching = clsRes.data.teaching || [];
        const classInfo = allTeaching.find(c => c.id === this.data.classId);
        if (classInfo) {
          // members[] → students[]（兼容老字段）
          const members = classInfo.members || [];
          const students = members.map((m) => ({
            id: m.student?.id,
            _openid: m.student?.openid,
            name: m.student?.name,
            avatarUrl: m.student?.avatarUrl,
            joinedAt: m.joinedAt,
          }));
          this.setData({
            classInfo: {
              ...classInfo,
              name: classInfo.name,
              inviteCode: classInfo.inviteCode,
            },
            students,
          });
        }
      }
    } catch (e) {
      console.error('加载班级失败', e);
    }

    // 2. 批次化作业列表
    this.loadAssignmentBatches();
  },

  async loadAssignmentBatches() {
    try {
      const res = await request('/api/teacher/assignments', {
        method: 'GET',
        data: { classId: this.data.classId },
      });
      if (!res || !res.success) return;
      const batches = (res.data.batches || []).map((b) => ({
        ...b,
        // 兼容老字段 _id → id
        id: b.id || b._id,
        assignments: (b.assignments || []).map((a) => ({
          ...a,
          id: a.id || a._id,
          statusText: (a.status === 'DELETED' || a.status === 'deleted')
            ? '已结束'
            : '进行中',
        })),
      }));

      // 默认只展开最新批次
      const expandedBatchIdsMap = {};
      if (batches.length > 0) {
        expandedBatchIdsMap[batches[0].id] = true;
      }

      this.setData({ batches, expandedBatchIdsMap });
    } catch (err) {
      console.error('加载作业列表失败:', err);
    } finally {
      wx.hideLoading();
    }
  },

  copyInviteCode() {
    wx.setClipboardData({
      data: this.data.classInfo.inviteCode,
      success: () => wx.showToast({ title: '已复制邀请码', icon: 'success' }),
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
      menuBatchTitle: title,
    });
  },

  onBatchMenuChange() {
    // action-sheet 自身关闭时触发
    this.setData({ showBatchMenu: false });
  },

  // 确认删除批次
  onConfirmDeleteBatch(e) {
    const id = e.currentTarget.dataset.id;
    const title = e.currentTarget.dataset.title;
    this.setData({ showBatchMenu: false });

    // 二次确认 modal
    const batch = this.data.batches.find(b => b.id === id);
    const count = batch ? (batch.assignmentCount || batch.assignments?.length || 0) : 0;
    wx.showModal({
      title: '删除作业批次',
      content: `删除「${title}」？\n包含 ${count} 道题\n删除后学生将看不到本批次。\n（如需恢复请联系管理员）`,
      confirmText: '确认删除',
      confirmColor: '#ff4d4f',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) this.doDeleteBatch(id);
      },
    });
  },

  async doDeleteBatch(batchId) {
    wx.showLoading({ title: '删除中...', mask: true });
    try {
      const res = await request('/api/batches/delete', {
        method: 'POST',
        data: { batchId },
      });
      wx.hideLoading();
      if (res && res.success) {
        wx.showToast({ title: '已删除', icon: 'success' });
        // 从本地列表中移除该批次（不再触发网络请求）
        const newBatches = this.data.batches.filter(b => b.id !== batchId);
        this.setData({ batches: newBatches });
      } else {
        wx.showToast({ title: (res && res.error) || '删除失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      console.error('删除批次失败:', err);
      wx.showToast({ title: '网络错误', icon: 'none' });
    }
  },

  goToAssignmentDetail(e) {
    const assignmentId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/assignmentDetail/index?assignmentId=${assignmentId}&className=${this.data.classInfo.name}`,
    });
  },

  publishAssignment() {
    wx.navigateTo({
      url: `/pages/publishAssignmentChat/index?classId=${this.data.classId}&className=${this.data.classInfo.name}`,
    });
  },
});