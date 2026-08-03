import { access, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "@cenblu/database";
import { PortableConfigService } from "@cenblu/operations";

async function main(): Promise<void> {
  const operation = process.argv[2];
  const service = new PortableConfigService(prisma);
  if (operation === "export") {
    const path = resolve(process.argv[3] ?? "cenblu-preferences.json");
    const temporaryPath = `${path}.part`;
    try {
      await access(path);
      throw new Error(`Refusing to overwrite existing file: ${path}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rm(temporaryPath, { force: true });
    await writeFile(temporaryPath, `${JSON.stringify(await service.export(), null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, path);
    console.log(`Portable preferences exported to ${path}`);
    return;
  }
  if (operation === "import") {
    const input = process.argv[3];
    if (!input) throw new Error("Usage: pnpm config:import <manifest.json>");
    const path = resolve(input);
    const result = await service.import(JSON.parse(await readFile(path, "utf8")) as unknown);
    console.log(`Imported ${result.settings} settings and ${result.sources} managed sources from ${path}`);
    console.log("Browser sessions were not imported. Run both session checks on this device.");
    return;
  }
  throw new Error("Expected export or import operation.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
