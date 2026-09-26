type ShareApi = {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
};
export async function shareAudio(
  blob: Blob,
  name: string,
  api: ShareApi,
): Promise<"shared" | "unsupported" | "cancelled"> {
  const file = new File([blob], name, { type: "audio/mpeg" });
  if (!api.share || !api.canShare?.({ files: [file] })) return "unsupported";
  try {
    await api.share({ files: [file], title: name.replace(/\.mp3$/i, "") });
    return "shared";
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      return "cancelled";
    throw error;
  }
}
