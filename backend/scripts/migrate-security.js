import 'dotenv/config';
import mongoose from 'mongoose';
import { connectMongo } from '../src/db/mongo.js';
import { AuthSession } from '../src/models/AuthSession.js';
import { AuditEvent } from '../src/models/AuditEvent.js';
import { SecurityAlert } from '../src/models/SecurityAlert.js';
import { Person } from '../src/models/Person.js';
import { migrateLegacyPortalTokens } from '../src/lib/migratePortalTokens.js';

if (process.env.SECURITY_MIGRATION_BACKUP_VERIFIED !== 'true') {
  throw new Error('Confirme um backup recente e verificado definindo SECURITY_MIGRATION_BACKUP_VERIFIED=true.');
}

await connectMongo();
try {
  const personIndexes = await Person.collection.indexes();
  const legacyShareTokenIndex = personIndexes.find((index) => index.key.shareToken === 1
    && index.unique
    && !index.partialFilterExpression);
  if (legacyShareTokenIndex) await Person.collection.dropIndex(legacyShareTokenIndex.name);
  await Promise.all([
    Person.createIndexes(),
    AuthSession.createIndexes(),
    AuditEvent.createIndexes(),
    SecurityAlert.createIndexes(),
  ]);
  const migrated = await migrateLegacyPortalTokens();
  console.log(`Migração concluída; links legados convertidos: ${migrated}.`);
} finally {
  await mongoose.disconnect();
}
