import { stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { PublisherError } from "./types";

export interface PublishMediaVerifier {
  verify(path: string): Promise<void>;
}

export class LocalPublishMediaVerifier implements PublishMediaVerifier {
  constructor(private readonly videosDirectory: string) {}

  async verify(path: string): Promise<void> {
    const relativePath = relative(resolve(this.videosDirectory), resolve(path));
    if (relativePath.startsWith("..") || relativePath.includes(":")) {
      throw new PublisherError("MISSING_MEDIA", "Media path is outside configured video storage", false, false);
    }
    try {
      const metadata = await stat(path);
      if (!metadata.isFile() || metadata.size <= 0) throw new Error("not a non-empty file");
    } catch (error) {
      throw new PublisherError("MISSING_MEDIA", `Local media is unavailable: ${path}`, false, false, { cause: error });
    }
  }
}
