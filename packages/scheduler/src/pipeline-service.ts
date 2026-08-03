import type { ReviewCaptionResolver, SchedulerRepository } from "@cenblu/database";
import type { Logger } from "pino";

export interface PipelineSteps {
  collect(): Promise<void>;
  download(): Promise<number>;
  publish(): Promise<boolean>;
}

export type PipelineCycleResult = {
  acquired: boolean;
  downloadsProcessed: number;
  publishJobsScheduled: number;
  published: boolean;
};

export class PipelineService {
  private stopping = false;

  constructor(
    private readonly repository: SchedulerRepository,
    private readonly steps: PipelineSteps,
    private readonly logger: Logger,
    private readonly publishIntervalMinutes: number,
    private readonly leaseMs: number,
    private readonly captionResolver?: ReviewCaptionResolver,
  ) {}

  requestStop(): void { this.stopping = true; }

  async runOnce(now = new Date()): Promise<PipelineCycleResult> {
    if (this.stopping) return { acquired: false, downloadsProcessed: 0, publishJobsScheduled: 0, published: false };
    const lease = await this.repository.acquire("pipeline", now, this.leaseMs);
    if (!lease) {
      this.logger.info({ operation: "scheduler.cycle.skipped" }, "Pipeline cycle is already running");
      return { acquired: false, downloadsProcessed: 0, publishJobsScheduled: 0, published: false };
    }
    try {
      await this.steps.collect();
      if (this.stopping) return { acquired: true, downloadsProcessed: 0, publishJobsScheduled: 0, published: false };
      const downloadsProcessed = await this.steps.download();
      if (this.stopping) return { acquired: true, downloadsProcessed, publishJobsScheduled: 0, published: false };
      const publishJobsScheduled = await this.repository.scheduleDownloadedAssets(now, this.publishIntervalMinutes, this.captionResolver);
      if (this.stopping) return { acquired: true, downloadsProcessed, publishJobsScheduled, published: false };
      const published = await this.steps.publish();
      const result = { acquired: true, downloadsProcessed, publishJobsScheduled, published };
      this.logger.info({ operation: "scheduler.cycle.complete", ...result }, "Pipeline cycle completed");
      return result;
    } finally {
      await this.repository.release(lease);
    }
  }
}
