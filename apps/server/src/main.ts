import 'reflect-metadata';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';

const main = async (): Promise<void> => {
  const env = loadEnv();
  const app = await createApp(env);
  await app.listen(env.PORT);
};

void main();
