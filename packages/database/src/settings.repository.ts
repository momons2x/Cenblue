import type { PrismaClient } from "@prisma/client";

export class SettingsRepository {
  constructor(private readonly client: PrismaClient) {}

  async getAll(): Promise<Record<string, string>> {
    const settings = await this.client.appSetting.findMany({ orderBy: { key: "asc" } });
    return Object.fromEntries(settings.map((setting) => [setting.key, setting.value]));
  }

  async setMany(values: Record<string, string>): Promise<void> {
    await this.client.$transaction(Object.entries(values).map(([key, value]) => this.client.appSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    })));
  }
}
