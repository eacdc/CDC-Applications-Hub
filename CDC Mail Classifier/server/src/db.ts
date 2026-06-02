import mongoose from 'mongoose';
import { config } from './config.js';
import { Email } from './models/Email.js';
import { Inbox } from './models/Inbox.js';

let connected = false;

export async function connectDb(): Promise<void> {
  if (connected) return;

  mongoose.set('strictQuery', true);

  await mongoose.connect(config.mongodbUri);

  await Email.syncIndexes();
  await Inbox.syncIndexes();

  connected = true;
  console.log('[DB] Connected to MongoDB');
}

export async function disconnectDb(): Promise<void> {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
  console.log('[DB] Disconnected from MongoDB');
}

export { mongoose };
