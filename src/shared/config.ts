import 'dotenv/config';
import { join } from 'node:path';
import { homedir } from 'node:os';

const isDev = process.env.NODE_ENV !== 'production' && !process.env.DATABASE_PATH;

function getDefaultDataPath(): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'jobmatch');
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'jobmatch');
  }
  return join(homedir(), '.config', 'jobmatch');
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  databasePath: process.env.DATABASE_PATH ?? (isDev ? './data' : getDefaultDataPath()),
};
