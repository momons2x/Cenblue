import { readdir, stat, unlink } from "node:fs/promises";
import { resolve } from "node:path";

export async function pruneDiagnosticFiles(directory: string, prefix: string, retainedFiles = 50): Promise<void> {
  try {
    const entries = (await readdir(directory)).filter((name) => name.startsWith(prefix));
    const dated = await Promise.all(entries.map(async (name) => ({ name, modified: (await stat(resolve(directory, name))).mtimeMs })));
    dated.sort((left, right) => right.modified - left.modified);
    await Promise.all(dated.slice(retainedFiles).map(({ name }) => unlink(resolve(directory, name))));
  } catch { /* The diagnostics directory may not exist yet. */ }
}
