// pages/login/index.js
const app = getApp();

Page({
  data: {
    loading: false
  },

  // 老师登录
  loginAsTeacher() {
    this.doLogin('teacher');
  },

  // 学生登录
  loginAsStudent() {
    this.doLogin('student');
  },

  // 执行登录
  async doLogin(role) {
    if (this.data.loading) return;

    this.setData({ loading: true });

    try {
      // 获取用户信息
      const userProfile = await this.getUserProfile();

      if (!userProfile) {
        this.setData({ loading: false });
        return;
      }

      // 调用登录云函数
      const res = await wx.cloud.callFunction({
        name: 'login',
        data: {
          role: role,
          name: userProfile.nickName,
          avatarUrl: userProfile.avatarUrl
        }
      });

      if (res.result.success) {
        const user = res.result.data;

        // 保存用户信息到全局
        app.globalData.userInfo = user;
        app.globalData.role = user.role;

        // 存储到本地
        wx.setStorageSync('userInfo', user);

        wx.showToast({
          title: user.isNew ? '注册成功' : '登录成功',
          icon: 'success'
        });

        // 延迟跳转
        setTimeout(() => {
          this.navigateToHome(user.role);
        }, 1500);
      } else {
        wx.showToast({
          title: res.result.error || '登录失败',
          icon: 'none'
        });
      }
    } catch (err) {
      console.error('登录失败:', err);
      wx.showToast({
        title: '登录失败，请重试',
        icon: 'none'
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 获取用户头像和昵称
  getUserProfile() {
    return new Promise((resolve) => {
      // 优先使用新接口
      if (wx.getUserProfile) {
        wx.getUserProfile({
          desc: '用于完善用户资料',
          success: (res) => {
            resolve(res.userInfo);
          },
          fail: (err) => {
            console.log('getUserProfile失败:', err);
            // 如果新接口失败，使用旧接口
            this.getUserInfoLegacy().then(resolve).catch(() => resolve(null));
          }
        });
      } else {
        this.getUserInfoLegacy().then(resolve).catch(() => resolve(null));
      }
    });
  },

  // 兼容旧版本的获取用户信息方式
  getUserInfoLegacy() {
    return new Promise((resolve) => {
      // 由于隐私策略，现在需要用户主动授权
      // 这里提供一个简化的方案
      resolve({
        nickName: '用户' + Math.random().toString(36).substr(2, 5),
        avatarUrl: ''
      });
    });
  },

  // 根据角色跳转到对应首页
  navigateToHome(role) {
    if (role === 'teacher') {
      wx.redirectTo({
        url: '/pages/teacherHome/index'
      });
    } else {
      wx.redirectTo({
        url: '/pages/studentHome/index'
      });
    }
  },

  onLoad() {
    // 检查是否已登录
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo && userInfo._id) {
      app.globalData.userInfo = userInfo;
      app.globalData.role = userInfo.role;
      this.navigateToHome(userInfo.role);
    }
  }
});
