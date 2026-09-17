/**
 * Seed 邀请码 + 必要默认数据
 * 跑法: npx prisma db seed  或  npm run seed
 */
import { PrismaClient } from '@prisma/client'
import 'dotenv/config'

const prisma = new PrismaClient()

async function main() {
  const seedCode = process.env.INVITE_SEED_CODE || 'TEACH2026'

  const result = await prisma.inviteCode.upsert({
    where: { code: seedCode },
    update: {},
    create: {
      code: seedCode,
      isActive: true,
      maxUses: 1000,
      expiresAt: new Date('2027-12-31'),
    },
  })

  console.log('✓ Seeded invite code:', result.code)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })