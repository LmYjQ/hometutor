// 云函数 getStudentTodoList/index.js - 学生获取待完成作业列表（按批次分组）
//
// 返回结构：
//   {
//     assignments: [...],          // 扁平（向后兼容）
//     batches: [{                 // 按批次分组（前端 UI 用这个）
//       _id, title, created_at, created_atText,
//       assignments: [{ ..., submitted: bool, deadlineText, isOverdue }]
//     }],
//     classes: [...]
//   }
//
// 兼容旧数据：assignment 无 batch_id 时合成 legacy batch。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

function formatDate(date) {
  // 云函数跑在 UTC，db.serverDate() 也返回 UTC ISO；getMonth/getHours 取的是 UTC → 早 8h
  // 手动 +8h 转北京时间，再用 UTC 方法取分量
  const beijingMs = date.getTime() + 8 * 60 * 60 * 1000;
  const beijing = new Date(beijingMs);
  const month = beijing.getUTCMonth() + 1;
  const day = beijing.getUTCDate();
  const hours = beijing.getUTCHours();
  const minutes = beijing.getUTCMinutes();
  return `${month}月${day}日 ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  try {
    const userRes = await db.collection('users')
      .where({ _openid: openid })
      .get();
    if (userRes.data.length === 0) {
      return { success: false, error: '用户信息不存在', debug: { openid, step: 'check_user' } };
    }

    // 加入的所有班级
    const classesRes = await db.collection('classes')
      .where({ student_ids: openid })
      .get();
    const classes = classesRes.data;
    if (classes.length === 0) {
      return {
        success: true,
        data: {
          assignments: [],
          batches: [],
          classes: []
        },
        debug: { openid, step: 'no_classes', message: '您还没有加入任何班级' }
      };
    }

    const classIds = classes.map(c => c._id);

    // ===== 1. 查 active assignments =====
    const now = new Date();
    const assignmentsRes = await db.collection('assignments')
      .where({
        class_id: _.in(classIds),
        status: _.neq('deleted')
      })
      .orderBy('deadline', 'asc')
      .get();
    const assignments = assignmentsRes.data;

    if (assignments.length === 0) {
      return {
        success: true,
        data: {
          assignments: [],
          batches: [],
          classes: classes.map(c => ({ _id: c._id, name: c.name, teacher_name: c.teacher_name }))
        },
        debug: { openid, classCount: classes.length, assignmentCount: 0 }
      };
    }

    // ===== 2. 查 active batches =====
    const batchesRes = await db.collection('assignment_batches')
      .where({
        class_id: _.in(classIds),
        status: _.neq('deleted')
      })
      .orderBy('created_at', 'desc')
      .get();
    const batchMap = {};
    batchesRes.data.forEach(b => { batchMap[b._id] = b; });

    // ===== 3. 查学生已提交 =====
    const submissionsRes = await db.collection('submissions')
      .where({
        student_id: openid,
        assignment_id: _.in(assignments.map(a => a._id))
      })
      .get();
    const submittedIds = new Set(submissionsRes.data.map(s => s.assignment_id));

    // ===== 4. 组装 assignment + 标记 submitted =====
    const formattedAssignments = assignments.map(a => {
      const deadline = new Date(a.deadline);
      return {
        ...a,
        deadlineText: formatDate(deadline),
        isOverdue: now > deadline,
        submitted: submittedIds.has(a._id)
      };
    });

    // ===== 5. 按 batch 分组 =====
    const batchAccumulator = new Map();

    formattedAssignments.forEach(a => {
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
        } else if (batchMap[batchId]) {
          const b = batchMap[batchId];
          batchAccumulator.set(batchId, {
            _id: b._id,
            title: b.title,
            created_at: b.created_at,
            class_id: b.class_id,
            class_name: b.class_name,
            teacher_name: b.teacher_name,
            isLegacy: false,
            assignments: []
          });
        } else {
          // batch 文档丢失（罕见）
          batchAccumulator.set(batchId, {
            _id: batchId,
            title: '(作业)',
            created_at: a.created_at,
            isLegacy: true,
            isOrphan: true,
            assignments: []
          });
        }
      }
      batchAccumulator.get(batchId).assignments.push(a);
    });

    const batches = Array.from(batchAccumulator.values())
      .sort((x, y) => new Date(y.created_at) - new Date(x.created_at))
      .map(b => ({
        ...b,
        created_atText: formatDate(new Date(b.created_at)),
        assignment_count: b.assignments.length
      }));

    return {
      success: true,
      data: {
        assignments: formattedAssignments,    // 向后兼容
        batches,                             // 新结构（前端 UI 用）
        classes: classes.map(c => ({ _id: c._id, name: c.name, teacher_name: c.teacher_name }))
      },
      debug: {
        openid,
        classCount: classes.length,
        assignmentCount: assignments.length,
        batchCount: batches.length
      }
    };
  } catch (error) {
    console.error('获取作业列表失败:', error);
    return { success: false, error: error.message || '获取作业列表失败' };
  }
};