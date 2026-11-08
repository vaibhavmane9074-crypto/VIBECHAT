/* VIBECHAT logo set (original identity: spark-wave "V" mark + wordmark). */
import React from 'react';

export function VibeMark({ size = 28 }) {
  const id = 'vg' + Math.round(Math.random() * 1e6);
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-label="VIBECHAT">
      <defs>
        <linearGradient id={id} x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7c5cff" /><stop offset="1" stopColor="#ff5ca8" />
        </linearGradient>
      </defs>
      <rect x="2.5" y="2.5" width="43" height="43" rx="13" stroke={`url(#${id})`} strokeWidth="3" fill="rgba(124,92,255,0.08)" />
      <path d="M12 15l8.2 18c.5 1.06 2 1.03 2.44-.05L30 15" stroke={`url(#${id})`} strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="35" cy="32" r="4.6" stroke={`url(#${id})`} strokeWidth="3" />
    </svg>
  );
}

export function VibeLogo({ size = 24 }) {
  return (
    <div className="row" style={{ gap: 8 }}>
      <VibeMark size={size} />
    </div>
  );
}
