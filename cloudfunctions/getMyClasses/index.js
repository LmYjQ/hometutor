// 云函数 getMyClasses/index.js - 获取我的班级列表
const cloud = require('wx-server-sdk');
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  try {
    // 获取用户信息
    const userRes = await db.collection('users').where({
      _openid: openid
    }).get();

    const user = userRes.data[0];
    if (!user) {
      return { success: false, error: '用户信息不存在' };
    }

    let classes = [];

    if (user.role === 'teacher') {
      // 老师：查询自己创建的班级
      const res = await db.collection('classes')
        .where({ teacher_id: openid })
        .orderBy('created_at', 'desc')
        .get();

      classes = res.data;
    } else {
      // 学生：查询自己加入的班级
      const res = await db.collection('classes')
        .where({ student_ids: openid })
        .orderBy('created_at', 'desc')
        .get();

      classes = res.data;
    }

    return {
      success: true,
      data: classes
    };
  } catch (error) {
    console.error('获取班级列表失败:', error);
    return { success: false, error: error.message || '获取班级列表失败' };
  }
};
