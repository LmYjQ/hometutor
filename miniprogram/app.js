// app.js
App({
  onLaunch: function () {
    this.globalData = {
      // env 参数说明：
      //   env 参数决定接下来小程序发起的云开发调用（wx.cloud.xxx）会默认请求到哪个云环境的资源
      //   此处请填入环境 ID, 环境 ID 可打开云控制台查看
      //   如不填则使用默认环境（第一个创建的环境）
      env: "hometutor-dev-d2gz5nh53c67ecd73",
      userInfo: null,
      role: null,

      // ============ NAS 自建后端灰度开关 ============
      // 阶段 1：默认 false（所有请求走云函数老路径）
      // 切到新后端：把 useNasApi 改为 true
      // 出问题立即改回 false 回滚
      useNasApi: false,
      apiBase: 'https://api.hometutor.top',  // ⚠️ 改成你的 Tunnel 域名
    };
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      wx.cloud.init({
        env: this.globalData.env,
        traceUser: true,
      });
    }

    // 启动时尝试恢复登录态：从 wx.storage 同步到 globalData
    // 这样首页 / 我的页进入时 globalData.userInfo 直接可用，不需要等 onShow 再读
    const cached = wx.getStorageSync('userInfo');
    if (cached && (cached._openid || cached.openid) && cached.role) {
      this.globalData.userInfo = cached;
      this.globalData.role = cached.role;
    }
  },

  // 提供一个全局方法：刷新用户信息（用于切换身份等场景后立即生效）
  refreshUserInfo: function () {
    const cached = wx.getStorageSync('userInfo');
    if (cached) {
      this.globalData.userInfo = cached;
      this.globalData.role = cached.role || null;
    }
    return cached;
  }
});