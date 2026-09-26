export function parseBpm(text: string): number | null {
  const input = text.trim();
  if (!/^\d+(\.\d+)?$/.test(input)) return null;
  const value = Number(input);
  return Number.isFinite(value) && value >= 40 && value <= 240 ? value : null;
}
export function stepBpm(text: string, current: number, delta: number): string {
  const number = /^\d+(\.\d+)?$/.test(text.trim()) ? Number(text) : current;
  const base = Number.isFinite(number) ? number : current;
  return String(
    Math.round(Math.min(240, Math.max(40, base + delta)) * 100) / 100,
  );
}
export const noteShortcuts = [
  ["C2", 36],
  ["C3", 48],
  ["C4", 60],
  ["D4", 62],
  ["E4", 64],
  ["F4", 65],
  ["G4", 67],
  ["A4", 69],
  ["B4", 71],
  ["C5", 72],
].map(([name, midi]) => ({
  name: String(name),
  frequency:
    Math.round(440 * Math.pow(2, (Number(midi) - 69) / 12) * 100) / 100,
}));
