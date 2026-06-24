import { PASSWORD_MIN_LENGTH } from "@proctoring/shared";
import { db, pool } from "../db/client.js";
import { organizations, users } from "../db/schema/accounts.js";
import { hashPassword } from "../lib/password.js";

/**
 * Bootstraps an organization and its first `tenant_admin` user, with email already
 * verified — so an operator can stand up a working account in dev without the
 * email-delivery infrastructure (SES, PRO-38).
 *
 * This is an operator-run CLI, intentionally distinct from the public API,
 * which must never provision an account on a user's behalf (CLAUDE.md / PRO-39
 * notes). Use only for local/dev/seed bootstrapping.
 *
 * Usage:
 *   pnpm --filter @proctoring/core-api admin:create -- "<orgName>" "<email>" "<name>" "<password>"
 */
// Drop a leading "--" that some package-manager invocations forward through.
const argv = process.argv.slice(2);
if (argv[0] === "--") {
  argv.shift();
}
const orgName = argv[0]?.trim();
const email = argv[1]?.trim().toLowerCase();
const name = argv[2]?.trim();
const password = argv[3];

if (!orgName || !email || !name || !password) {
  console.error(
    'Usage: admin:create -- "<orgName>" "<email>" "<name>" "<password>"',
  );
  process.exit(1);
}
if (password.length < PASSWORD_MIN_LENGTH) {
  console.error(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  process.exit(1);
}

const [org] = await db
  .insert(organizations)
  .values({ name: orgName })
  .returning({ id: organizations.id });

const [user] = await db
  .insert(users)
  .values({
    orgId: org.id,
    email,
    name,
    role: "tenant_admin",
    passwordHash: hashPassword(password),
    emailVerifiedAt: new Date(),
  })
  .returning({ id: users.id });

await pool.end();

console.log(`Created organization "${orgName}" (id: ${org.id})`);
console.log(`Created tenant_admin "${email}" (id: ${user.id}) — email pre-verified.`);
