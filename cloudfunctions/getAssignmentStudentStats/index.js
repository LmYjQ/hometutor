// 云函数 getAssignmentStudentStats - 获取作业下每个学生的提交统计
//
// 返回结构：
//   {
//     assignment: {...},
//     studentStats: [{ student_id, student_name, avatarUrl, submissionCount, bestScore, lastScore, lastSubmitTime, status }, ...],  // 已提交学生，按提交次数/最高分排
//     notSubmittedStudents: [{ student_id, student_name, avatarUrl }, ...],  // 未提交学生，按 name 排序
//     submittedCount: 已提交人数,
//     notSubmittedCount: 未提交人数,
//     totalStudentCount: 班级总人数
//   }
const cloud = require('wx-server-sdk');
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { assignmentId } = event;

  try {
    // 1. 获取作业信息（顺手校验所有权）
    const assignmentRes = await db.collection('assignments')
      .where({ _id: assignmentId, teacher_id: openid })
      .get();

    if (assignmentRes.data.length === 0) {
      return { success: false, error: '作业不存在或您不是该作业的老师' };
    }

    const assignment = assignmentRes.data[0];

    // 2. 获取该作业的所有提交
    const submissionsRes = await db.collection('submissions')
      .where({ assignment_id: assignmentId })
      .orderBy('created_at', 'desc')
      .get();

    const submissions = submissionsRes.data;

    // 3. 获取班级学生 openid 列表
    const classRes = await db.collection('classes')
      .where({ _id: assignment.class_id })
      .get();
    const allStudentIds = classRes.data[0]?.student_ids || [];

    // 4. 一次性查所有学生资料（避免循环查库）
    let usersMap = {};
    if (allStudentIds.length > 0) {
      const usersRes = await db.collection('users')
        .where({ _openid: _.in(allStudentIds) })
        .get();
      usersRes.data.forEach(u => {
        usersMap[u._openid] = { name: u.name, avatarUrl: u.avatarUrl };
      });
    }

    // 5. 按学生分组统计（已提交）
    const studentStats = {};
    submissions.forEach(s => {
      const studentId = s.student_id;
      if (!studentStats[studentId]) {
        // 优先用 submission 里存的 student_name 兜底（早期版本 students 集合里没有存）
        const userInfo = usersMap[studentId] || {};
        studentStats[studentId] = {
          student_id: studentId,
          student_name: userInfo.name || s.student_name || '未知学生',
          avatarUrl: userInfo.avatarUrl || '',
          submissionCount: 0,
          bestScore: 0,
          lastScore: 0,
          lastSubmitTime: null,
          status: 'graded'
        };
      }
      studentStats[studentId].submissionCount++;
      if (s.score !== undefined && s.score !== null) {
        if (s.score > studentStats[studentId].bestScore) {
          studentStats[studentId].bestScore = s.score;
        }
        studentStats[studentId].lastScore = s.score;
      }
      if (s.score === undefined || s.score === null) {
        studentStats[studentId].status = 'pending';
      } else if (s.score < studentStats[studentId].bestScore) {
        // 仅记录状态，不影响排序
      }
      if (!studentStats[studentId].lastSubmitTime || s.created_at > studentStats[studentId].lastSubmitTime) {
        studentStats[studentId].lastSubmitTime = s.created_at;
      }
    });

    // 已提交学生按「提交次数降 → 最高分降」排序
    const submittedList = Object.values(studentStats).sort((a, b) => {
      if (b.submissionCount !== a.submissionCount) {
        return b.submissionCount - a.submissionCount;
      }
      return b.bestScore - a.bestScore;
    });

    // 6. 未提交学生 = 班级学生 - 已提交学生，按姓名字典序
    const submittedIds = new Set(submittedList.map(s => s.student_id));
    const notSubmittedList = allStudentIds
      .filter(id => !submittedIds.has(id))
      .map(id => ({
        student_id: id,
        student_name: usersMap[id]?.name || '未知学生',
        avatarUrl: usersMap[id]?.avatarUrl || ''
      }))
      .sort((a, b) => a.student_name.localeCompare(b.student_name, 'zh-CN'));

    return {
      success: true,
      data: {
        assignment,
        studentStats: submittedList,
        notSubmittedStudents: notSubmittedList,
        submittedCount: submittedList.length,
        notSubmittedCount: notSubmittedList.length,
        totalStudentCount: allStudentIds.length
      }
    };
  } catch (error) {
    console.error('获取学生提交统计失败:', error);
    return { success: false, error: error.message || '获取学生提交统计失败' };
  }
};