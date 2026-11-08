/* Settings: grouped list (Telegram/WhatsApp style). Root lists sections; each row opens a sub-page with a back button. */
import React, { useEffect, useRef, useState } from 'react';
import { api, uploadFile } from '../lib/api.js';
import { useApp, shade } from '../state/store.jsx';

const ACCENTS = ['#3390ec', '#7c5cff', '#ff5ca8', '#0ea5e9', '#34d399', '#f59e0b', '#ef4444', '#14b8a6'];

function Row({ icon, label, value, onClick, danger }) {
  return (
    <button className={`set-row ${danger ? 'danger' : ''}`} onClick={onClick}>
      <span className="set-ico">{icon}</span>
      <span className="set-lab">{label}</span>
      {value ? <span className="set-val">{value}</span> : null}
      <span className="set-chev">›</span>
    </button>
  );
}

function Toggle({ on, onChange }) {
  return <button className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} aria-pressed={!!on} />;
}

function SubHead({ title, onBack }) {
  return (
    <div className="set-subhead">
      <button className="circ" onClick={onBack} aria-label="Back">‹</button>
      <span>{title}</span>
    </div>
  );
}

export default function SettingsView() {
  const { user, setUser, toast, theme, setTheme, accent, setAccent } = useApp();
  const [page, setPage] = useState('root');
  const [f, setF] = useState({ displayName: user.displayName, bio: user.bio, statusEmoji: user.statusEmoji, statusText: user.statusText, accent: user.accent });
  const [priv, setPriv] = useState({ privDM: 'everyone', privLastSeen: 'everyone', privOnline: 'everyone', privStory: 'contacts', privProfile: 'everyone', readReceipts: true });
  const [notif, setNotif] = useState({ settingsLive: { appearance: {}, extra: {} }, dm: true, groups: true, snaps: true, stories: true, calls: true, sounds: true });
  const [blocked, setBlocked] = useState([]);
  const [devices, setDevices] = useState([]);
  const fi = useRef(null);

  useEffect(() => {
    api('GET', '/api/users/me/privacy', undefined, { fresh: true }).then((d) => setPriv(d.privacy)).catch(() => {});
    api('GET', '/api/settings', undefined, { fresh: true }).then((d) => {
      const stored = (() => { try { return JSON.parse(d.settings?.notifications || '{}'); } catch { return {}; } })();
      setNotif((n) => ({
        ...n,
        settingsLive: d.settings || { appearance: {}, extra: {} },
        dm: stored.dm ?? true, groups: stored.groups ?? true, snaps: stored.snaps ?? true,
        stories: stored.stories ?? true, calls: stored.calls ?? true, sounds: stored.sounds ?? true,
      }));
    }).catch(() => {});
    api('GET', '/api/users/blocked', undefined, { fresh: true }).then((d) => setBlocked(d.blocked)).catch(() => {});
    api('GET', '/api/users/devices', undefined, { fresh: true }).then((d) => setDevices(d.devices)).catch(() => {});
  }, []);

  const saveProfile = async () => {
    try { const d = await api('POST', '/api/auth/me', f); setUser(d.user); toast('Profile saved ✓'); }
    catch (e) { toast(e.message, 'warn'); }
  };
  const savePriv = async (k, v) => {
    setPriv({ ...priv, [k]: v });
    try {
      const d = await api('PATCH', '/api/users/me/privacy', { [k]: k === 'readReceipts' ? (v ? 1 : 0) : v });
      setUser(d.user || user);
    } catch (e) { toast(e.message, 'warn'); }
  };
  const saveNotif = async (k, v) => {
    setNotif({ ...notif, [k]: v });
    try {
      await api('PUT', '/api/settings', {
        notifications: { dm: notif.dm, groups: notif.groups, snaps: notif.snaps, stories: notif.stories, calls: notif.calls, sounds: notif.sounds, [k]: v },
        appearance: notif.settingsLive?.appearance || {},
        extra: notif.settingsLive?.extra || {},
      });
    } catch (e) { toast(e.message, 'warn'); }
  };
  const changePw = async () => {
    const current = window.prompt('Current password?'); if (!current) return;
    const to = window.prompt('New password (8+ chars, letter+number)?'); if (!to) return;
    try { await api('POST', '/api/users/me/password', { current, to }); toast('Password changed ✓'); }
    catch (e) { toast(e.message, 'warn'); }
  };
  const logout = async () => {
    try { await api('POST', '/api/auth/logout'); } catch {}
    window.location.reload();
  };
  const deleteAccount = async () => {
    if (!window.confirm('Delete your account forever? This removes your profile, chats you created, snaps and media. It cannot be undone.')) return;
    const pw = window.prompt('Confirm your password:');
    if (!pw) return;
    try { await api('POST', '/api/users/me/delete', { password: pw }); window.location.reload(); }
    catch (e) { toast(e.message, 'warn'); }
  };

  const back = () => setPage('root');
  const PRIV_OPTS = [['privDM', 'Who can message me'], ['privLastSeen', 'Last seen'], ['privOnline', 'Online status'], ['privStory', 'My stories'], ['privProfile', 'My bio']];
  const NOTIF_OPTS = [['dm', 'Direct messages'], ['groups', 'Groups'], ['snaps', 'Snaps'], ['stories', 'Stories'], ['calls', 'Calls'], ['sounds', 'In-app sounds']];

  if (page === 'profile') return (
    <div className="set-page">
      <SubHead title="Edit profile" onBack={back} />
      <div className="set-card">
        <button className="set-avatar-btn" onClick={() => fi.current?.click()} title="Change photo">
          <img className="avatar" width={72} height={72} src={user.avatar} alt="" />
        </button>
        <input ref={fi} type="file" accept="image/*" hidden onChange={async (e) => {
          const file = e.target.files?.[0]; if (!file) return;
          try {
            const up = await uploadFile(file);
            const d = await api('POST', '/api/users/me/image', { fileId: up.id });
            setUser(d.user); toast('Photo updated ✓');
          } catch (er) { toast(er.message, 'warn'); }
        }} />
        <div className="set-who">
          <div className="set-name">@{user.username}</div>
          <div className="set-sub">{user.email}</div>
        </div>
      </div>
      <div className="set-form">
        <label className="set-label">Name</label>
        <input className="field" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} />
        <label className="set-label">Bio</label>
        <textarea className="field" rows={2} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} />
        <div className="set-two">
          <div>
            <label className="set-label">Status emoji</label>
            <input className="field" value={f.statusEmoji} onChange={(e) => setF({ ...f, statusEmoji: e.target.value.slice(0, 2) })} placeholder="🎧" />
          </div>
          <div style={{ flex: 2 }}>
            <label className="set-label">Status</label>
            <input className="field" value={f.statusText} onChange={(e) => setF({ ...f, statusText: e.target.value })} placeholder="Available" />
          </div>
        </div>
        <button className="btn primary wide" onClick={saveProfile}>Save</button>
      </div>
    </div>
  );

  if (page === 'privacy') return (
    <div className="set-page">
      <SubHead title="Privacy" onBack={back} />
      <div className="set-group">
        {PRIV_OPTS.map(([k, label]) => (
          <div key={k} className="set-row static">
            <span className="set-lab">{label}</span>
            <select className="set-select" value={priv[k]} onChange={(e) => savePriv(k, e.target.value)}>
              <option value="everyone">Everyone</option>
              <option value="contacts">My contacts</option>
              <option value="nobody">Nobody</option>
            </select>
          </div>
        ))}
        <div className="set-row static">
          <span className="set-lab">Read receipts</span>
          <Toggle on={priv.readReceipts} onChange={(v) => savePriv('readReceipts', v)} />
        </div>
      </div>
    </div>
  );

  if (page === 'notifications') return (
    <div className="set-page">
      <SubHead title="Notifications" onBack={back} />
      <div className="set-group">
        {NOTIF_OPTS.map(([k, label]) => (
          <div key={k} className="set-row static">
            <span className="set-lab">{label}</span>
            <Toggle on={notif[k]} onChange={(v) => saveNotif(k, v)} />
          </div>
        ))}
      </div>
    </div>
  );

  if (page === 'devices') return (
    <div className="set-page">
      <SubHead title="Active devices" onBack={back} />
      {!devices.length && <div className="set-empty">No other active sessions. This device is always trusted.</div>}
      <div className="set-group">
        {devices.map((d) => (
          <div key={d.id} className="set-row static">
            <span className="set-ico">📱</span>
            <div className="set-who">
              <div className="set-lab">{d.device || 'Web session'}</div>
              <div className="set-sub">Last active {d.lastSeen ? new Date(d.lastSeen).toLocaleString() : 'recently'}</div>
            </div>
            <button className="set-link danger" onClick={async () => {
              try { await api('DELETE', `/api/users/devices/${d.id}`); setDevices((ds) => ds.filter((x) => x.id !== d.id)); toast('Session ended'); }
              catch (e) { toast(e.message, 'warn'); }
            }}>End</button>
          </div>
        ))}
      </div>
    </div>
  );

  if (page === 'blocked') return (
    <div className="set-page">
      <SubHead title="Blocked users" onBack={back} />
      {!blocked.length && <div className="set-empty">You have not blocked anyone.</div>}
      <div className="set-group">
        {blocked.map((b) => (
          <div key={b.id} className="set-row static">
            <img className="avatar" width={36} height={36} src={b.user?.avatar || ''} alt="" />
            <span className="set-lab">{b.user?.displayName || b.user?.username || 'User'}</span>
            <button className="set-link" onClick={async () => {
              await api('POST', '/api/users/unblock', { userId: b.id });
              setBlocked((bs) => bs.filter((x) => x.id !== b.id));
            }}>Unblock</button>
          </div>
        ))}
      </div>
    </div>
  );

  if (page === 'appearance') return (
    <div className="set-page">
      <SubHead title="Appearance" onBack={back} />
      <div className="set-group">
        {[['light', '☀️', 'Light'], ['dark', '🌙', 'Dark']].map(([t, ico, label]) => (
          <button key={t} className="set-row" onClick={() => setTheme(t)}>
            <span className="set-ico">{ico}</span>
            <span className="set-lab">{label}</span>
            {theme === t ? <span className="set-check">✓</span> : null}
          </button>
        ))}
      </div>
      <div className="set-label" style={{ padding: '14px 16px 6px' }}>Accent color</div>
      <div className="set-swatches">
        {ACCENTS.map((c) => (
          <button key={c} className={`set-swatch ${accent === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setAccent(c)} aria-label={c} />
        ))}
        <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} className="set-picker" title="Custom color" />
      </div>
      <div className="set-label" style={{ padding: '14px 16px 6px' }}>Preview</div>
      <div className="set-preview">
        <div className="set-bubble" style={{ background: `linear-gradient(135deg, ${accent}, ${shade(accent, 20)})` }}>Hello! This is how your messages look.</div>
      </div>
    </div>
  );

  return (
    <div className="set-page">
      <button className="set-profile" onClick={() => setPage('profile')}>
        <img className="avatar" width={58} height={58} src={user.avatar} alt="" />
        <div className="set-who">
          <div className="set-name">{user.displayName || user.username}</div>
          <div className="set-sub">@{user.username}{user.statusText ? ` · ${user.statusEmoji || ''} ${user.statusText}` : ''}</div>
        </div>
        <span className="set-chev">›</span>
      </button>

      <div className="set-sec">Account</div>
      <div className="set-group">
        <Row icon="✏️" label="Edit profile" onClick={() => setPage('profile')} />
        <Row icon="🔑" label="Change password" onClick={changePw} />
        <Row icon="📱" label="Active devices" onClick={() => setPage('devices')} />
      </div>

      <div className="set-sec">Preferences</div>
      <div className="set-group">
        <Row icon="🔔" label="Notifications" onClick={() => setPage('notifications')} />
        <Row icon="🔒" label="Privacy" onClick={() => setPage('privacy')} />
        <Row icon="🎨" label="Appearance" value={theme === 'dark' ? 'Dark' : 'Light'} onClick={() => setPage('appearance')} />
        <Row icon="⛔" label="Blocked users" value={blocked.length ? String(blocked.length) : ''} onClick={() => setPage('blocked')} />
      </div>

      <div className="set-sec">Session</div>
      <div className="set-group">
        <Row icon="🚪" label="Log out" onClick={logout} />
        <Row icon="🗑" label="Delete account" danger onClick={deleteAccount} />
      </div>

      <div className="set-foot">VIBECHAT · {user.email}</div>
    </div>
  );
}
