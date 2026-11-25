import { describe, expect, it } from "vitest";

import { permissionsForRole, roleCan } from "../lib/server/admin.js";

describe("admin role matrix", () => {
  it("grants owners every permission", () => {
    const permissions = permissionsForRole("owner");
    expect(permissions).toContain("manage_admins");
    expect(permissions).toContain("view_audit");
    expect(permissions).toContain("manage_policy");
    expect(permissions).toContain("manage_kill_switch");
  });

  it("prevents admins from managing admins", () => {
    expect(roleCan("admin", "manage_policy")).toBe(true);
    expect(roleCan("admin", "manage_admins")).toBe(false);
  });

  it("keeps analysts read-only and support focused on review", () => {
    expect(roleCan("analyst", "view_metrics")).toBe(true);
    expect(roleCan("analyst", "manage_flags")).toBe(false);
    expect(roleCan("analyst", "manage_policy")).toBe(false);
    expect(roleCan("support", "manage_flags")).toBe(true);
    expect(roleCan("support", "manage_feedback")).toBe(true);
    expect(roleCan("support", "manage_policy")).toBe(false);
  });
});
