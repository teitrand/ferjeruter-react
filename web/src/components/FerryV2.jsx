/**
 * M/F Kvernes v2 (Designer, ferje2.svg): lang og låg ferje, viewBox 96×32 (vasslinja på y = 26).
 * Inline SVG utan eigne fargar: fe-*-klassane får fargane frå CSS-variablane i styles/nowcard.css
 * (--ferry-hull, --ferry-super, --ferry-window, --ferry-outline, --ferry-mast, --ferry-red, --ferry-car), så lyst/mørkt
 * følgjer temaet appen allereie har. Dekorasjon: aria-hidden, teksten i kortet seier kvar ferja er.
 */
export function FerryV2({ className = "na-ferry-svg" }) {
  return (
    <svg className={className} viewBox="0 0 96 32" focusable="false" aria-hidden="true">
      <g className="fe-mast">
      <path d="M39.2 14.4V3.2M40.8 14.4V3.2M39.2 13.4l1.6-1.8M40.8 11.6l-1.6-1.8M39.2 9.8l1.6-1.8M40.8 8l-1.6-1.8M39.2 6.2l1.6-1.6"/>
      <path d="M38.2 3.2h3.6M40 3.2V2.2"/>
      <path d="M55.2 14.4V3.2M56.8 14.4V3.2M55.2 13.4l1.6-1.8M56.8 11.6l-1.6-1.8M55.2 9.8l1.6-1.8M56.8 8l-1.6-1.8M55.2 6.2l1.6-1.6"/>
      <path d="M54.2 3.2h3.6M56 3.2V2.2"/></g>
      <path className="fe-sup" d="M45.6 10l.5-4.6h3.8l.5 4.6z"/>
      <path className="fe-cap" d="M46.1 5.4h3.8l.1 1.2h-4z"/>
      <path className="fe-red" d="M45.95 7.4h4.1l.15 1.3h-4.4z"/>
      <g className="fe-rail">
      <path d="M3.8 18.2H32M64 18.2H92.2"/>
      <path d="M4 18.2v3.2M9.3 18.2v3.2M14.6 18.2v3.2M19.9 18.2v3.2M25.2 18.2v3.2M30.5 18.2v3.2M65.5 18.2v3.2M70.8 18.2v3.2M76.1 18.2v3.2M81.4 18.2v3.2M86.7 18.2v3.2M92 18.2v3.2"/></g>
      <path className="fe-car" d="M5.4 21.6v-1.9q0-.7.7-.7h1.2l1.3-1.8h3.3l1.5 1.8h1.2q.7 0 .7.7v1.9z"/>
      <path className="fe-cwin" d="M8.7 18.9l.85-1.2h2.8l1 1.2z"/>
      <path className="fe-car" d="M14.8 21.6v-1.9q0-.7.7-.7h1.2l1.3-1.8h3.3l1.5 1.8h1.2q.7 0 .7.7v1.9z"/>
      <path className="fe-cwin" d="M18.1 18.9l.85-1.2h2.8l1 1.2z"/>
      <path className="fe-car" d="M24.2 21.6v-1.9q0-.7.7-.7h1.2l1.3-1.8h3.3l1.5 1.8h1.2q.7 0 .7.7v1.9z"/>
      <path className="fe-cwin" d="M27.5 18.9l.85-1.2h2.8l1 1.2z"/>
      <path className="fe-car" d="M64.6 21.6v-4.5q0-.7.7-.7h6.2q.7 0 .7.7v1.1h1.5l1.1 1.4v2q0 .6-.6 .6z"/>
      <path className="fe-cwin" d="M72.5 18.4h1.2l.8 1h-2z"/>
      <path className="fe-car" d="M76.6 21.6v-1.9q0-.7.7-.7h1.2l1.3-1.8h3.3l1.5 1.8h1.2q.7 0 .7.7v1.9z"/>
      <path className="fe-cwin" d="M79.9 18.9l.85-1.2h2.8l1 1.2z"/>
      <path className="fe-car" d="M85.6 21.6v-1.9q0-.7.7-.7h1.2l1.3-1.8h3.3l1.5 1.8h1.2q.7 0 .7.7v1.9z"/>
      <path className="fe-cwin" d="M88.9 18.9l.85-1.2h2.8l1 1.2z"/>
      <rect className="fe-sup" x="33" y="14.4" width="30" height="7.6" rx="1"/>
      <rect className="fe-sup" x="42.4" y="10" width="11.2" height="4.8" rx=".8"/>
      <rect className="fe-win" x="34.60" y="16.5" width="2.1" height="2.3" rx=".4"/>
      <rect className="fe-win" x="37.70" y="16.5" width="2.1" height="2.3" rx=".4"/>
      <rect className="fe-win" x="40.80" y="16.5" width="2.1" height="2.3" rx=".4"/>
      <rect className="fe-win" x="43.90" y="16.5" width="2.1" height="2.3" rx=".4"/>
      <rect className="fe-win" x="47.00" y="16.5" width="2.1" height="2.3" rx=".4"/>
      <rect className="fe-win" x="50.10" y="16.5" width="2.1" height="2.3" rx=".4"/>
      <rect className="fe-win" x="53.20" y="16.5" width="2.1" height="2.3" rx=".4"/>
      <rect className="fe-win" x="56.30" y="16.5" width="2.1" height="2.3" rx=".4"/>
      <rect className="fe-win" x="59.40" y="16.5" width="2.1" height="2.3" rx=".4"/>
      <rect className="fe-win" x="43.80" y="11.3" width="2" height="2" rx=".35"/>
      <rect className="fe-win" x="46.40" y="11.3" width="2" height="2" rx=".35"/>
      <rect className="fe-win" x="49.00" y="11.3" width="2" height="2" rx=".35"/>
      <rect className="fe-win" x="51.60" y="11.3" width="2" height="2" rx=".35"/>
      <path className="fe-hull" d="M2.9 20.4L1 21.4v.9l2.6-.5z"/>
      <path className="fe-hull" d="M93.1 20.4L95 21.4v.9l-2.6-.5z"/>
      <path className="fe-hull" d="M2.2 20.2Q48 22 93.8 20.2L91.3 25.2Q91 26 90.2 26H5.8Q5 26 4.7 25.2Z"/>
      <path className="fe-gloss" d="M6.5 21.7Q48 23.3 89.5 21.7"/>
      <path className="fe-red" d="M4.95 24.1H91.05L90.65 25.4H5.35Z"/>
    </svg>
  );
}
