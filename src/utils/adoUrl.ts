const WORK_ITEM_ID_FROM_URL = /\/workItems\/(\d+)(?:[/?#]|$)/i;

export function parseWorkItemIdFromUrl(url: string): number | null {
  const m = WORK_ITEM_ID_FROM_URL.exec(url);
  if (!m) return null;
  const id = parseInt(m[1], 10);
  return Number.isFinite(id) ? id : null;
}
