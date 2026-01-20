// pages/joinClass/index.js
Page({
  data: {
    codeInputs: ['', '', '', '', '', ''],
    focusIndex: 0,
    focusOnHidden: false,
    joining: false
  },

  get canJoin() {
    return this.data.codeInputs.every(c => c !== '') && !this.data.joining;
  },

  onInput(e) {
    const index = e.currentTarget.dataset.index;
    const value = e.detail.value;

    // 只允许输入字母和数字，转大写
    const char = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(-1);

    const codeInputs = this.data.codeInputs;
    codeInputs[index] = char;

    this.setData({ codeInputs });

    // 自动跳转到下一个输入框
    if (char && index < 5) {
      this.setData({ focusIndex: index + 1 });
    }
  },

  onFocus(e) {
    const index = e.currentTarget.dataset.index;
    // 如果当前输入框有内容，保持焦点；否则找上一个有内容的
    if (!this.data.codeInputs[index]) {
      for (let i = index - 1; i >= 0; i--) {
        if (this.data.codeInputs[i]) {
          this.setData({ focusIndex: i });
          break;
        }
      }
    }
  },

  onHiddenInput() {
    // 隐藏input用于处理粘贴
  },

  joinClass() {
    const code = this.data.codeInputs.join('');

    if (code.length !== 6) {
      wx.showToast({ title: '请输入完整的邀请码', icon: 'none' });
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
  },

  onLoad() {
    // 监听粘贴事件
    wx.onClipboardCopy((res) => {
      const text = res.text.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6);
      if (text.length === 6) {
        const codeInputs = text.split('');
        this.setData({ codeInputs, focusIndex: 5 });
      }
    });
  }
});
