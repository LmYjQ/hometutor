// 云函数 getAssignmentSubmissions/index.js - 老师获取作业提交情况
const cloud = require('wx-server-sdk');
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { classId } = event;

  try {
    // 获取该老师创建的所有作业
    let query = { teacher_id: openid };
    if (classId) {
      query.class_id = classId;
    }

    const assignmentsRes = await db.collection('assignments')
      .where(query)
      .orderBy('created_at', 'desc')
      .get();

    const assignments = assignmentsRes.data;

    if (assignments.length === 0) {
      return { success: true, data: [] };
    }

    // 获取每个作业的提交数量（按学生去重，统计提交了作业的不同学生人数）
    const assignmentIds = assignments.map(a => a._id);
    const submissionsRes = await db.collection('submissions')
      .where({ assignment_id: _.in(assignmentIds) })
      .get();

    // 统计每个作业的已提交学生人数（按 student_id 去重）
    const submissionCount = {};
    const submittedStudents = {}; // { assignmentId: Set<student_id> }
    submissionsRes.data.forEach(s => {
      if (!submittedStudents[s.assignment_id]) {
        submittedStudents[s.assignment_id] = new Set();
      }
      submittedStudents[s.assignment_id].add(s.student_id);
    });
    // 转换为数量
    Object.keys(submittedStudents).forEach(assignmentId => {
      submissionCount[assignmentId] = submittedStudents[assignmentId].size;
    });

    // 获取班级学生数量
    const classIds = [...new Set(assignments.map(a => a.class_id))];
    const classesRes = await db.collection('classes')
      .where({ _id: _.in(classIds) })
      .get();

    const classStudentCount = {};
    classesRes.data.forEach(c => {
      classStudentCount[c._id] = c.student_ids?.length || 0;
    });

    // 格式化结果
    const now = new Date();
    const formatDate = (date) => {
      const month = date.getMonth() + 1;
      const day = date.getDate();
      const hours = date.getHours();
      const minutes = date.getMinutes();
      return `${month}月${day}日 ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    };
    const result = assignments.map(a => {
      const deadline = new Date(a.deadline);
      return {
        ...a,
        deadlineText: formatDate(deadline),
        isOverdue: now > deadline,
        submissionCount: submissionCount[a._id] || 0,
        studentCount: classStudentCount[a.class_id] || 0
      };
    });

    return { success: true, data: result };
  } catch (error) {
    console.error('获取作业提交情况失败:', error);
    return { success: false, error: error.message || '获取作业提交情况失败' };
  }
};
