import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { PrismaNeon } from '@prisma/adapter-neon';
import path from 'path';

const useLocalDb =
  process.env.USE_LOCAL_DB === 'true' ||
  !process.env.DATABASE_URL ||
  !process.env.DATABASE_URL.startsWith('postgres');

export const prisma: PrismaClient = useLocalDb
  ? (() => {
      const dbPath = path.resolve(__dirname, '../../dev.db').replace(/\\/g, '/');
      return new PrismaClient({
        adapter: new PrismaLibSql({ url: `file:${dbPath}` }),
        log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
      });
    })()
  : new PrismaClient({
      adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
      log: ['error'],
    });

export async function connectDB() {
  try {
    await prisma.$connect();
    console.log('✅ Connected to Database via', useLocalDb ? 'Local LibSQL' : 'Neon Postgres');
  } catch (error) {
    console.error('❌ Failed to connect to database:', error);
  }
}
