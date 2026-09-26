import { computeFFT } from "./fft-job";
self.onmessage = ({ data }) => {
  try {
    const result = computeFFT(data);
    self.postMessage(result, { transfer: [result.samples.buffer] });
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error
          ? error.message
          : "Could not reconstruct this selection.",
    });
  }
};
