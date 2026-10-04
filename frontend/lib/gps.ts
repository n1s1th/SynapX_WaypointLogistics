/**
 * How to describe a browser location fix. A laptop without a GPS chip gets a
 * rough fix from its network (often km off), so only call it GPS when the
 * browser reports a tight accuracy.
 */
export const GPS_ACCURACY_M = 100;

export function gpsLabel(accuracy: number) {
  if (accuracy <= GPS_ACCURACY_M) return `📍 GPS Active (±${Math.round(accuracy)} m)`;
  return accuracy < 1000
    ? `≈ Approximate location (±${Math.round(accuracy)} m)`
    : `≈ Approximate location (±${(accuracy / 1000).toFixed(1)} km)`;
}
