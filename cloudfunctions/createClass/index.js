// 云函数 createClass/index.js - 老师创建班级
const cloud = require('wx-server-sdk');
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

// 生成6位随机邀请码
function generateInviteCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// 检查邀请码是否已存在
async function isInviteCodeExists(code) {
  try {
    const res = await db.collection('classes').where({
      invite_code: code
    }).count();
    return res.total > 0;
  } catch (e) {
    return false;
  }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { name } = event;

  if (!name || name.trim() === '') {
    return { success: false, error: '班级名称不能为空' };
  }

  try {
    // 获取用户信息
    const userRes = await db.collection('users').where({
      _openid: openid
    }).get();

    const user = userRes.data[0];
    if (!user) {
      return { success: false, error: '用户信息不存在，请先登录' };
    }

    // 检查用户是否为老师
    if (user.role !== 'teacher') {
      return { success: false, error: '只有老师可以创建班级' };
    }

    // 生成唯一邀请码
    let inviteCode = generateInviteCode();
    while (await isInviteCodeExists(inviteCode)) {
      inviteCode = generateInviteCode();
    }

    // 创建班级
    const classId = 'class_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    await db.collection('classes').doc(classId).set({
      data: {
        name: name.trim(),
        teacher_id: openid,
        teacher_name: user.name,
        invite_code: inviteCode,
        student_ids: [],
        created_at: db.serverDate()
      }
    });

    return {
      success: true,
      data: {
        _id: classId,
        name: name.trim(),
        invite_code: inviteCode,
        teacher_name: user.name,
        student_ids: []
      }
    };
  } catch (error) {
    console.error('创建班级失败:', error);
    return { success: false, error: error.message || '创建班级失败' };
  }
};
