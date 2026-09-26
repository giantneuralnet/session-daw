import { analyzeSound, renderSound, trimSound } from "./resynthesis";
self.onmessage = ({ data }) => {
  try {
    if (data.samples) {
      const samples = trimSound(data.samples);
      self.postMessage(
        { model: analyzeSound(samples), samples },
        { transfer: [samples.buffer] },
      );
    } else {
      const samples = renderSound(data.model);
      self.postMessage({ samples }, { transfer: [samples.buffer] });
    }
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error
          ? error.message
          : "Could not reconstruct this sound.",
    });
  }
};
