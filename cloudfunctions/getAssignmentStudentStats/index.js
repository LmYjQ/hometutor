// 云函数 getAssignmentStudentStats - 获取作业下每个学生的提交统计
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
    // 获取作业信息
    const assignmentRes = await db.collection('assignments')
      .where({ _id: assignmentId, teacher_id: openid })
      .get();

    if (assignmentRes.data.length === 0) {
      return { success: false, error: '作业不存在或您不是该作业的老师' };
    }

    const assignment = assignmentRes.data[0];

    // 获取该作业的所有提交
    const submissionsRes = await db.collection('submissions')
      .where({ assignment_id: assignmentId })
      .orderBy('created_at', 'desc')
      .get();

    const submissions = submissionsRes.data;

    // 获取班级学生信息
    const classRes = await db.collection('classes')
      .where({ _id: assignment.class_id })
      .get();

    const students = classRes.data[0]?.student_ids || [];

    // 按学生分组统计
    const studentStats = {};
    submissions.forEach(s => {
      const studentId = s.student_id;
      if (!studentStats[studentId]) {
        studentStats[studentId] = {
          student_id: studentId,
          student_name: s.student_name || '未知学生',
          avatarUrl: s.avatarUrl || '',
          submissionCount: 0,
          bestScore: 0,
          lastScore: 0,
          lastSubmitTime: null,
          submissions: []
        };
      }
      studentStats[studentId].submissionCount++;
      studentStats[studentId].submissions.push({
        score: s.score || 0,
        created_at: s.created_at,
        status: s.status
      });
      // 更新最高分和最后提交分数
      if (s.score !== undefined && s.score !== null) {
        if (s.score > studentStats[studentId].bestScore) {
          studentStats[studentId].bestScore = s.score;
        }
        studentStats[studentId].lastScore = s.score;
      }
      if (!studentStats[studentId].lastSubmitTime || s.created_at > studentStats[studentId].lastSubmitTime) {
        studentStats[studentId].lastSubmitTime = s.created_at;
      }
    });

    // 转换为数组并排序（按提交次数倒序，然后按最高分倒序）
    const result = Object.values(studentStats).sort((a, b) => {
      if (b.submissionCount !== a.submissionCount) {
        return b.submissionCount - a.submissionCount;
      }
      return b.bestScore - a.bestScore;
    });

    // 获取已提交学生ID列表
    const submittedStudentIds = result.map(s => s.student_id);

    // 统计未提交学生
    const notSubmitted = students.filter(id => !submittedStudentIds.includes(id));

    return {
      success: true,
      data: {
        assignment,
        studentStats: result,
        submittedCount: result.length,
        notSubmittedCount: notSubmitted.length,
        totalStudentCount: students.length
      }
    };
  } catch (error) {
    console.error('获取学生提交统计失败:', error);
    return { success: false, error: error.message || '获取学生提交统计失败' };
  }
};
