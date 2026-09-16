// 云函数 getAssignmentSubmissions/index.js - 老师获取作业提交情况（按批次分组）
//
// 入参：
//   { classId?: string }
//   { includeSubmissions?: boolean }    —— 是否把每个作业的完整 submissions[] 也带上
//   { includeDeleted?: boolean }        —— 是否包含软删除的批次（默认 false；后台恢复场景用）
//
// 行为变更（v2）：
//   - 返回结构从 [assignment, ...] 改成 [{_id, title, created_at, assignments: [...]}, ...]
//   - 旧数据兼容：assignment 无 batch_id 时合成一个 legacy batch（isLegacy: true）
//   - 默认按 batch.created_at desc 排序（新发布的靠上）
//   - 默认过滤 status='deleted'（除非 includeDeleted=true）
const cloud = require('wx-server-sdk');
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { classId, includeSubmissions, includeDeleted } = event;

  try {
    // ===== 1. 老师的所有 assignment =====
    const assignmentQuery = { teacher_id: openid };
    if (classId) assignmentQuery.class_id = classId;
    if (!includeDeleted) {
      assignmentQuery.status = _.neq('deleted');
    }

    const assignmentsRes = await db.collection('assignments')
      .where(assignmentQuery)
      .orderBy('created_at', 'desc')
      .get();

    const assignments = assignmentsRes.data;
    if (assignments.length === 0) {
      return { success: true, data: [] };
    }

    // ===== 2. 一次查全部相关 submissions =====
    const assignmentIds = assignments.map(a => a._id);
    const submissionsRes = await db.collection('submissions')
      .where({ assignment_id: _.in(assignmentIds) })
      .get();
    const allSubmissions = submissionsRes.data;

    const submissionsByAssignment = {};
    allSubmissions.forEach(s => {
      if (!submissionsByAssignment[s.assignment_id]) {
        submissionsByAssignment[s.assignment_id] = [];
      }
      submissionsByAssignment[s.assignment_id].push(s);
    });

    // ===== 3. 班级学生数量 =====
    const classIds = [...new Set(assignments.map(a => a.class_id))];
    const classesRes = await db.collection('classes')
      .where({ _id: _.in(classIds) })
      .get();
    const classStudentCount = {};
    classesRes.data.forEach(c => {
      classStudentCount[c._id] = c.student_ids?.length || 0;
    });

    // ===== 4. 一次性查所有 batch（含 includeDeleted）=====
    //    用 teacher_id 限定，避免泄露其他老师的批次
    const batchQuery = { teacher_id: openid };
    if (classId) batchQuery.class_id = classId;
    if (!includeDeleted) {
      batchQuery.status = _.neq('deleted');
    }
    const batchesRes = await db.collection('assignment_batches')
      .where(batchQuery)
      .orderBy('created_at', 'desc')
      .get();
    const batchMap = {};
    batchesRes.data.forEach(b => { batchMap[b._id] = b; });

    // ===== 5. 工具：格式化日期 + 组装 assignment =====
    const now = new Date();
    // 云函数运行环境是 UTC，db.serverDate() 返回的也是 UTC ISO 字符串，
    // getMonth/getHours 取的是 UTC 时间，会比北京时间早 8 小时 → 手动 +8h 再用 UTC 方法取分量
    const formatDate = (date) => {
      const d = new Date(date);
      const beijingMs = d.getTime() + 8 * 60 * 60 * 1000;
      const beijing = new Date(beijingMs);
      const month = beijing.getUTCMonth() + 1;
      const day = beijing.getUTCDate();
      const hours = beijing.getUTCHours();
      const minutes = beijing.getUTCMinutes();
      return `${month}月${day}日 ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    };

    const buildAssignment = (a) => {
      const subs = submissionsByAssignment[a._id] || [];
      const uniqueStudents = new Set(subs.map(s => s.student_id));

      const out = {
        ...a,
        deadlineText: formatDate(a.deadline),
        isOverdue: now > new Date(a.deadline),
        submissionCount: uniqueStudents.size,
        studentCount: classStudentCount[a.class_id] || 0
      };

      if (includeSubmissions) {
        out.submissions = subs
          .slice()
          .sort((x, y) => new Date(y.created_at) - new Date(x.created_at));
      }

      return out;
    };

    // ===== 6. 按 batch 分组 + 兼容 legacy =====
    const batchAccumulator = new Map();  // key = batchId 或 '__legacy__'

    assignments.forEach(a => {
      const batchId = a.batch_id || '__legacy__';
      if (!batchAccumulator.has(batchId)) {
        if (batchId === '__legacy__') {
          batchAccumulator.set(batchId, {
            _id: '__legacy__',
            title: a.class_name ? `${a.class_name}（旧作业）` : '旧作业',
            created_at: a.created_at,
            isLegacy: true,
            assignments: []
          });
        } else {
          const b = batchMap[batchId];
          if (b) {
            batchAccumulator.set(batchId, {
              _id: b._id,
              title: b.title,
              created_at: b.created_at,
              teacher_id: b.teacher_id,
              teacher_name: b.teacher_name,
              class_id: b.class_id,
              class_name: b.class_name,
              isLegacy: false,
              assignments: []
            });
          } else {
            // batch 文档被删了但 assignment 还在：兜底，按 assignment 自身建虚拟 batch
            batchAccumulator.set(batchId, {
              _id: batchId,
              title: '(批次已删除)',
              created_at: a.created_at,
              isLegacy: true,
              isOrphan: true,
              assignments: []
            });
          }
        }
      }
      batchAccumulator.get(batchId).assignments.push(buildAssignment(a));
    });

    // ===== 7. 按 batch.created_at desc 排序 =====
    const result = Array.from(batchAccumulator.values())
      .sort((x, y) => new Date(y.created_at) - new Date(x.created_at))
      .map(b => ({
        ...b,
        created_atText: formatDate(b.created_at),
        assignment_count: b.assignments.length
      }));

    return { success: true, data: result };
  } catch (error) {
    console.error('获取作业提交情况失败:', error);
    return { success: false, error: error.message || '获取作业提交情况失败' };
  }
};