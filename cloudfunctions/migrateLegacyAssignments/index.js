// 云函数 migrateLegacyAssignments/index.js - 一次性迁移脚本
//
// 把所有 batch_id 缺失的旧 assignment 按（class_id + 截止日期所在 ISO 周）分组，
// 每组建一个 assignment_batches 记录，并把 assignment.batch_id 写回去。
//
// 用法：
//   - 在云开发控制台 → 云函数 → migrateLegacyAssignments → 测试
//   - 入参 { dryRun: true }  只看不改；{ dryRun: false } 实际跑
//   - 跑一次即可，幂等（再次跑无残留数据）

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

// ISO 周编号（一年中的第几周）
function isoWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  // Thursday in current week determines the year
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function makeBatchId() {
  return `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

exports.main = async (event, context) => {
  const { dryRun = true } = event || {};

  try {
    // 1. 查所有无 batch_id 的 assignments
    //    NoSQL 的 where 不支持 `field == null` 简单判空；用 _.exists(false) 也不行
    //    （默认没写的字段查不到）。只能全表拉一遍再前端过滤。
    const allRes = await db.collection('assignments').limit(1000).get();
    const allAssignments = allRes.data;

    const legacy = allAssignments.filter(a => !a.batch_id);

    if (legacy.length === 0) {
      return { success: true, message: '没有需要迁移的旧作业', migrated: 0 };
    }

    // 2. 按 (class_id + ISO 周) 分组
    const groups = new Map();   // key -> { classInfo, weekKey, assignments: [...] }
    for (const a of legacy) {
      const weekKey = isoWeek(a.deadline || a.created_at);
      const key = `${a.class_id}__${weekKey}`;

      if (!groups.has(key)) {
        groups.set(key, {
          class_id: a.class_id,
          class_name: a.class_name,
          teacher_id: a.teacher_id,
          weekKey,
          assignments: []
        });
      }
      groups.get(key).assignments.push(a);
    }

    // 3. 查 teacher_name
    const teacherIds = [...new Set(legacy.map(a => a.teacher_id).filter(Boolean))];
    const teacherMap = {};
    if (teacherIds.length > 0) {
      const usersRes = await db.collection('users')
        .where({ _openid: _.in(teacherIds) })
        .get();
      usersRes.data.forEach(u => { teacherMap[u._openid] = u.name; });
    }

    if (dryRun) {
      // 只看不改
      const plan = Array.from(groups.values()).map(g => ({
        title: `${g.class_name || '未知班级'}（${g.weekKey}）`,
        class_id: g.class_id,
        assignment_count: g.assignments.length,
        assignment_ids: g.assignments.map(a => a._id)
      }));
      return {
        success: true,
        dryRun: true,
        message: `[DryRun] 将创建 ${plan.length} 个 batch，覆盖 ${legacy.length} 道旧作业`,
        plan
      };
    }

    // 4. 实际迁移
    const created = [];
    for (const g of groups.values()) {
      const batchId = makeBatchId();
      const title = `${g.class_name || '未知班级'}（${g.weekKey}）`;

      await db.collection('assignment_batches').add({
        data: {
          _id: batchId,
          class_id: g.class_id,
          class_name: g.class_name,
          teacher_id: g.teacher_id,
          teacher_name: teacherMap[g.teacher_id] || '',
          title,
          assignment_ids: g.assignments.map(a => a._id),
          assignment_count: g.assignments.length,
          status: 'active',
          created_at: g.assignments[0].created_at || new Date(),
          deleted_at: null,
          _isLegacyMigration: true   // 标记一下，方便后续辨别
        }
      });

      // 回写 assignments.batch_id
      for (const a of g.assignments) {
        // eslint-disable-next-line no-await-in-loop
        await db.collection('assignments').doc(a._id).update({
          data: { batch_id: batchId }
        });
      }

      created.push({ batchId, title, count: g.assignments.length });
    }

    return {
      success: true,
      dryRun: false,
      message: `迁移完成：创建 ${created.length} 个 batch`,
      migrated: created.length,
      created
    };
  } catch (err) {
    console.error('[migrateLegacyAssignments] 失败:', err);
    return { success: false, error: err.message || String(err) };
  }
};