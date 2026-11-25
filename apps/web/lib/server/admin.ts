import { createHash } from "node:crypto";

import { adminAuditLog, adminRoles, type PlatformDb } from "@kyrox/db";
import { eq } from "drizzle-orm";

import { appDatabase } from "./database.js";
import { isDemoMode } from "../demo/mode.js";
import { getSession, type AppSession } from "./session.js";

export type AdminRole = "owner" | "admin" | "analyst" | "support";

export type AdminPermission =
  | "view_metrics"
  | "view_users"
  | "view_emails"
  | "export_csv"
  | "export_without_emails"
  | "manage_flags"
  | "manage_leaderboard"
  | "manage_policy"
  | "manage_kill_switch"
  | "manage_admins"
  | "manage_feedback"
  | "view_audit";

const ALL: readonly AdminPermission[] = [
  "view_metrics",
  "view_users",
  "view_emails",
  "export_csv",
  "export_without_emails",
  "manage_flags",
  "manage_leaderboard",
  "manage_policy",
  "manage_kill_switch",
  "manage_admins",
  "manage_feedback",
  "view_audit",
];

const ROLE_PERMISSIONS: Readonly<Record<AdminRole, readonly AdminPermission[]>> = {
  owner: ALL,
  admin: ALL.filter((permission) => permission !== "manage_admins" && permission !== "view_audit"),
  analyst: ["view_metrics", "view_users", "export_without_emails", "view_audit"],
  support: ["view_metrics", "view_users", "view_emails", "manage_flags", "manage_feedback"],
};

export function permissionsForRole(role: AdminRole): readonly AdminPermission[] {
  return ROLE_PERMISSIONS[role];
}

export function roleCan(role: AdminRole, permission: AdminPermission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export class AdminError extends Error {
  override readonly name = "AdminError";

  constructor(
    readonly status: 401 | 403 | 503,
    readonly code: "ADMIN_AUTH_REQUIRED" | "ADMIN_FORBIDDEN" | "ADMIN_UNAVAILABLE",
    message: string,
  ) {
    super(message);
  }
}

export interface AdminContext {
  readonly session: AppSession;
  readonly role: AdminRole;
  readonly db: PlatformDb;
}

async function roleForWallet(db: PlatformDb, address: string): Promise<AdminRole | null> {
  const rows = await db
    .select()
    .from(adminRoles)
    .where(eq(adminRoles.wallet, address.toLowerCase()))
    .limit(1);
  return rows[0]?.role ?? null;
}

/**
 * Resolve an admin from the signed wallet session and the database role table.
 * Admin access is never granted in demo mode: there is no durable user table or
 * real operator identity to protect, so the dashboard stays unavailable rather
 * than using a fake local role.
 */
export async function getAdminContext(): Promise<AdminContext> {
  if (isDemoMode()) {
    throw new AdminError(
      503,
      "ADMIN_UNAVAILABLE",
      "Admin tools require a live PostgreSQL deployment with admin roles.",
    );
  }
  const session = await getSession();
  if (session === null) {
    throw new AdminError(401, "ADMIN_AUTH_REQUIRED", "Sign in with an admin wallet.");
  }
  const databaseUrl = process.env["DATABASE_URL"]?.trim();
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new AdminError(503, "ADMIN_UNAVAILABLE", "Admin tools require DATABASE_URL.");
  }
  const db = appDatabase(databaseUrl).db;
  const role = await roleForWallet(db, session.address);
  if (role === null) {
    throw new AdminError(403, "ADMIN_FORBIDDEN", "This wallet is not an administrator.");
  }
  return { session, role, db };
}

export async function requireAdmin(permission: AdminPermission): Promise<AdminContext> {
  const context = await getAdminContext();
  if (!roleCan(context.role, permission)) {
    throw new AdminError(403, "ADMIN_FORBIDDEN", "Your admin role does not allow this action.");
  }
  return context;
}

export interface AuditInput {
  readonly adminWallet: string;
  readonly action: string;
  readonly target?: string | null;
  readonly before?: unknown;
  readonly after?: unknown;
}

function boundedJson(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    const json = JSON.stringify(value, (_key, item) =>
      typeof item === "bigint" ? item.toString() : item,
    );
    return json.length > 8_000 ? json.slice(0, 8_000) : json;
  } catch {
    return null;
  }
}

/** Every privileged mutation must call this before returning success. */
export async function auditAdminAction(db: PlatformDb, input: AuditInput): Promise<void> {
  await db.insert(adminAuditLog).values({
    adminWallet: input.adminWallet.toLowerCase(),
    action: input.action.slice(0, 128),
    target: input.target ?? null,
    beforeJson: boundedJson(input.before),
    afterJson: boundedJson(input.after),
    createdAt: new Date(),
  });
}

/** Salted hash for optional abuse correlation; raw IPs are never stored. */
export function hashIp(ip: string | null, secret: string): string | null {
  if (ip === null || ip.trim().length === 0) return null;
  return createHash("sha256").update(`${secret}:${ip.trim()}`).digest("hex").slice(0, 32);
}
