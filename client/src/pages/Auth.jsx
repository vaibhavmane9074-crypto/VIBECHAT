/* VIBECHAT auth — login / register / verify / forgot / reset. Google button real when configured. */
import React, { useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { useApp } from '../state/store.jsx';
import { connect } from '../lib/rt.js';
import { VibeMark } from '../components/logos.jsx';

export default function Auth() {
  const { setUser, toast } = useApp();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ identifier: '', password: '', email: '', username: '', displayName: '', newPassword: '', code: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [needVerify, setNeedVerify] = useState(false);
  const [googleUrl, setGoogleUrl] = useState(null);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const go = async (e) => {
    e?.preventDefault?.();
    setErr(''); setBusy(true);
    try {
      if (mode === 'login') {
        const d = await api('POST', '/api/auth/login', { identifier: form.identifier, password: form.password, device: navigator.userAgent.slice(0, 60) });
        setUser(d.user); connect(); window.__vcGoHome?.(); window.location.hash = '';
        toast(`Welcome back, ${d.user.displayName}!`);
      }
      if (mode === 'register') {
        const d = await api('POST', '/api/auth/register', { email: form.email, username: form.username, password: form.password, displayName: form.displayName || form.username, device: navigator.userAgent.slice(0, 60) });
        setUser(d.user); connect();
        if (d.needsVerification && d.devCode) { setNeedVerify(true); toast(`Verification code: ${d.devCode} (dev mode)`, 'info'); }
        else toast('Account created');
      }
      if (mode === 'forgot') {
        await api('POST', '/api/auth/password/reset-request', { email: form.email });
        toast('If that email exists, a reset code was sent (dev code in server console)');
        setMode('reset');
      }
      if (mode === 'reset') {
        await api('POST', '/api/auth/password/reset', { code: form.code, password: form.newPassword });
        toast('Password reset. Log in with the new password.');
        setMode('login');
      }
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  };

  const verify = async () => {
    setErr('');
    try { await api('POST', '/api/auth/verify-email', { code: form.code }); toast('Email verified ✓'); setNeedVerify(false); }
    catch (e) { setErr(e.message); }
  };

  const google = async () => {
    try { const d = await api('GET', '/api/auth/google/url'); window.location.href = d.url; }
    catch (e) { setErr(e.message); }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card glass pop">
        <div className="row" style={{ gap: 14, marginBottom: 8 }}>
          <VibeMark size={46} />
          <div>
            <h1 style={{ margin: 0, letterSpacing: '0.18em', fontSize: 22 }}>VIBECHAT</h1>
            <div className="dim" style={{ fontSize: 11, letterSpacing: '0.3em' }}>BEYOND MESSAGING</div>
          </div>
        </div>

        {needVerify ? (
          <form onSubmit={(e) => { e.preventDefault(); verify(); }}>
            <label className="small">Verification code (from the server console in dev mode)</label>
            <input className="field" value={form.code} onChange={set('code')} placeholder="6-hex code" autoFocus />
            <button className="btn primary wide" disabled={busy || !form.code} style={{ marginTop: 12 }}>Verify</button>
            <button type="button" className="btn ghost wide" onClick={() => setNeedVerify(false)}>Skip for now</button>
          </form>
        ) : (
          <form onSubmit={go}>
            {mode === 'login' && (<>
              <label className="small">Email or username</label>
              <input className="field" value={form.identifier} onChange={set('identifier')} placeholder="you@chat.app" autoFocus />
              <label className="small">Password</label>
              <input className="field" type="password" value={form.password} onChange={set('password')} placeholder="••••••••" />
            </>)}
            {mode === 'register' && (<>
              <label className="small">Email</label>
              <input className="field" value={form.email} onChange={set('email')} placeholder="you@chat.app" autoFocus />
              <label className="small">Username</label>
              <input className="field" value={form.username} onChange={set('username')} placeholder="lowcase/underscore" />
              <label className="small">Display name</label>
              <input className="field" value={form.displayName} onChange={set('displayName')} placeholder="What friends see" />
              <label className="small">Password (8+ chars, letter + number)</label>
              <input className="field" type="password" value={form.password} onChange={set('password')} placeholder="••••••••" />
            </>)}
            {mode === 'forgot' && (<>
              <label className="small">Account email</label>
              <input className="field" value={form.email} onChange={set('email')} placeholder="you@chat.app" autoFocus />
            </>)}
            {mode === 'reset' && (<>
              <label className="small">Reset code</label>
              <input className="field" value={form.code} onChange={set('code')} autoFocus />
              <label className="small">New password</label>
              <input className="field" type="password" value={form.newPassword} onChange={set('newPassword')} />
            </>)}
            {err && <div className="error-banner" style={{ marginTop: 10 }}>{err}</div>}
            <button className="btn primary wide" disabled={busy} style={{ marginTop: 14 }}>
              {busy ? '…' : mode === 'login' ? 'Log in' : mode === 'register' ? 'Create account' : mode === 'forgot' ? 'Send reset code' : 'Reset password'}
            </button>
          </form>
        )}

        {mode === 'login' && (<>
          <button className="btn wide" style={{ marginTop: 10 }} onClick={google}>
            <span style={{ fontWeight: 800, color: '#4285F4' }}>G</span> Continue with Google
          </button>
        </>)}

        <div className="hairline" />
        <div className="row" style={{ justifyContent: 'space-between', fontSize: 12 }}>
          {mode === 'login' ? (
            <><a onClick={() => { setMode('register'); setErr(''); }} className="link">Create account</a><a onClick={() => { setMode('forgot'); setErr(''); }} className="link">Forgot password?</a></>
          ) : (<a onClick={() => { setMode('login'); setErr(''); }} className="link">← Back to login</a>)}
        </div>
      </div>
      <div className="auth-glow" />
    </div>
  );
}
