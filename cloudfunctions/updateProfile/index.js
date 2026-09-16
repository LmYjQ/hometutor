// 云函数 updateProfile/index.js - 用户改昵称 / 改头像 /（开发者专属）切换身份
//
// 设计要点：
//   1. 严格按 wxContext.OPENID 过滤（只能改自己），不信任前端传的 userId
//   2. 只接受白名单字段：name / avatarUrl 给所有用户；role 仅允许开发者专属 openid 切换
//   3. 切换规则：
//      - teacher → student：直接放行
//      - student → teacher：需要重新输入有效邀请码（复用 invite_codes 表的校验逻辑）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

// 普通用户可改的字段
const NORMAL_FIELDS = ['name', 'avatarUrl'];

// 开发者专属：允许切换 role 的 openid 白名单
const DEV_OPENIDS = [
  'oiVIk7edZTVoBqYBkMAIU6PixJDk'   // 主开发者
  // 后续如需加更多开发者测试账号，在这里追加
];

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!openid) {
    return { success: false, error: '无法识别当前用户' };
  }

  // 找一下用户当前的角色（role 切换前需要做合法性校验）
  const meRes = await db.collection('users')
    .where({ _openid: openid })
    .get();
  const me = meRes.data[0];
  if (!me) {
    return { success: false, error: '用户不存在，请先登录' };
  }

  const updateData = { updated_at: db.serverDate() };

  // 处理 name / avatarUrl（普通字段）
  for (const key of NORMAL_FIELDS) {
    const v = event[key];
    if (typeof v === 'string' && v.trim() !== '') {
      updateData[key] = v.trim();
    }
  }

  // 处理 role（仅开发者白名单）
  // 注意：必须 event.role 传了就处理，不依赖与 me.role 的对比——
  // 因为前端缓存可能 stale（role 已改但页面还显示老的），不强校验才能
  // 让前端点"切换"时一定有可写字段。
  if (event.role) {
    if (!DEV_OPENIDS.includes(openid)) {
      return { success: false, error: '没有切换身份的权限' };
    }
    if (!['teacher', 'student'].includes(event.role)) {
      return { success: false, error: '非法的角色值' };
    }

    // 只有当「实际要改」时才往下走，避免无意义的数据库写
    if (event.role !== me.role) {
      // student → teacher：必须重新输入有效邀请码
      if (me.role === 'student' && event.role === 'teacher') {
        const code = (event.inviteCode || '').trim().toUpperCase();
        if (!code) {
          return { success: false, error: '切换到老师需要输入邀请码' };
        }

        const inviteRes = await db.collection('invite_codes')
          .where({ code, is_active: true })
          .get();

        if (inviteRes.data.length === 0) {
          return { success: false, error: '邀请码无效' };
        }
        const invite = inviteRes.data[0];
        if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
          return { success: false, error: '邀请码已过期' };
        }
        if (invite.used_count >= invite.max_uses) {
          return { success: false, error: '邀请码已达使用上限' };
        }

        // 邀请码 use_count 自增
        await db.collection('invite_codes').doc(invite._id).update({
          data: { used_count: _.inc(1) }
        });
      }
      // teacher → student：直接放行，不用校验
      // student → student 或 teacher → teacher：上面 event.role !== me.role 已经挡住

      updateData.role = event.role;
    } else {
      // 已经是目标角色 →前端不该走到这（switchRole 里有拦截），但兜底返回成功
      return {
        success: true,
        data: {
          _openid: openid,
          name: me.name,
          avatarUrl: me.avatarUrl,
          role: me.role
        }
      };
    }
  }

  if (Object.keys(updateData).length === 1) {
    return { success: false, error: '没有可更新的字段' };
  }

  // 昵称长度限制
  if (updateData.name && updateData.name.length > 30) {
    return { success: false, error: '昵称不能超过 30 个字符' };
  }

  try {
    const res = await db.collection('users')
      .where({ _openid: openid })
      .update({ data: updateData });

    if (res.stats.updated === 0) {
      return { success: false, error: '用户不存在，请先登录' };
    }

    // 读回最新记录返回
    const userRes = await db.collection('users')
      .where({ _openid: openid })
      .get();

    const user = userRes.data[0];
    return {
      success: true,
      data: {
        _openid: openid,
        name: user.name,
        avatarUrl: user.avatarUrl,
        role: user.role
      }
    };
  } catch (error) {
    console.error('[updateProfile] 失败:', error);
    return { success: false, error: error.message || '更新失败' };
  }
};