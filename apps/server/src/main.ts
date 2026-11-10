import 'reflect-metadata';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { enforceStagingGuard } from './config/staging-guard.js';

const main = async (): Promise<void> => {
  const env = loadEnv();
  enforceStagingGuard(env);
  const app = await createApp(env);
  await app.listen(env.PORT);
};

void main();
