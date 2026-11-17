import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { User } from '../../src/models/User.js';
import { Person } from '../../src/models/Person.js';
import { Card } from '../../src/models/Card.js';

export async function startMongoMemory() {
  const replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replicaSet.getUri(), { dbName: 'financeiro_test' });
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init()));

  return async () => {
    await mongoose.disconnect();
    await replicaSet.stop();
  };
}

export async function clearMongoMemory() {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})),
  );
}

export async function createTestAccount({ email, name = 'Test user', limit = 1000 }) {
  const user = await User.create({ name, email, status: 'active' });
  const person = await Person.create({ userId: user._id, name: `${name} person` });
  const card = await Card.create({ userId: user._id, name: `${name} card`, limit });
  const token = jwt.sign({ sub: String(user._id) }, process.env.JWT_SECRET);
  return { user, person, card, cookie: `caderno_token=${token}` };
}

export function createApiClient(baseUrl, initialCookie = '') {
  let cookie = initialCookie;
  return async (method, path, body) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(cookie && { Cookie: cookie }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const text = await response.text();
    let json = null;
    if (text && response.headers.get('content-type')?.includes('application/json')) {
      try {
        json = JSON.parse(text);
      } catch (error) {
        throw new Error('API returned invalid JSON', { cause: error });
      }
    }
    return { status: response.status, json, text, headers: response.headers };
  };
}
