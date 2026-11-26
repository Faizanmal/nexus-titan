import { HybridRuntimeError } from "./errors.ts";
import { assertLeaseValid } from "./lease.ts";
import type { HybridTrace, InferenceOutput, LeasedInferenceTask } from "./types.ts";

export interface TaskTransport {
  submitResult(result: InferenceOutput, signal: AbortSignal): Promise<void>;
}

export interface SchedulerOptions {
  now?: () => number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  maxSubmitAttempts?: number;
  baseDelayMs?: number;
  onTrace?: (trace: HybridTrace) => void;
}

function defaultWait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new HybridRuntimeError("CANCELLED", "Task was cancelled."));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(new HybridRuntimeError("CANCELLED", "Task was cancelled.")); }, { once: true });
  });
}

export class TaskScheduler {
  private readonly now: () => number;
  private readonly wait: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly active = new Map<string, AbortController>();
  private readonly transport: TaskTransport;
  private readonly options: SchedulerOptions;

  constructor(transport: TaskTransport, options: SchedulerOptions = {}) {
    this.transport = transport;
    this.options = options;
    this.now = options.now ?? Date.now;
    this.wait = options.wait ?? defaultWait;
  }

  cancel(taskId: string): boolean {
    const controller = this.active.get(taskId);
    if (!controller) return false;
    controller.abort();
    this.active.delete(taskId);
    return true;
  }

  async submit(task: LeasedInferenceTask, output: InferenceOutput, mode: HybridTrace["mode"], actualSource: HybridTrace["actualSource"], parentSignal?: AbortSignal): Promise<HybridTrace> {
    assertLeaseValid(task, this.now());
    const controller = new AbortController();
    const cancelFromParent = () => controller.abort();
    if (parentSignal?.aborted) controller.abort();
    parentSignal?.addEventListener("abort", cancelFromParent, { once: true });
    this.active.set(task.task_id, controller);
    const trace: HybridTrace = { taskId: task.task_id, leaseId: task.lease_id, mode, actualSource,
      status: "submitting", attempts: 0, privacy: task.classification ?? "restricted", templateId: task.input.template_id };
    const emit = (status: HybridTrace["status"]) => { trace.status = status; this.options.onTrace?.({ ...trace }); };
    const max = Math.max(1, Math.min(3, this.options.maxSubmitAttempts ?? 3));
    const base = Math.max(10, Math.min(5000, this.options.baseDelayMs ?? 250));
    try {
      for (let attempt = 1; attempt <= max; attempt++) {
        if (controller.signal.aborted) throw new HybridRuntimeError("CANCELLED", "Task result submission was cancelled.");
        assertLeaseValid(task, this.now());
        trace.attempts = attempt;
        emit(attempt === 1 ? "submitting" : "retry_wait");
        try {
          await this.transport.submitResult(output, controller.signal);
          if (controller.signal.aborted) throw new HybridRuntimeError("CANCELLED", "Task result submission was cancelled.");
          emit("submitted");
          return { ...trace };
        } catch (error) {
          if (error instanceof HybridRuntimeError && (error.code === "CANCELLED" || error.code === "LEASE_EXPIRED")) throw error;
          if (attempt === max) throw new HybridRuntimeError("RESULT_SUBMISSION_FAILED", "Result submission failed after bounded retries.", true);
          await this.wait(base * 2 ** (attempt - 1), controller.signal);
        }
      }
      throw new HybridRuntimeError("RESULT_SUBMISSION_FAILED", "Result submission did not complete.");
    } catch (error) {
      trace.errorCode = error instanceof HybridRuntimeError ? error.code : "RESULT_SUBMISSION_FAILED";
      emit(error instanceof HybridRuntimeError && error.code === "CANCELLED" ? "cancelled" : "failed");
      throw error;
    } finally {
      this.active.delete(task.task_id);
      parentSignal?.removeEventListener("abort", cancelFromParent);
    }
  }
}
