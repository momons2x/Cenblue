import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BrowserProfileRemovalService } from "@cenblu/operations";

const roots: string[] = [];

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "cenblu-browser-profiles-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("managed browser profile removal", () => {
  it("removes one identity through quarantine and preserves sibling profiles", async () => {
    const root = await repository();
    const managed = resolve(root, "storage/browser-profiles");
    const selected = resolve(managed, "collector/chrome");
    const sibling = resolve(managed, "collector/brave/state.txt");
    await mkdir(selected, { recursive: true });
    await mkdir(resolve(sibling, ".."), { recursive: true });
    await writeFile(resolve(selected, "state.txt"), "selected");
    await writeFile(sibling, "sibling");

    const result = await new BrowserProfileRemovalService(root).removeIdentity("collector", "chrome");

    expect(result).toMatchObject({ status: "removed", role: "collector", identityId: "chrome", targetPath: selected });
    await expect(lstat(selected)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(sibling, "utf8")).toBe("sibling");
  });

  it("returns absent and rejects unsafe path inputs", async () => {
    const root = await repository();
    const service = new BrowserProfileRemovalService(root);

    await expect(service.removeIdentity("publisher", "chrome")).resolves.toMatchObject({ status: "absent", role: "publisher" });
    await expect(service.removeIdentity("publisher", "../outside")).rejects.toThrow("safe path segment");
    await expect(service.removeIdentity("admin" as "publisher", "chrome")).rejects.toThrow("Invalid browser profile role");
  });

  it("clears both role trees while preserving unrelated managed paths", async () => {
    const root = await repository();
    const managed = resolve(root, "storage/browser-profiles");
    await mkdir(resolve(managed, "collector/chrome"), { recursive: true });
    await mkdir(resolve(managed, "publisher/brave"), { recursive: true });
    await mkdir(resolve(managed, "keep"), { recursive: true });
    await writeFile(resolve(managed, "keep/unrelated.txt"), "keep");

    const result = await new BrowserProfileRemovalService(root).clearAll();

    expect(result.map(({ role, status }) => ({ role, status }))).toEqual([
      { role: "collector", status: "removed" },
      { role: "publisher", status: "removed" },
    ]);
    expect(await readFile(resolve(managed, "keep/unrelated.txt"), "utf8")).toBe("keep");
  });

  it("does not follow a role symlink or reparse point during identity removal", async () => {
    const root = await repository();
    const outside = resolve(root, "outside");
    const rolePath = resolve(root, "storage/browser-profiles/collector");
    await mkdir(resolve(rolePath, ".."), { recursive: true });
    await mkdir(resolve(outside, "chrome"), { recursive: true });
    await writeFile(resolve(outside, "chrome/state.txt"), "outside");
    await symlink(outside, rolePath, process.platform === "win32" ? "junction" : "dir");

    const result = await new BrowserProfileRemovalService(root).removeIdentity("collector", "chrome");

    expect(result).toMatchObject({ status: "failed", role: "collector" });
    expect(result.error).toContain("symbolic link or reparse point");
    expect(await readFile(resolve(outside, "chrome/state.txt"), "utf8")).toBe("outside");
  });

  it("does not follow a symlink or reparse point in the managed root hierarchy", async () => {
    const root = await repository();
    const outsideStorage = resolve(root, "outside-storage");
    const storagePath = resolve(root, "storage");
    await mkdir(resolve(outsideStorage, "browser-profiles/collector/chrome"), { recursive: true });
    await writeFile(resolve(outsideStorage, "browser-profiles/collector/chrome/state.txt"), "outside");
    await symlink(outsideStorage, storagePath, process.platform === "win32" ? "junction" : "dir");

    const result = await new BrowserProfileRemovalService(root).removeIdentity("collector", "chrome");

    expect(result).toMatchObject({ status: "failed", role: "collector" });
    expect(result.error).toContain("symbolic link or reparse point");
    expect(await readFile(resolve(outsideStorage, "browser-profiles/collector/chrome/state.txt"), "utf8")).toBe("outside");
  });

  it("unlinks a target symlink without deleting its target", async () => {
    const root = await repository();
    const outside = resolve(root, "outside");
    const profile = resolve(root, "storage/browser-profiles/publisher/custom");
    await mkdir(resolve(profile, ".."), { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(resolve(outside, "state.txt"), "outside");
    await symlink(outside, profile, process.platform === "win32" ? "junction" : "dir");

    await expect(new BrowserProfileRemovalService(root).removeIdentity("publisher", "custom")).resolves.toMatchObject({ status: "removed" });
    expect(await readFile(resolve(outside, "state.txt"), "utf8")).toBe("outside");
  });
});
