import { adminAuditLog, adminRoles, createDatabase } from "@kyrox/db";

const ROLES = ["owner", "admin", "analyst", "support"] as const;
type Role = (typeof ROLES)[number];

const wallet = (process.env["ADMIN_WALLET"] ?? process.argv[2] ?? "").trim().toLowerCase();
const role = (process.env["ADMIN_ROLE"] ?? process.argv[3] ?? "owner").trim() as Role;
const databaseUrl =
  process.env["DIRECT_DATABASE_URL"]?.trim() || process.env["DATABASE_URL"]?.trim();

if (!/^0x[0-9a-f]{40}$/.test(wallet)) {
  console.error("Set ADMIN_WALLET (or pass a wallet argument) to a valid 20-byte address.");
  process.exit(2);
}
if (!ROLES.includes(role)) {
  console.error(`ADMIN_ROLE must be one of: ${ROLES.join(", ")}.`);
  process.exit(2);
}
if (databaseUrl === undefined || databaseUrl.length === 0) {
  console.error("DATABASE_URL or DIRECT_DATABASE_URL is required.");
  process.exit(2);
}

const database = createDatabase(databaseUrl);
try {
  await database.db
    .insert(adminRoles)
    .values({ wallet, role, addedBy: "bootstrap", createdAt: new Date() })
    .onConflictDoUpdate({
      target: adminRoles.wallet,
      set: { role, addedBy: "bootstrap" },
    });
  await database.db.insert(adminAuditLog).values({
    adminWallet: "bootstrap",
    action: "admin_bootstrap",
    target: wallet,
    beforeJson: null,
    afterJson: JSON.stringify({ wallet, role }),
    createdAt: new Date(),
  });
  console.log(JSON.stringify({ event: "admin_granted", wallet, role }));
} finally {
  await database.pool.end();
}
