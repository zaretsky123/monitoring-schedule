/// <reference lib="webworker" />

import { solveSchedule } from "../lib/schedule/solver";
import { generateSchedule } from "../lib/schedule/generator";

type WorkerRequest =
  | ({ action?: "rearrange" } & Parameters<typeof solveSchedule>[0])
  | ({ action: "generate" } & Parameters<typeof generateSchedule>[0]);

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    const result = event.data.action === "generate" ? generateSchedule(event.data) : solveSchedule(event.data);
    workerScope.postMessage({ type: "result", result });
  } catch (error) {
    workerScope.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Не удалось рассчитать варианты",
    });
  }
};

export {};
