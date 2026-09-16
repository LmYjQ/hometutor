// 云函数 deleteAssignmentBatch/index.js - 软删除作业批次
//
// 入参：{ batchId }
//   - 验证 batch 属于当前老师（teacher_id === openid）
//   - 软删除：assignment_batches.status='deleted' + assignments.status='deleted'
//   - 不动 submissions（保留历史成绩）
//
// 数据库后台恢复：在控制台数据库面板，把 status 改回 'active' 即可。
// 小程序内不暴露恢复入口。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { batchId } = event;

  if (!batchId) {
    return { success: false, error: '缺少 batchId' };
  }

  try {
    // 1. 校验 batch 归属 + 当前状态
    const batchRes = await db.collection('assignment_batches')
      .where({ _id: batchId, teacher_id: openid })
      .get();

    if (batchRes.data.length === 0) {
      return { success: false, error: '作业批次不存在或您不是该批次的老师' };
    }

    const batch = batchRes.data[0];

    // 防止重复删除（幂等保护）
    if (batch.status === 'deleted') {
      return {
        success: true,
        data: {
          batchId,
          alreadyDeleted: true,
          affectedAssignments: batch.assignment_count || 0
        },
        message: '该批次已被删除'
      };
    }

    // 2. 软删除所有关联的 assignments
    //    这里用 batch_id 直接 _.update，需要 doc() 命令？
    //    微信云开发支持 collection.where().update()，但需要 _.set 模式或 _.update
    //    简单做法：用 where batch_id=xxx 批量 update status='deleted'
    const updateAssignmentsRes = await db.collection('assignments')
      .where({ batch_id: batchId })
      .update({
        data: {
          status: 'deleted',
          deleted_at: new Date()
        }
      });

    const affectedAssignments = updateAssignmentsRes.stats ? updateAssignmentsRes.stats.updated : 0;

    // 3. 软删除 batch 记录
    await db.collection('assignment_batches').doc(batchId).update({
      data: {
        status: 'deleted',
        deleted_at: new Date()
      }
    });

    return {
      success: true,
      data: {
        batchId,
        alreadyDeleted: false,
        affectedAssignments
      },
      message: `已删除批次「${batch.title}」及其 ${affectedAssignments} 道题`
    };
  } catch (err) {
    console.error('[deleteAssignmentBatch] 失败:', err);
    return { success: false, error: err.message || '删除失败' };
  }
};