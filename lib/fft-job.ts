import {
  analyzeSound,
  renderSound,
  type Reconstruction,
} from "./resynthesis.ts";
export type FFTJob =
  { samples: Float32Array; count: number } | { model: Reconstruction };
export type FFTResult = { model: Reconstruction; samples: Float32Array };

export function computeFFT(job: FFTJob): FFTResult {
  const model =
    "samples" in job
      ? { ...analyzeSound(job.samples), count: job.count }
      : job.model;
  return { model, samples: renderSound(model) };
}

// A blocked worker can fall back locally without discarding the recording.
export function runFFT(
  job: FFTJob,
  createWorker: () => Worker,
  signal: AbortSignal,
): Promise<FFTResult> {
  return new Promise((resolve, reject) => {
    let worker: Worker | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const clean = () => {
      worker?.terminate();
      clearTimeout(timeout);
      clearTimeout(fallbackTimer);
      signal.removeEventListener("abort", abort);
    };
    const finish = (error?: Error, result?: FFTResult) => {
      if (settled) return;
      settled = true;
      clean();
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () =>
      finish(new DOMException("Analysis cancelled.", "AbortError"));
    const fallback = () => {
      if (settled || fallbackTimer) return;
      worker?.terminate();
      clearTimeout(timeout);
      fallbackTimer = setTimeout(() => {
        if (signal.aborted) {
          abort();
          return;
        }
        try {
          finish(undefined, computeFFT(job));
        } catch (error) {
          finish(
            error instanceof Error
              ? error
              : Error("Could not reconstruct this selection."),
          );
        }
      }, 0);
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    try {
      worker = createWorker();
      worker.onmessage = ({ data }) =>
        data.error ? finish(Error(data.error)) : finish(undefined, data);
      worker.onerror = (event) => {
        event.preventDefault?.();
        fallback();
      };
      worker.onmessageerror = fallback;
      timeout = setTimeout(fallback, 5000);
      worker.postMessage(job);
    } catch {
      fallback();
    }
  });
}
