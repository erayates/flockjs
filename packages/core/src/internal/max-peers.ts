export function normalizeMaxPeers(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  if (!Number.isInteger(value) || value < 1) {
    return undefined;
  }

  return value;
}
