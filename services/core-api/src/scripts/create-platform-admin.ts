import { PASSWORD_MIN_LENGTH } from "@proctoring/shared";
import { db, pool } from "../db/client.js";
import { organizations, users } from "../db/schema/accounts.js";
import { hashPassword } from "../lib/password.js";

/**
 * Bootstraps the first `platform_admin` (cross-tenant super-admin, PRO-57) in a
 * dedicated home organization, with email already verified — so an operator can
 * stand one up without email infrastructure. Operator-run CLI only; the public
 * API never provisions a platform admin.
 *
 * Usage:
 *   pnpm --filter @proctoring/core-api tsx --env-file=.env \
 *     src/scripts/create-platform-admin.ts -- "<email>" "<name>" "<password>"
 */
const argv = process.argv.slice(2);
if (argv[0] === "--") {
  argv.shift();
}
const email = argv[0]?.trim().toLowerCase();
const name = argv[1]?.trim();
const password = argv[2];

if (!email || !name || !password) {
  console.error(
    'Usage: create-platform-admin -- "<email>" "<name>" "<password>"',
  );
  process.exit(1);
}
if (password.length < PASSWORD_MIN_LENGTH) {
  console.error(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  process.exit(1);
}

const [org] = await db
  .insert(organizations)
  .values({ name: "Platform" })
  .returning({ id: organizations.id });

const [user] = await db
  .insert(users)
  .values({
    orgId: org.id,
    email,
    name,
    role: "platform_admin",
    passwordHash: hashPassword(password),
    emailVerifiedAt: new Date(),
  })
  .returning({ id: users.id });

await pool.end();

console.log(`Created platform_admin "${email}" (id: ${user.id}) — email pre-verified.`);
