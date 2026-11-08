/* Lightbox media viewer. */
import React from 'react';

export default function MediaViewer({ src, onClose }) {
  const url = typeof src === 'string' ? src : src.url || src.src;
  const dl = typeof src === 'object' ? src.downloadUrl : null;
  const name = typeof src === 'object' ? src.name : null;
  return (
    <div className="media-veil" onClick={onClose}>
      <div className="col fades" style={{ alignItems: 'center', gap: 10 }} onClick={(e) => e.stopPropagation()}>
        <img src={url} alt="" />
        <div className="row" style={{ gap: 10 }}>
          {name && <span className="chip" style={{ color: '#fff' }}>{name}</span>}
          {dl && <a className="btn" download href={dl}>⬇ Download</a>}
          <button className="btn ghost" style={{ color: '#fff' }} onClick={onClose}>✕</button>
        </div>
      </div>
    </div>
  );
}
