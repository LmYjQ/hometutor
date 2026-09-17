/**
 * 一次性 ETL：CloudBase NoSQL → Postgres
 *
 * 跑法:
 *   npm run migrate:cloudbase -- --dry-run  # 先看条数
 *   npm run migrate:cloudbase               # 真跑
 *
 * 注意：要在 backend/.env 里配 CLOUDBASE_ENV_ID
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import cloudbase from '@cloudbase/node-sdk'

const prisma = new PrismaClient()
const app = cloudbase.init({
  env: process.env.CLOUDBASE_ENV_ID || 'hometutor-dev-d2gz5nh53c67ecd73',
})
const db = app.database()

const dryRun = process.argv.includes('--dry-run')

async function readAll(name: string) {
  const PAGE = 100
  const all: any[] = []
  let offset = 0
  while (true) {
    const res = await db.collection(name).skip(offset).limit(PAGE).get()
    if (!res.data || res.data.length === 0) break
    all.push(...res.data)
    offset += PAGE
    if (res.data.length < PAGE) break
  }
  return all
}

async function dryRunReport() {
  console.log('=== Dry Run: CloudBase 各集合条数 ===')
  for (const name of [
    'users',
    'classes',
    'assignment_batches',
    'assignments',
    'submissions',
    'invite_codes',
  ]) {
    try {
      const all = await readAll(name)
      console.log(`  ${name.padEnd(20)} ${all.length} 条`)
    } catch (e) {
      console.log(`  ${name.padEnd(20)} 读取失败: ${(e as Error).message}`)
    }
  }
}

async function migrate() {
  console.log('=== 开始迁移 ===')

  // 1. User
  console.log('1. 用户 ...')
  const userMap = new Map<string, string>()
  const users = await readAll('users')
  for (const u of users) {
    const openid = u._openid
    if (!openid) {
      console.warn('  跳过无 openid 的 user:', u._id)
      continue
    }
    const user = await prisma.user.upsert({
      where: { openid },
      update: {},
      create: {
        openid,
        role: u.role === 'teacher' ? 'teacher' : 'student',
        name: u.name ?? '未命名',
        avatarUrl: u.avatarUrl,
      },
    })
    userMap.set(openid, user.id)
  }
  console.log(`  ✓ ${userMap.size} 个用户`)

  // 2. Class + ClassMember
  console.log('2. 班级 + 成员 ...')
  const classMap = new Map<string, string>()
  const classes = await readAll('classes')
  for (const c of classes) {
    const teacherId = userMap.get(c.teacher_id)
    if (!teacherId) {
      console.warn(`  跳过 class ${c._id}: 找不到 teacher ${c.teacher_id}`)
      continue
    }
    const cls = await prisma.class.upsert({
      where: { inviteCode: c.invite_code },
      update: {},
      create: {
        teacherId,
        teacherName: c.teacher_name ?? '',
        name: c.class_name || c.name || '未命名班级',
        inviteCode: c.invite_code,
      },
    })
    classMap.set(c._id, cls.id)

    for (const studentOpenid of c.student_ids ?? []) {
      const studentId = userMap.get(studentOpenid)
      if (!studentId) continue
      await prisma.classMember.upsert({
        where: { classId_studentId: { classId: cls.id, studentId } },
        update: {},
        create: { classId: cls.id, studentId },
      })
    }
  }
  console.log(`  ✓ ${classMap.size} 个班级`)

  // 3. Batch
  console.log('3. 作业批次 ...')
  const batchMap = new Map<string, string>()
  const batches = await readAll('assignment_batches')
  for (const b of batches) {
    const classId = classMap.get(b._id) || classMap.get(b.class_id)
    if (!classId) {
      console.warn(`  跳过 batch ${b._id}: 找不到 class`)
      continue
    }
    const batchRecord = await prisma.assignmentBatch.create({
      data: {
        classId,
        className: b.class_name ?? '',
        teacherId: userMap.get(b.teacher_id) ?? '',
        teacherName: b.teacher_name ?? '',
        title: b.title ?? '未命名批次',
        assignmentCount: b.assignment_count ?? 0,
        status: b.status === 'deleted' ? 'DELETED' : 'ACTIVE',
        deletedAt: b.deleted_at ? new Date(b.deleted_at) : null,
      },
    })
    batchMap.set(b._id, batchRecord.id)
  }
  console.log(`  ✓ ${batchMap.size} 个批次`)

  // 4. Assignment
  console.log('4. 作业 ...')
  const assignmentMap = new Map<string, string>()
  const assignments = await readAll('assignments')
  for (const a of assignments) {
    const classId = classMap.get(a._id) || classMap.get(a.class_id)
    if (!classId) {
      console.warn(`  跳过 assignment ${a._id}: 找不到 class`)
      continue
    }
    const teacherId = userMap.get(a.teacher_id) ?? ''
    const batchId = a.batch_id ? batchMap.get(a.batch_id) ?? null : null
    const as = await prisma.assignment.create({
      data: {
        batchId,
        classId,
        className: a.class_name ?? '',
        teacherId,
        questionTitle: a.question_title ?? '',
        referenceText: a.reference_text ?? '',
        deadline: a.deadline ? new Date(a.deadline) : null,
        status: a.status === 'deleted' ? 'DELETED' : 'ACTIVE',
      },
    })
    assignmentMap.set(a._id, as.id)
  }
  console.log(`  ✓ ${assignmentMap.size} 个作业`)

  // 5. Submission
  console.log('5. 提交 ...')
  const submissions = await readAll('submissions')
  let subCount = 0
  for (const s of submissions) {
    const assignmentId = assignmentMap.get(s._id) || assignmentMap.get(s.assignment_id)
    const studentId = userMap.get(s.student_id)
    if (!assignmentId || !studentId) {
      console.warn(`  跳过 submission ${s._id}`)
      continue
    }
    await prisma.submission.create({
      data: {
        assignmentId,
        studentId,
        studentName: s.student_name ?? '',
        avatarUrl: s.avatarUrl ?? s.avatar_url ?? null,
        videoFileId: s.video_file_id,
        audioText: s.audio_text,
        score: typeof s.score === 'number' ? s.score : null,
        comment: s.evaluation?.comment ?? null,
        missingPoints: s.evaluation?.missing_points ?? [],
        status:
          s.status === 'graded' ? 'GRADED' : s.status === 'failed' ? 'FAILED' : 'PENDING',
      },
    })
    subCount++
  }
  console.log(`  ✓ ${subCount} 个提交`)

  // 6. InviteCode
  console.log('6. 邀请码 ...')
  const inviteCodes = await readAll('invite_codes')
  for (const ic of inviteCodes) {
    await prisma.inviteCode.upsert({
      where: { code: ic.code },
      update: {
        isActive: !!ic.is_active,
        usedCount: ic.used_count ?? 0,
        maxUses: ic.max_uses ?? 1,
        expiresAt: ic.expires_at ? new Date(ic.expires_at) : null,
      },
      create: {
        code: ic.code,
        isActive: !!ic.is_active,
        usedCount: ic.used_count ?? 0,
        maxUses: ic.max_uses ?? 1,
        expiresAt: ic.expires_at ? new Date(ic.expires_at) : null,
      },
    })
  }
  console.log(`  ✓ ${inviteCodes.length} 个邀请码`)

  console.log('\n=== 迁移完成 ===')
}

async function main() {
  try {
    if (dryRun) {
      await dryRunReport()
    } else {
      await migrate()
    }
  } finally {
    await prisma.$disconnect()
  }
}

main()