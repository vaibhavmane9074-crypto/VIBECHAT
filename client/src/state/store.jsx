/* VIBECHAT app store — auth/session state, realtime wiring, toasts, drafts, one shared context. */
import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { api, invalidate } from '../lib/api.js';
import { connect, disconnect, socket, on } from '../lib/rt.js';

const C = createContext();
export const useApp = () => useContext(C);

const LS = {
  theme: 'vc_theme', accent: 'vc_accent', drafts: 'vc_drafts', wallpaper: 'vc_wall',
};

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [toasts, setToasts] = useState([]);
  const [dms, setChats] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [view, setView] = useState('chats');     // sidebar view (chats/snaps/stories/contacts/groups/communities/channels/ai/calls/media/search/settings/admin)
  const [mUnread, setMUnread] = useState(0);
  const [unreadSnaps, setUnreadSnaps] = useState(0);
  const [notify, setNotify] = useState(null);    // active notification toast object
  const [theme, setTheme] = useState(() => localStorage.getItem(LS.theme) || 'light');
  const [accent, setAccent] = useState(() => localStorage.getItem(LS.accent) || '#3390ec');
  const [wallpaper, setWallpaper] = useState(() => localStorage.getItem(LS.wallpaper) || '');
  const drafts = useRef(JSON.parse(localStorage.getItem(LS.drafts) || '{}'));
  const callState = useRef(null);
  const [call, setCall] = useState(null);        // {callId, peer, type, dir, status}
  const [incomingCall, setIncomingCall] = useState(null);
  const [globalUnread] = useState(0);

  const toast = useCallback((msg, kind = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-3), { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  /* boot: fetch session */
  useEffect(() => {
    (async () => {
      try { const me = await api('GET', '/api/auth/me'); setUser(me.user); connect(); }
      catch { setUser(null); }
      setBooting(false);
    })();
  }, []);

  /* theme + accent reflection */
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-2', shade(accent, 30));
    localStorage.setItem(LS.theme, theme);
    localStorage.setItem(LS.accent, accent);
  }, [theme, accent]);

  useEffect(() => { wallpaper ? localStorage.setItem(LS.wallpaper, wallpaper) : localStorage.removeItem(LS.wallpaper); }, [wallpaper]);

  /* refresh chats & counts */
  const refreshChats = useCallback(async () => {
    try {
      const { chats } = await api('GET', '/api/chats', undefined, { fresh: true });
      setChats(chats);
      const un = chats.reduce((a, c) => a + (c.muted ? 0 : (c.unread || 0)), 0);
      setMUnread(un);
    } catch {}
  }, []);
  useEffect(() => { if (user) refreshChats(); }, [user, activeChat, refreshChats]);

  const refreshSnaps = useCallback(async () => {
    if (!user) return;
    try {
      const { incoming } = await api('GET', '/api/snaps', undefined, { fresh: true });
      setUnreadSnaps(incoming.filter((s) => !s.mine).length);
    } catch {}
  }, [user]);
  useEffect(() => { refreshSnaps(); }, [user, refreshSnaps]);

  if (typeof window !== 'undefined') window.__vcRefreshChats = refreshChats; void socket;

  return (
    <C.Provider value={{
      user, setUser, booting, chats: dms, refreshChats, activeChat, setActiveChat, setView,
      view, mUnread, unreadSnaps, refreshSnaps, toast, toasts, notify, setNotify,
      draft: (chatId) => drafts.current[chatId] || '',
      setDraft: (chatId, text) => { drafts.current[chatId] = text.slice(0, 5000); localStorage.setItem(LS.drafts, JSON.stringify(drafts.current)); },
      theme, setTheme, accent, setAccent, wallpaper, setWallpaper,
      call, setCall, incomingCall, setIncomingCall, callState, globalUnread,
      socket,
    }}>{children}</C.Provider>
  );
}

/* color utils */
export function shade(hex, deg) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mix = (c) => Math.round(c + (255 - c) * (deg / 100));
  return `#${((mix(r) << 16) | (mix(g) << 8) | mix(b)).toString(16).padStart(6, '0')}`;
}
export { invalidate };
