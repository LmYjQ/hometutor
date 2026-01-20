// 云函数 login/index.js
const cloud = require('wx-server-sdk');
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { role, name, avatarUrl } = event;

  // 1. 确保 users 集合存在
  try {
    await db.createCollection('users');
    console.log('users 集合已创建');
  } catch (e) {
    // 集合已存在，忽略错误
    console.log('users 集合已存在');
  }

  try {
    // 查询用户是否已存在（使用_openid查询）
    const userRes = await db.collection('users')
      .where({ _openid: openid })
      .get();

    if (userRes.data.length > 0) {
      // 用户已存在，更新信息
      const userData = userRes.data[0];
      await db.collection('users').doc(userData._id).update({
        data: {
          name: name || userData.name,
          avatarUrl: avatarUrl || userData.avatarUrl,
          role: role || userData.role,
          updated_at: db.serverDate()
        }
      });

      return {
        success: true,
        data: {
          _id: openid,
          _openid: openid,
          name: name || userData.name,
          avatarUrl: avatarUrl || userData.avatarUrl,
          role: role || userData.role,
          isNew: false
        }
      };
    }
  } catch (error) {
    console.error('查询用户失败:', error);
  }

  // 创建新用户
  const addRes = await db.collection('users').add({
    data: {
      role: role || 'student',
      name: name || '未命名用户',
      avatarUrl: avatarUrl || '',
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  });

  return {
    success: true,
    data: {
      _id: addRes.id,  // 使用add返回的_id
      _openid: openid,
      role: role || 'student',
      name: name || '未命名用户',
      avatarUrl: avatarUrl || '',
      isNew: true
    }
  };
};
