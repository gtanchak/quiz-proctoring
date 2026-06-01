import { eq } from "drizzle-orm";
import { db, pool } from "../db/client.js";
import { organizations } from "../db/schema/accounts.js";
import { apiKeys } from "../db/schema/api-keys.js";
import { generateApiKey } from "../lib/api-key.js";

/**
 * Creates an API key and prints the raw token once. A key belongs to an
 * organization (PRO-39): pass an existing org id, or omit it to create a new
 * org named after the key. Admins also manage keys through the authenticated
 * API; this script bootstraps machine credentials for local/operator use.
 *
 * Usage:
 *   pnpm --filter @proctoring/core-api key:create -- "<name>" [orgId]
 */
// Drop a leading "--" that some package-manager invocations forward through.
const argv = process.argv.slice(2);
if (argv[0] === "--") {
  argv.shift();
}
const name = argv[0]?.trim();
const orgIdArg = argv[1]?.trim();
if (!name) {
  console.error('Usage: key:create -- "<name>" [orgId]');
  process.exit(1);
}

let orgId: string;
if (orgIdArg) {
  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, orgIdArg))
    .limit(1);
  if (!org) {
    console.error(`No organization with id ${orgIdArg}`);
    await pool.end();
    process.exit(1);
  }
  orgId = org.id;
} else {
  const [org] = await db
    .insert(organizations)
    .values({ name: `${name} (org)` })
    .returning({ id: organizations.id });
  orgId = org.id;
  console.log(`Created organization (id: ${orgId})`);
}

const { token, prefix, hash } = generateApiKey();

const [row] = await db
  .insert(apiKeys)
  .values({ orgId, name, keyPrefix: prefix, keyHash: hash })
  .returning({ id: apiKeys.id });

await pool.end();

console.log(`Created API key "${name}" (id: ${row.id}, org: ${orgId})`);
console.log("Store this token now — it will not be shown again:\n");
console.log(`  ${token}\n`);
