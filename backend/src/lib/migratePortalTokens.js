import { Person, hashPortalToken, LEGACY_SHARE_TOKEN_PATTERN } from '../models/Person.js';

const PORTAL_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export async function migrateLegacyPortalTokens() {
  const cursor = Person.find({
    shareToken: { $type: 'string' },
    shareTokenHash: { $exists: false },
  }).select('_id shareToken').lean().cursor();
  let migrated = 0;
  const expiresAt = new Date(Date.now() + PORTAL_TOKEN_TTL_MS);

  for await (const person of cursor) {
    if (!LEGACY_SHARE_TOKEN_PATTERN.test(person.shareToken)) {
      throw new Error('Uma pessoa possui um token legado em formato inválido; migração interrompida.');
    }
    const result = await Person.updateOne(
      { _id: person._id, shareToken: person.shareToken, shareTokenHash: { $exists: false } },
      {
        $set: { shareTokenHash: hashPortalToken(person.shareToken), shareTokenExpiresAt: expiresAt },
        $unset: { shareToken: 1 },
      },
    );
    migrated += result.modifiedCount;
  }
  return migrated;
}
