// pages/joinClass/index.js
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

  joinClass() {
    const { code } = this.data;

    if (code.length !== 6) {
      wx.showToast({ title: '请输入完整的6位邀请码', icon: 'none' });
      return;
    }

    this.setData({ joining: true });

    wx.cloud.callFunction({
      name: 'joinClass',
      data: { inviteCode: code },
      success: (res) => {
        if (res.result.success) {
          wx.showToast({
            title: '加入成功',
            icon: 'success'
          });
          setTimeout(() => {
            wx.navigateBack();
          }, 1500);
        } else {
          wx.showToast({
            title: res.result.error || '加入失败',
            icon: 'none'
          });
        }
      },
      fail: (err) => {
        console.error('加入班级失败:', err);
        wx.showToast({
          title: '网络错误，请重试',
          icon: 'none'
        });
      },
      complete: () => {
        this.setData({ joining: false });
      }
    });
  }
});
