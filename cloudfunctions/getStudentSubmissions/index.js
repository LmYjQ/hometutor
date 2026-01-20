// 云函数 getStudentSubmissions/index.js - 获取学生提交记录
const cloud = require('wx-server-sdk');
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { assignmentId, submissionId } = event;

  try {
    let query = { student_id: openid };

    // 如果指定了作业ID
    if (assignmentId) {
      query.assignment_id = assignmentId;
    }

    // 如果指定了提交ID
    if (submissionId) {
      query._id = submissionId;
    }

    // 获取提交记录
    const submissionsRes = await db.collection('submissions')
      .where(query)
      .orderBy('created_at', 'desc')
      .get();

    const submissions = submissionsRes.data;

    // 获取作业和班级信息
    const assignmentIds = [...new Set(submissions.map(s => s.assignment_id))];
    if (assignmentIds.length > 0) {
      const assignmentsRes = await db.collection('assignments')
        .where({ _id: _.in(assignmentIds) })
        .get();

      const assignmentsMap = {};
      assignmentsRes.data.forEach(a => {
        assignmentsMap[a._id] = {
          class_name: a.class_name,
          question_title: a.question_title,
          reference_text: a.reference_text
        };
      });

      // 补充信息
      submissions.forEach(s => {
        const assignment = assignmentsMap[s.assignment_id];
        if (assignment) {
          s.class_name = assignment.class_name;
          s.question_title = assignment.question_title;
          s.reference_text = assignment.reference_text;
        }
        s.created_atText = this.formatDate(s.created_at);
      });
    }

    return {
      success: true,
      data: submissions
    };
  } catch (error) {
    console.error('获取提交记录失败:', error);
    return { success: false, error: error.message || '获取提交记录失败' };
  }
};

exports.formatDate = function(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  return `${month}月${day}日 ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
};
