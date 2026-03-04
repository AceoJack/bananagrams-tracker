export function formatDuration(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString();
}