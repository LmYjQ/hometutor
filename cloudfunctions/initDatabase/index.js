// 云函数 initDatabase/index.js
// 一键初始化云数据库：创建所有集合 + seed 一条老师邀请码
// 部署后只需调用一次即可（默认幂等）

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

// 需要保证存在的集合（数据库里没有会自动建）
const COLLECTIONS = [
  'users',
  'invite_codes',
  'classes',
  'assignments',
  'submissions',
  'assignment_batches',   // 作业批次：每次老师上传 Excel 生成一个，含多道题
];

// seed 一条老师邀请码。如果 invite_codes 里已有任何 is_active=true 的记录，会跳过
const DEFAULT_INVITE_CODE = 'TEACH2026';

async function ensureCollection(name) {
  try {
    await db.createCollection(name);
    console.log(`[init] 已创建集合: ${name}`);
  } catch (e) {
    // errCode: -501001 表示集合已存在，忽略
    if (e && (e.errCode === -501001 || /already exists/i.test(String(e.errMsg)))) {
      console.log(`[init] 集合已存在: ${name}`);
    } else {
      console.warn(`[init] 创建集合 ${name} 异常:`, e.errMsg || e);
    }
  }
}

async function seedInviteCode() {
  const res = await db.collection('invite_codes')
    .where({ is_active: true })
    .limit(1)
    .get();

  if (res.data && res.data.length > 0) {
    return { skipped: true, existing: res.data[0] };
  }

  await db.collection('invite_codes').add({
    data: {
      code: DEFAULT_INVITE_CODE,
      is_active: true,
      used_count: 0,
      max_uses: 100,
      expires_at: new Date('2099-12-31T23:59:59.000Z'),
      created_at: db.serverDate(),
    },
  });

  return { skipped: false, code: DEFAULT_INVITE_CODE };
}

exports.main = async (event, context) => {
  const { force } = event || {};

  try {
    // 1. 创建所有集合（串行更稳，避免触发并发限流）
    for (const name of COLLECTIONS) {
      // eslint-disable-next-line no-await-in-loop
      await ensureCollection(name);
    }

    // 2. seed 邀请码（除非 force=true，否则只在空表时插入）
    let invite;
    if (force) {
      const code = DEFAULT_INVITE_CODE + '_' + Date.now().toString(36).slice(-4).toUpperCase();
      await db.collection('invite_codes').add({
        data: {
          code,
          is_active: true,
          used_count: 0,
          max_uses: 100,
          expires_at: new Date('2099-12-31T23:59:59.000Z'),
          created_at: db.serverDate(),
        },
      });
      invite = { skipped: false, forced: true, code };
    } else {
      invite = await seedInviteCode();
    }

    return {
      success: true,
      data: {
        collections: COLLECTIONS,
        invite,
        message: '数据库初始化完成',
      },
    };
  } catch (err) {
    console.error('[init] 初始化失败:', err);
    return { success: false, error: err.message || String(err) };
  }
};
