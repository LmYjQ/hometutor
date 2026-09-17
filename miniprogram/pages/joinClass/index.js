// pages/joinClass/index.js
const { request } = require('../../utils/request');

Page({
  data: {
    code: '',
    joining: false
  },

  onInput(e) {
    // 只允许输入字母和数字，自动转大写
    let value = e.detail.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    this.setData({ code: value });
  },

  async joinClass() {
    const { code } = this.data;

    if (code.length !== 6) {
      wx.showToast({ title: '请输入完整的6位邀请码', icon: 'none' });
      return;
    }

    this.setData({ joining: true });

    try {
      const res = await request('/api/classes/join', {
        method: 'POST',
        data: { inviteCode: code },
      });
      if (res && res.success) {
        wx.showToast({
          title: '加入成功',
          icon: 'success',
        });
        setTimeout(() => {
          wx.navigateBack();
        }, 1500);
      } else {
        wx.showToast({
          title: (res && res.error) || '加入失败',
          icon: 'none',
        });
      }
    } catch (err) {
      console.error('加入班级失败:', err);
      wx.showToast({
        title: '网络错误，请重试',
        icon: 'none',
      });
    } finally {
      this.setData({ joining: false });
    }
  },
});