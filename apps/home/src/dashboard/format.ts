/** Tailles de fichiers en français (unités du système international). */

const KILO = 1024;

export function formatBytes(size: number): string {
  if (size < KILO) return `${size} o`;
  if (size < KILO * KILO) return `${(size / KILO).toFixed(1)} Ko`;
  if (size < KILO * KILO * KILO) return `${(size / (KILO * KILO)).toFixed(1)} Mo`;
  return `${(size / (KILO * KILO * KILO)).toFixed(2)} Go`;
}
