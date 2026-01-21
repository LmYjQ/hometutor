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
  const { role, name, avatarUrl, inviteCode } = event;

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
      // 用户已存在
      const userData = userRes.data[0];
      let updateData = {
        name: name || userData.name,
        avatarUrl: avatarUrl || userData.avatarUrl,
        updated_at: db.serverDate()
      };

      // 如果用户已有角色，且选择了新角色，添加到roles数组
      if (role) {
        const existingRoles = userData.roles || [];
        if (!existingRoles.includes(role)) {
          updateData.roles = _.push([role]);
        }
        // 设置当前角色（如果之前没有或选择了不同角色）
        if (!userData.currentRole || userData.currentRole !== role) {
          updateData.currentRole = role;
        }
      }

      // 只有当有需要更新的字段时才执行更新
      if (Object.keys(updateData).length > 0) {
        await db.collection('users').doc(userData._id).update({
          data: updateData
        });
      }

      // 返回当前使用的角色
      const currentRole = role || userData.currentRole || 'student';

      return {
        success: true,
        data: {
          _openid: openid,
          name: name || userData.name,
          avatarUrl: avatarUrl || userData.avatarUrl,
          roles: userData.roles || [userData.role].filter(Boolean),
          currentRole: currentRole,
          isNew: false
        }
      };
    }
  } catch (error) {
    console.error('查询用户失败:', error);
  }

  // 如果是老师注册，验证邀请码
  if (role === 'teacher') {
    if (!inviteCode) {
      return { success: false, error: '请输入邀请码' };
    }

    const inviteRes = await db.collection('invite_codes').where({
      code: inviteCode,
      is_active: true
    }).get();

    if (inviteRes.data.length === 0) {
      return { success: false, error: '邀请码无效' };
    }

    const invite = inviteRes.data[0];

    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return { success: false, error: '邀请码已过期' };
    }

    if (invite.used_count >= invite.max_uses) {
      return { success: false, error: '邀请码已失效' };
    }

    // 老师注册成功，更新邀请码使用次数
    await db.collection('invite_codes').doc(invite._id).update({
      data: {
        used_count: invite.used_count + 1
      }
    });
  }

  // 创建新用户
  const addRes = await db.collection('users').add({
    data: {
      roles: [role || 'student'],
      currentRole: role || 'student',
      name: name || '未命名用户',
      avatarUrl: avatarUrl || '',
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  });

  return {
    success: true,
    data: {
      _openid: openid,
      roles: [role || 'student'],
      currentRole: role || 'student',
      name: name || '未命名用户',
      avatarUrl: avatarUrl || '',
      isNew: true
    }
  };
};
