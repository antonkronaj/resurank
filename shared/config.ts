import 'dotenv/config';

const isDev = process.env.NODE_ENV !== 'production';

// console.log('Config DATABASE_PATH:', process.env.DATABASE_PATH);
export const config = {
  port: Number(process.env.PORT ?? 3001),
  databasePath: process.env.DATABASE_PATH || './data',
};
