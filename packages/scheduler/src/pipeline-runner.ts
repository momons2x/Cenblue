import cron, { type ScheduledTask } from "node-cron";
import type { Logger } from "pino";
import type { PipelineCycleResult, PipelineService } from "./pipeline-service";

export class PipelineRunner {
  private task: ScheduledTask | null = null;
  private running: Promise<unknown> | null = null;

  constructor(
    private readonly pipeline: PipelineService,
    private readonly logger: Logger,
    private readonly intervalMinutes: number,
    private readonly onCycleComplete?: (result: PipelineCycleResult) => Promise<void> | void,
  ) {}

  start(): void {
    const expression = `*/${this.intervalMinutes} * * * *`;
    this.task = cron.schedule(expression, () => { void this.trigger(); });
    void this.trigger();
    this.logger.info({ operation: "scheduler.started", cadenceMinutes: this.intervalMinutes }, "Pipeline scheduler started");
  }

  private async trigger(): Promise<void> {
    if (this.running) return;
    this.running = this.pipeline.runOnce().then(async (result) => {
      await this.onCycleComplete?.(result);
    }).catch((error: unknown) => {
      this.logger.error({ operation: "scheduler.cycle.failed", error: error instanceof Error ? error.message : String(error) }, "Pipeline cycle failed");
    }).finally(() => { this.running = null; });
    await this.running;
  }

  async stop(): Promise<void> {
    this.pipeline.requestStop();
    this.task?.stop();
    await this.running;
    this.logger.info({ operation: "scheduler.stopped" }, "Pipeline scheduler stopped");
  }
}
