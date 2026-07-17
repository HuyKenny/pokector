/**
 * Grant the admin role to an existing user (SPEC §7).
 *
 *   pnpm admin:grant --email user@example.com                 # local D1
 *   pnpm admin:grant --email user@example.com --env staging   # remote staging
 *   pnpm admin:grant --email user@example.com --env production
 *
 * Runs server-side SQL through wrangler (never a client-side value), requires
 * explicit confirmation, and records an admin audit event. Without an e-mail
 * provider users cannot verify their address; pass --allow-unverified to accept
 * that documented state (docs/DECISIONS.md D10).
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : (args[i + 1] ?? true);
}

const email = flag("email");
const envName = flag("env"); // null = local
const allowUnverified = args.includes("--allow-unverified");

if (!email || typeof email !== "string" || !email.includes("@")) {
  console.error(
    "Usage: pnpm admin:grant --email user@example.com [--env staging|production] [--allow-unverified]",
  );
  process.exit(1);
}
if (envName && !["staging", "production"].includes(envName)) {
  console.error(`Unknown --env "${envName}" (use staging or production).`);
  process.exit(1);
}

const dbName = envName === "production" ? "pokector-production" : "pokector-staging";
const targetArgs = envName ? ["--env", envName, "--remote"] : ["--local"];

function d1Query(sql) {
  const out = execFileSync(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", dbName, ...targetArgs, "--json", "--command", sql],
    { encoding: "utf8" },
  );
  const parsed = JSON.parse(out);
  return parsed[0]?.results ?? [];
}

// SQL-string literal escaping for the two interpolated values (email, ids).
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;

const users = d1Query(
  `SELECT id, email, name, role, email_verified FROM user WHERE email = ${q(email)} LIMIT 1`,
);
if (users.length === 0) {
  console.error(`No user found with e-mail ${email} in ${envName ?? "local"} database.`);
  process.exit(1);
}
const user = users[0];

if (!user.email_verified && !allowUnverified) {
  console.error(
    `User ${email} exists but is not verified. Without an e-mail provider configured,\n` +
      `verification is impossible — re-run with --allow-unverified if you accept that.`,
  );
  process.exit(1);
}
if (user.role === "admin") {
  console.log(`User ${email} is already an admin. Nothing to do.`);
  process.exit(0);
}

console.log(`About to grant ADMIN on ${envName ?? "local"} (${dbName}) to:`);
console.log(
  `  ${user.name} <${user.email}> (id ${user.id}, verified: ${user.email_verified ? "yes" : "no"})`,
);

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question('Type "grant" to confirm: ');
rl.close();
if (answer.trim() !== "grant") {
  console.log("Aborted.");
  process.exit(1);
}

d1Query(`UPDATE user SET role = 'admin' WHERE id = ${q(user.id)}`);
d1Query(`UPDATE user_profiles SET role = 'admin' WHERE user_id = ${q(user.id)}`);
d1Query(
  `INSERT INTO admin_audit_logs (id, admin_user_id, action, target_type, target_id, metadata_json, created_at)
   VALUES (${q(randomUUID())}, ${q(user.id)}, 'admin.grant', 'user', ${q(user.id)},
           '{"via":"cli","grantedBy":"admin-grant script"}', ${Date.now()})`,
);

console.log(`✔ ${email} is now an admin (audit event recorded).`);
