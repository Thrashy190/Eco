// The logo, drawn here rather than loaded as a picture so its mark can follow the accent colour. Keep it the same drawing
// as web/public/icon.svg, which is what browsers and home screens show and cannot change colour.
const BARS: [number, number, number][] = [
  [94, 175, 163], [136, 125, 263], [178, 101, 86], [178, 229, 55], [178, 326, 86], [220, 90, 75], [220, 229, 55], [220, 348, 75],
  [262, 90, 75], [262, 229, 55], [262, 348, 75], [304, 101, 86], [304, 229, 55], [304, 326, 86], [346, 125, 159], [346, 351, 37], [388, 175, 109],
];

export const Logo = ({ size, className }: { size: number; className?: string }) => (
  <svg viewBox="0 0 512 512" width={size} height={size} className={className} aria-hidden="true">
    <rect width="512" height="512" rx="112" fill="#101116" />
    <g className="fill-accent transition-[fill] duration-700">
      {BARS.map(([x, y, height]) => <rect key={`${x}-${y}`} x={x} y={y} width="30" height={height} rx="15" />)}
    </g>
  </svg>
);
