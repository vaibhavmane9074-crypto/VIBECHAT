/* VIBECHAT realtime client — Socket.IO with the session cookie forwarded. */
import { io } from 'socket.io-client';
export let socket = null;
export function connect() {
  if (socket?.connected) return socket;
  socket = io({ withCredentials: true, transports: ['websocket', 'polling'] });
  return socket;
}
export function disconnect() { socket?.disconnect(); socket = null; }
export const on = (ev, fn) => { socket?.on(ev, fn); return () => socket?.off(ev, fn); };
export const emit = (ev, data) => socket?.emit(ev, data);
