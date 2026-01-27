// 云函数 getStudentTodoList/index.js - 学生获取待完成作业列表
const cloud = require('wx-server-sdk');
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

// 格式化日期
function formatDate(date) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  return `${month}月${day}日 ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  try {
    // 获取用户信息
    const userRes = await db.collection('users')
      .where({ _openid: openid })
      .get();

    if (userRes.data.length === 0) {
      return { success: false, error: '用户信息不存在', debug: { openid, step: 'check_user' } };
    }

    // 获取学生加入的所有班级
    const classesRes = await db.collection('classes')
      .where({ student_ids: openid })
      .get();

    const classes = classesRes.data;

    if (classes.length === 0) {
      return {
        success: true,
        data: {
          assignments: [],
          classes: []
        },
        debug: { openid, step: 'no_classes', message: '您还没有加入任何班级' }
      };
    }

    // 获取所有班级的ID
    const classIds = classes.map(c => c._id);

    // 获取所有未归档的作业
    const now = new Date();
    const assignmentsRes = await db.collection('assignments')
      .where({
        class_id: _.in(classIds),
        status: 'active'
      })
      .orderBy('deadline', 'asc')
      .get();

    const assignments = assignmentsRes.data;

    // 调试信息
    const debugInfo = {
      openid,
      classIds,
      classCount: classes.length,
      assignmentCount: assignments.length,
      message: assignments.length === 0
        ? `已加入${classes.length}个班级，但这些班级暂无作业`
        : null
    };

    // 获取学生已提交的作业
    const submissionsRes = await db.collection('submissions')
      .where({
        student_id: openid,
        assignment_id: _.in(assignments.map(a => a._id))
      })
      .get();

    const submittedIds = new Set(submissionsRes.data.map(s => s.assignment_id));

    // 格式化作业数据
    const formattedAssignments = assignments.map(assignment => {
      const deadline = new Date(assignment.deadline);
      const isOverdue = now > deadline;

      return {
        ...assignment,
        deadlineText: formatDate(deadline),
        isOverdue,
        submitted: submittedIds.has(assignment._id)
      };
    });

    return {
      success: true,
      data: {
        assignments: formattedAssignments,
        classes: classes.map(c => ({
          _id: c._id,
          name: c.name,
          teacher_name: c.teacher_name
        }))
      },
      debug: debugInfo
    };
  } catch (error) {
    console.error('获取作业列表失败:', error);
    return { success: false, error: error.message || '获取作业列表失败' };
  }
};
