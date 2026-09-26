import type { Project } from "./session.ts";

export function sessionFile(project: Project, input: string) {
  const name =
    input
      .trim()
      .replace(/\.json$/i, "")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
      .slice(0, 80)
      .replace(/[. ]+$/, "") || "Session";
  const saved = { ...project, name };
  const blob = new Blob([JSON.stringify(saved, null, 2)], {
    type: "application/json",
  });
  return { name, filename: `${name}.json`, blob };
}

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} bytes`;
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
