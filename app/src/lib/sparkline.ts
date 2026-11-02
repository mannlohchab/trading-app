/** Map actual observations to a small plot; do not smooth away price reversals. */
export function buildSparkline(data: number[], width: number, height: number, times?: number[]) {
  if (data.length < 2 || !Number.isFinite(width) || !Number.isFinite(height) || width <= 6 || height <= 6
    || data.some(value => !Number.isFinite(value) || value <= 0)) return null;
  if (times && (times.length !== data.length || times.some((time, i) => !Number.isFinite(time) || time <= 0 || (i > 0 && time <= times[i - 1])))) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const points = data.map((value, i) => ({ value,
    x: 3 + (times ? (times[i] - times[0]) / (times[times.length - 1] - times[0]) : i / (data.length - 1)) * (width - 6),
    y: max === min ? height / 2 : 3 + (max - value) / (max - min) * (height - 6),
  }));
  const segments = points.slice(1).map((point, i) => {
    const previous = points[i];
    const dx = point.x - previous.x, dy = point.y - previous.y;
    const length = Math.hypot(dx, dy);
    return { left: (previous.x + point.x - length) / 2, top: (previous.y + point.y) / 2 - 0.9,
      width: length, angle: Math.atan2(dy, dx) };
  });
  return { points, segments, baseline: points[0].y, last: points[points.length - 1] };
}
