import { randomUUID } from "node:crypto";
import { lstat, rename, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const browserProfileRoles = ["collector", "publisher"] as const;
export type BrowserProfileRole = typeof browserProfileRoles[number];
export type BrowserProfileRemovalStatus = "absent" | "removed" | "residual" | "failed";

export type BrowserProfileRemovalOutcome = {
  status: BrowserProfileRemovalStatus;
  role: BrowserProfileRole;
  identityId?: string;
  targetPath: string;
  residualPath?: string;
  error?: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function assertRole(role: string): asserts role is BrowserProfileRole {
  if (!browserProfileRoles.includes(role as BrowserProfileRole)) throw new TypeError(`Invalid browser profile role: ${role}`);
}

function assertIdentityId(identityId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(identityId)) throw new TypeError("Browser profile identity ID must be a safe path segment");
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(identityId)) throw new TypeError("Browser profile identity ID is a reserved path name");
}

function containedBy(root: string, path: string): boolean {
  const value = relative(resolve(root), resolve(path));
  return value !== "" && value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}

export class BrowserProfileRemovalService {
  readonly repositoryRoot: string;
  readonly managedRoot: string;

  constructor(repositoryRoot: string) {
    this.repositoryRoot = resolve(repositoryRoot);
    this.managedRoot = resolve(this.repositoryRoot, "storage", "browser-profiles");
  }

  async removeIdentity(role: BrowserProfileRole, identityId: string): Promise<BrowserProfileRemovalOutcome> {
    assertRole(role);
    assertIdentityId(identityId);
    const rolePath = resolve(this.managedRoot, role);
    const targetPath = resolve(rolePath, identityId);
    if (!containedBy(this.managedRoot, rolePath) || !containedBy(rolePath, targetPath)) throw new TypeError("Browser profile path is outside managed storage");

    const rootError = await this.safeManagedRootError();
    if (rootError === "absent") return { status: "absent", role, identityId, targetPath };
    if (rootError) return { status: "failed", role, identityId, targetPath, error: rootError };
    const roleError = await this.safeDirectoryError(rolePath, "Browser profile role directory");
    if (roleError === "absent") return { status: "absent", role, identityId, targetPath };
    if (roleError) return { status: "failed", role, identityId, targetPath, error: roleError };
    return this.stageAndRemove(role, targetPath, identityId);
  }

  async clearAll(): Promise<BrowserProfileRemovalOutcome[]> {
    const outcomes: BrowserProfileRemovalOutcome[] = [];
    for (const role of browserProfileRoles) outcomes.push(await this.clearRole(role));
    return outcomes;
  }

  private async clearRole(role: BrowserProfileRole): Promise<BrowserProfileRemovalOutcome> {
    const targetPath = resolve(this.managedRoot, role);
    const rootError = await this.safeManagedRootError();
    if (rootError === "absent") return { status: "absent", role, targetPath };
    if (rootError) return { status: "failed", role, targetPath, error: rootError };
    return this.stageAndRemove(role, targetPath);
  }

  private async safeDirectoryError(path: string, label: string): Promise<string | "absent" | undefined> {
    try {
      const entry = await lstat(path);
      if (entry.isSymbolicLink()) return `${label} must not be a symbolic link or reparse point`;
      if (!entry.isDirectory()) return `${label} must be a directory`;
      return undefined;
    } catch (error) {
      return isMissing(error) ? "absent" : `${label} could not be inspected: ${errorMessage(error)}`;
    }
  }

  private async safeManagedRootError(): Promise<string | "absent" | undefined> {
    const directories = [
      [this.repositoryRoot, "Repository root"],
      [resolve(this.repositoryRoot, "storage"), "Storage directory"],
      [this.managedRoot, "Managed browser profile root"],
    ] as const;
    for (const [path, label] of directories) {
      const error = await this.safeDirectoryError(path, label);
      if (error) return error;
    }
    return undefined;
  }

  private async stageAndRemove(role: BrowserProfileRole, targetPath: string, identityId?: string): Promise<BrowserProfileRemovalOutcome> {
    const outcome = { role, ...(identityId === undefined ? {} : { identityId }), targetPath };
    try {
      await lstat(targetPath);
    } catch (error) {
      if (isMissing(error)) return { status: "absent", ...outcome };
      return { status: "failed", ...outcome, error: errorMessage(error) };
    }

    const quarantinePath = resolve(this.managedRoot, `.quarantine-${role}-${randomUUID()}`);
    if (!containedBy(this.managedRoot, quarantinePath)) return { status: "failed", ...outcome, error: "Quarantine path is outside managed storage" };
    try {
      await rename(targetPath, quarantinePath);
    } catch (error) {
      return { status: "failed", ...outcome, error: errorMessage(error) };
    }

    try {
      await rm(quarantinePath, { recursive: true, force: true });
      return { status: "removed", ...outcome };
    } catch (error) {
      return { status: "residual", ...outcome, residualPath: quarantinePath, error: errorMessage(error) };
    }
  }
}
