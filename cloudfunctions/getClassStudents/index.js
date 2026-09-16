// 云函数 getClassStudents/index.js
// 根据 openid 列表，批量查 users 集合里的 name / avatarUrl。
// 给老师端的 classDetail / 作业详情等用。
//
// 入参：{ studentIds: [openid, openid, ...] }
// 返回：{ success, data: [{ student_id, name, avatarUrl }, ...] }
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { studentIds } = event;

  if (!Array.isArray(studentIds) || studentIds.length === 0) {
    return { success: true, data: [] };
  }

  // 安全校验：只允许老师角色拉（避免学生 A 枚举全班 openid）
  const meRes = await db.collection('users')
    .where({ _openid: openid })
    .get();
  if (!meRes.data[0] || meRes.data[0].role !== 'teacher') {
    return { success: false, error: '只有老师可以查询学生资料' };
  }

  // 注意：云数据库 where(_.in([...])) 单次最多 1000 个，普通班级够用
  const res = await db.collection('users')
    .where({ _openid: _.in(studentIds) })
    .get();

  const data = res.data.map(u => ({
    student_id: u._openid,
    name: u.name || '未知学生',
    avatarUrl: u.avatarUrl || ''
  }));

  return { success: true, data };
};