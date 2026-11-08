/* Self profile mini + profile card modal + QR share. */
import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api, uploadFile } from '../lib/api.js';
import { useApp } from '../state/store.jsx';

export function ProfileMini({ user }) {
  const [card, setCard] = useState(false);
  const me = user || {};
  return (
    <>
      <button className="me-card" onClick={() => setCard(true)} title="My profile">
        <img className="avatar" width={38} height={38} src={me.avatar || '/api/users/x/avatar.svg'} alt="" />
        <div style={{ minWidth: 0, textAlign: 'left' }}>
          <div style={{ fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{me.displayName || '…'}</div>
          <div className="dim" style={{ fontSize: 11 }}>@{me.username || ''}</div>
        </div>
      </button>
      {card && <SelfCard me={me} onClose={() => setCard(false)} />}
    </>
  );
}

function SelfCard({ me, onClose }) {
  const { user, setUser, toast } = useApp();
  const [qr, setQr] = useState('');
  const ref = React.useRef();
  useEffect(() => {
    QRCode.toDataURL(`vibechat:user:${me.id}`, { width: 210, color: { dark: '#0b0b14', light: '#ffffff' } }).then(setQr).catch(() => {});
  }, [me.id]);
  return (
    <div className="modal-veil" onClick={onClose}>
      <div className="modal-card pop" onClick={(e) => e.stopPropagation()}>
        <div className="row"><h3 style={{ margin: 0 }}>My profile</h3><div className="spacer" /><button className="btn ghost icon-sm" onClick={onClose}>✕</button></div>
        <div className="row" style={{ gap: 14, margin: '12px 0' }}>
          <button className="btn" style={{ padding: 3 }} onClick={() => ref.current?.click()} title="Change avatar">
            <img className="avatar" width={62} height={62} src={me.avatar || ''} alt="" />
          </button>
          <input ref={ref} type="file" accept="image/*" hidden onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return;
            try { const up = await uploadFile(f); const d = await api('POST', '/api/users/me/image', { fileId: up.id }); setUser(d.user || user); toast('Avatar updated ✓'); }
            catch (er) { toast(er.message, 'warn'); }
          }} />
          <div>
            <div style={{ fontWeight: 700 }}>{me.displayName}</div>
            <div className="dim" style={{ fontSize: 12 }}>@{me.username}</div>
            {me.role === 'admin' && <span className="chip acc">admin</span>}
          </div>
        </div>
        <div style={{ display: 'grid', placeItems: 'center' }}>
          {qr ? <img src={qr} width={210} alt="QR" /> : <div className="spinner" />}
          <div className="dim" style={{ fontSize: 11, marginTop: 6 }}>share your QR so friends can add you</div>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => window.__vcShareProfile?.()}>↗ Share profile</button>
          <div className="spacer" />
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export function QrModal({ me, onClose }) {
  const { toast } = useApp();
  const [qr, setQr] = useState('');
  useEffect(() => {
    QRCode.toDataURL(`vibechat:user:${me?.id}`, { width: 210, color: { dark: '#0b0b14', light: '#ffffff' } }).then(setQr).catch(() => {});
  }, [me?.id]);
  return (
    <div className="modal-veil" onClick={onClose}>
      <div className="modal-card pop" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: 0 }}>My profile QR</h3>
        <div style={{ display: 'grid', placeItems: 'center', padding: 10 }}>{qr ? <img src={qr} width={210} alt="" /> : <div className="spinner" />}</div>
        <div className="row">
          <button className="btn" onClick={() => { navigator.clipboard?.writeText(`@${me.username}`); toast('Username copied'); }}>Copy @username</button>
          <div className="spacer" /><button className="btn ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
