import { db, pool } from "../db/client.js";
import { apiKeys } from "../db/schema/api-keys.js";
import { generateApiKey } from "../lib/api-key.js";

/**
 * Creates an API key and prints the raw token once. This bootstraps the first
 * key before the accounts system (PRO-39) exists; later, admins manage keys
 * through the authenticated API.
 *
 * Usage: pnpm --filter @proctoring/core-api key:create -- "My key name"
 */
const name = process.argv[2]?.trim();
if (!name) {
  console.error('Usage: key:create -- "<name>"');
  process.exit(1);
}

const { token, prefix, hash } = generateApiKey();

const [row] = await db
  .insert(apiKeys)
  .values({ name, keyPrefix: prefix, keyHash: hash })
  .returning({ id: apiKeys.id });

await pool.end();

console.log(`Created API key "${name}" (id: ${row.id})`);
console.log("Store this token now — it will not be shown again:\n");
console.log(`  ${token}\n`);
