/// <reference lib="webworker" />

import { solveSchedule } from "../lib/schedule/solver";

type WorkerRequest = Parameters<typeof solveSchedule>[0];

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    const result = solveSchedule(event.data);
    workerScope.postMessage({ type: "result", result });
  } catch (error) {
    workerScope.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Не удалось рассчитать варианты",
    });
  }
};

export {};
