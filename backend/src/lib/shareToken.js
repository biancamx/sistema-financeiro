import { randomInt } from 'node:crypto';

const SHARE_TOKEN_CHARACTERS = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';

export function generateShareToken(database, length = 10) {
  const exists = database.prepare('SELECT 1 FROM people WHERE share_token = ?');
  let token;
  do {
    token = Array.from({ length }, () => SHARE_TOKEN_CHARACTERS[randomInt(SHARE_TOKEN_CHARACTERS.length)]).join('');
  } while (exists.get(token));
  return token;
}
