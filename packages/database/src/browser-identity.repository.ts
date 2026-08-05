import { randomUUID } from "node:crypto";
import type { BrowserIdentity, PrismaClient } from "@prisma/client";
import { withDatabaseRetry } from "./retry";

export type IdentityRole = "COLLECTOR" | "PUBLISHER";

function username(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

export class BrowserIdentityRepository {
  constructor(private readonly client: PrismaClient) {}

  list(role?: IdentityRole): Promise<BrowserIdentity[]> {
    return this.client.browserIdentity.findMany({ where: role ? { role } : undefined, orderBy: [{ role: "asc" }, { createdAt: "asc" }] });
  }

  find(id: string): Promise<BrowserIdentity | null> {
    return this.client.browserIdentity.findUnique({ where: { id } });
  }

  async create(input: { role: IdentityRole; label: string; expectedUsername?: string; browserId: string; executablePath: string | null; profileRoot: string }): Promise<BrowserIdentity> {
    const expectedUsername = input.expectedUsername ? username(input.expectedUsername) : null;
    if (expectedUsername && !/^[a-z0-9_]{1,15}$/.test(expectedUsername)) throw new Error("Enter a valid X username.");
    const id = randomUUID();
    const { profileRoot, ...data } = input;
    return withDatabaseRetry(() => this.client.browserIdentity.create({ data: { id, ...data, label: input.label.trim(), expectedUsername, automaticEnabled: input.role === "PUBLISHER", profilePath: `${profileRoot}/${input.role.toLowerCase()}/${id}` } }));
  }

  updateBinding(id: string, browserId: string, executablePath: string): Promise<BrowserIdentity> {
    return this.client.browserIdentity.update({ where: { id }, data: { browserId, executablePath, verifiedAt: null, verifiedUsername: null, verifiedFingerprint: null, verificationError: null, profileDeletedAt: null } });
  }

  async setVerification(id: string, verifiedUsername: string, fingerprint: string, verifiedAt = new Date()): Promise<BrowserIdentity> {
    const normalizedUsername = username(verifiedUsername);
    return withDatabaseRetry(() => this.client.$transaction(async (transaction) => {
      const identity = await transaction.browserIdentity.findUniqueOrThrow({ where: { id } });
      const conflict = await transaction.browserIdentity.findFirst({ where: { id: { not: id }, role: identity.role, expectedUsername: normalizedUsername } });
      if (conflict) {
        if (conflict.profileDeletedAt || !conflict.enabled) {
          await transaction.browserIdentity.update({ where: { id: conflict.id }, data: { expectedUsername: null, verifiedUsername: null, verifiedAt: null, verifiedFingerprint: null } });
        } else throw new Error(`@${normalizedUsername} is already connected to ${conflict.label}. Delete or disable that profile first.`);
      }
      return transaction.browserIdentity.update({ where: { id }, data: { expectedUsername: normalizedUsername, verifiedUsername: normalizedUsername, verifiedFingerprint: fingerprint, verifiedAt, verificationError: null, profileDeletedAt: null } });
    }));
  }

  setVerificationError(id: string, error: string): Promise<BrowserIdentity> {
    return this.client.browserIdentity.update({ where: { id }, data: { verifiedUsername: null, verifiedFingerprint: null, verifiedAt: null, verificationError: error.slice(0, 1_000) } });
  }

  clearVerification(id: string, profileDeletedAt?: Date): Promise<BrowserIdentity> {
    return this.client.browserIdentity.update({ where: { id }, data: { verifiedUsername: null, verifiedFingerprint: null, verifiedAt: null, verificationError: null, profileDeletedAt } });
  }

  setEnabled(id: string, enabled: boolean): Promise<BrowserIdentity> {
    return this.client.browserIdentity.update({ where: { id }, data: { enabled } });
  }

  setAutomatic(id: string, automaticEnabled: boolean): Promise<BrowserIdentity> {
    return this.client.browserIdentity.update({ where: { id }, data: { automaticEnabled } });
  }
}

export function identityLeaseName(identityId: string): string {
  return `browser-profile:${identityId}`;
}

export function identityFingerprint(identity: Pick<BrowserIdentity, "id" | "role" | "browserId" | "executablePath" | "profilePath" | "profileDirectory">): string {
  return JSON.stringify({ id: identity.id, role: identity.role, browserId: identity.browserId, executablePath: identity.executablePath, profilePath: identity.profilePath, profileDirectory: identity.profileDirectory });
}
