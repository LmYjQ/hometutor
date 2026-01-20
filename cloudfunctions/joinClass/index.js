// 云函数 joinClass/index.js - 学生加入班级
const cloud = require('wx-server-sdk');
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { inviteCode } = event;

  if (!inviteCode || inviteCode.trim() === '') {
    return { success: false, error: '请输入邀请码' };
  }

  const code = inviteCode.trim().toUpperCase();

  try {
    // 获取用户信息
    const user = await db.collection('users').doc(openid).get();
    if (!user.data) {
      return { success: false, error: '用户信息不存在，请先登录' };
    }

    if (user.data.role !== 'student') {
      return { success: false, error: '只有学生可以加入班级' };
    }

    // 查找班级
    const classRes = await db.collection('classes').where({
      invite_code: code
    }).get();

    if (classRes.data.length === 0) {
      return { success: false, error: '邀请码无效' };
    }

    const classData = classRes.data[0];

    // 检查是否已加入
    if (classData.student_ids && classData.student_ids.includes(openid)) {
      return { success: false, error: '您已加入该班级' };
    }

    // 更新班级学生列表
    const newStudentIds = [...(classData.student_ids || []), openid];
    await db.collection('classes').doc(classData._id).update({
      data: {
        student_ids: newStudentIds
      }
    });

    return {
      success: true,
      data: {
        _id: classData._id,
        name: classData.name,
        teacher_name: classData.teacher_name
      }
    };
  } catch (error) {
    console.error('加入班级失败:', error);
    return { success: false, error: error.message || '加入班级失败' };
  }
};
