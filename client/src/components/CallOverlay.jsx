/* VIBECHAT call layer — WebRTC 1:1 audio/video with Socket.IO signaling, mute/cam/screen-share/end. */
import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/store.jsx';
import { on, emit } from '../lib/rt.js';

const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };

export default function CallOverlay() {
  const { user, toast } = useApp();
  const [overlay, setOverlay] = useState(null);
  // overlay = { callId|null, peerId, peerName, type, dir, status: 'ringing'|'outgoing'|'active'|'connecting' }
  const pcRef = useRef(null);
  const localStream = useRef(null);
  const localRef = useRef(null);
  const remoteRef = useRef(null);
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [secs, setSecs] = useState(0);
  const sharingTrack = useRef(null);
  const callIdRef = useRef(null);
  /* events that belong to an older call must not change the current call */
  const isStale = (id) => !!id && ((!!callIdRef.current && id !== callIdRef.current) || id === lastEndedRef.current);
  const peerRef = useRef(null);
  const offerReady = useRef(false);
  const pendingIce = useRef([]);
  const acceptedRef = useRef(false);
  const iceRef = useRef(null);
  const cameraTrackRef = useRef(null);
  const lastEndedRef = useRef(null);
  const pendingOfferRef = useRef(null);
  const [peerMedia, setPeerMedia] = useState({ mic: true, cam: true });

  /* keyboard-free entry point used by chat header */
  useEffect(() => {
    window.__vcInitCall = (peerId, type) => startCall(peerId, type, loginUser());
    function loginUser() { return user; }
  }, [user]);

  /* apply ICE candidates once the remote description is set */
  const flushIce = () => {
    const pc = pcRef.current;
    while (pc && pc.remoteDescription && pendingIce.current.length) {
      pc.addIceCandidate(pendingIce.current.shift()).catch((e) => console.warn('ICE candidate rejected', e));
    }
  };

  /* caller: send the offer only after the server has assigned a callId */
  async function sendOffer() {
    const pc = pcRef.current;
    if (!pc || !callIdRef.current || !offerReady.current) return;
    offerReady.current = false;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      emit('call:signal', { callId: callIdRef.current, to: peerRef.current, data: { type: 'offer', sdp: pc.localDescription } });
    } catch { toast('Offer failed', 'warn'); }
  }

  /* apply a remote offer and answer it; only called after the user accepted the call */
  async function handleOffer(callId, from, sdp) {
    callIdRef.current = callId;
    setOverlay((cur) => (cur ? { ...cur, callId, peerId: from, status: cur.status === 'outgoing' ? 'connecting' : cur.status } : { callId, peerId: from, peerName: from, type: 'audio', dir: 'in', status: 'connecting' }));
    if (!pcRef.current) await wirePC(callId, from, false);
    try { await pcRef.current?.setRemoteDescription(new RTCSessionDescription(sdp)); } catch {}
    flushIce();
    try {
      const ans = await pcRef.current?.createAnswer();
      await pcRef.current?.setLocalDescription(ans);
      emit('call:signal', { callId, to: from, data: { type: 'answer', sdp: pcRef.current?.localDescription } });
    } catch (e) { toast('Answer failed: ' + e.message, 'warn'); cleanupAll(); }
  }

  /* realtime signaling */
  useEffect(() => {
    if (!user) return;
    const o1 = on('call:incoming', async ({ callId, from, type, fromName }) => {
      setOverlay((cur) => cur || { callId, peerId: from, peerName: fromName || from, type: type || 'audio', dir: 'in', status: 'ringing' });
      window.__vcRing?.(true);
    });
    const o2 = on('call:signal', ({ callId, from, data }) => {
      if (isStale(callId)) return;
      (async () => {
        const pc = pcRef.current;
        if (data?.type === 'offer') {
          if (!acceptedRef.current) { pendingOfferRef.current = { callId, from, sdp: data.sdp }; return; }
          await handleOffer(callId, from, data.sdp);
        } else if (data?.type === 'answer') {
          try { await pcRef.current?.setRemoteDescription(new RTCSessionDescription(data.sdp)); } catch {}
          flushIce();
        } else if (data?.type === 'ice' && data.candidate) {
          try { await pcRef.current?.addIceCandidate(data.candidate); } catch (e) { console.warn('ICE candidate rejected', e); }
        }
      })();
    });
    const o3 = on('call:accepted', ({ callId }) => isStale(callId) ? null : setOverlay((cur) => (cur ? { ...cur, callId, status: 'connecting' } : cur)));
    const o4 = on('call:declined', () => { toast('Call declined'); cleanupAll(); });
    const o5 = on('call:ended', ({ callId }) => { if (!isStale(callId)) cleanupAll(); });
    const o6 = on('call:state', ({ callId, status }) => {
      if (isStale(callId)) return;
      if (['missed', 'declined', 'ended', 'failed'].includes(status)) { if (status === 'missed') toast('Call not answered', 'warn'); cleanupAll(); }
    });
    const o7 = on('call:ringing', ({ callId }) => {
      if (!callId) return;
      callIdRef.current = callId;
      setOverlay((cur) => (cur ? { ...cur, callId } : cur));
      sendOffer();
    });
    const o8 = on('call:ice', ({ callId, candidate }) => {
      if (!candidate || isStale(callId)) return;
      const pc = pcRef.current;
      if (pc && pc.remoteDescription) pc.addIceCandidate(candidate).catch((e) => console.warn('ICE candidate rejected', e));
      else pendingIce.current.push(candidate);
    });
    const o9 = on('call:media-state', ({ callId, state }) => isStale(callId) ? null : setPeerMedia({ mic: state?.mic !== false, cam: state?.cam !== false }));
    return () => [o1, o2, o3, o4, o5, o6, o7, o8, o9].forEach((o) => o?.());
  }, [user]);

  /* call duration ticking */
  useEffect(() => {
    if (overlay?.status !== 'active') return;
    const iv = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(iv);
  }, [overlay?.status]);

  useEffect(() => () => cleanupAll(), []);

  async function startCall(peerId, type) {
    if (overlay) return toast('Already in a call', 'warn');
    try {
      localStream.current = await navigator.mediaDevices.getUserMedia(type === 'video' ? { audio: true, video: { width: 1280 } } : { audio: true });
    } catch (e) { return toast(`Media unavailable: ${e.message}`, 'warn'); }
    setOverlay({ callId: null, peerId, peerName: peerId, type, dir: 'out', status: 'outgoing' });
    emit('call:ring', { peerId, type });
    iceRef.current = await loadIce();
    wirePC(null, peerId, true);
    attachLocal();
    setTimeout(() => setOverlay((cur) => (cur && cur.status === 'outgoing' ? (toast('Not answered — try again later', 'warn'), cleanupAll()) : cur)), 45000);
  }

  async function loadIce() {
    try {
      const r = await fetch('/api/calls/ice-servers', { credentials: 'same-origin' });
      const d = await r.json();
      if (Array.isArray(d.iceServers) && d.iceServers.length) return { iceServers: d.iceServers };
    } catch {}
    return ICE;
  }

  function attachLocal() {
    if (localRef.current && localStream.current) localRef.current.srcObject = localStream.current;
  }

  async function wirePC(callId, peerId, initiator) {
    try { pcRef.current?.close(); } catch {}
    const pc = new RTCPeerConnection(iceRef.current || ICE);
    pcRef.current = pc;
    peerRef.current = peerId;
    pendingIce.current = [];
    for (const t of localStream.current?.getTracks?.() || []) pc.addTrack(t, localStream.current);
    pc.ontrack = (e) => { if (remoteRef.current) remoteRef.current.srcObject = e.streams[0]; };
    pc.onicecandidate = (e) => { if (e.candidate && peerId && callIdRef.current) emit('call:ice', { callId: callIdRef.current, to: peerId, candidate: e.candidate }); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setOverlay((cur) => (cur ? { ...cur, status: 'active' } : cur));
      if (pc.connectionState === 'disconnected') { try { pc.restartIce(); } catch {} }
      if (['failed', 'closed'].includes(pc.connectionState)) setTimeout(() => cleanupAll(), 800);
    };
    if (initiator) {
      pc.onnegotiationneeded = () => { offerReady.current = true; sendOffer(); };
    }
  }

  /* current callId lives in a ref so ICE/offer emission always reads the latest value */
  useEffect(() => { if (overlay?.callId) callIdRef.current = overlay.callId; }, [overlay?.callId]);

  async function accept() {
    try {
      localStream.current = await navigator.mediaDevices.getUserMedia(overlay?.type === 'video' ? { audio: true, video: true } : { audio: true });
    } catch (e) { toast('Media unavailable: ' + e.message, 'warn'); return decline(); }
    emit('call:answer', { callId: overlay.callId, accept: true });
    setOverlay((cur) => (cur ? { ...cur, status: 'connecting' } : cur));
    callIdRef.current = overlay.callId;
    acceptedRef.current = true;
    iceRef.current = await loadIce();
    await wirePC(overlay.callId, overlay.peerId, false);
    attachLocal();
    window.__vcRing?.(false);
    if (pendingOfferRef.current) { const p = pendingOfferRef.current; pendingOfferRef.current = null; await handleOffer(p.callId, p.from, p.sdp); }
  }
  function decline() {
    emit('call:answer', { callId: overlay?.callId, accept: false });
    window.__vcRing?.(false);
    cleanupAll();
  }
  function cleanupAll() {
    try { pcRef.current?.close(); } catch {}
    pcRef.current = null;
    localStream.current?.getTracks?.().forEach((t) => t.stop());
    localStream.current = null;
    sharingTrack.current = null;
    setOverlay(null); setMic(true); setCam(true); setSharing(false); setSecs(0);
    lastEndedRef.current = callIdRef.current; callIdRef.current = null;
    acceptedRef.current = false; pendingOfferRef.current = null; pendingIce.current = []; cameraTrackRef.current = null; setPeerMedia({ mic: true, cam: true });
    window.__vcRing?.(false);
  }
  function endCall() {
    emit('call:end', { callId: overlay?.callId });
    cleanupAll();
  }
  function sendMediaState(state) {
    if (overlay?.callId && overlay?.peerId) emit('call:media-state', { callId: overlay.callId, to: overlay.peerId, state });
  }
  function toggleMic() {
    const v = !mic; setMic(v); sendMediaState({ mic: v, cam });
    localStream.current?.getAudioTracks?.().forEach((t) => { t.enabled = v; });
  }
  function toggleCam() {
    const v = !cam; setCam(v); sendMediaState({ mic, cam: v });
    localStream.current?.getVideoTracks?.().forEach((t) => { t.enabled = v; });
  }
  async function shareScreen() {
    try {
      const ds = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = ds.getVideoTracks()[0];
      sharingTrack.current = track;
      const sender = pcRef.current?.getSenders?.().find((s) => s.track?.kind === 'video');
      if (sender) { cameraTrackRef.current = cameraTrackRef.current || sender.track; await sender.replaceTrack(track); } else pcRef.current?.addTrack(track, ds);
      track.onended = () => { stopShare(); toast('Screen sharing ended'); };
      setSharing(true);
      toast('🖥️ Screen sharing');
    } catch { toast('Screen share was cancelled', 'warn'); }
  }
  function stopShare() {
    const screen = sharingTrack.current;
    try { screen?.stop(); } catch {}
    sharingTrack.current = null;
    const sender = pcRef.current?.getSenders?.().find((s) => s.track && s.track === screen);
    if (sender) sender.replaceTrack(cameraTrackRef.current || null).catch(() => {});
    setSharing(false);
  }

  window.__vcRing = (onv) => { /* dev beep via WebAudio */ try {
    if (!onv) { window.__vcRingOff?.(); return; }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    window.__vcRingOff = () => ctx.close().catch?.(() => {});
    const osc = ctx.createOscillator(); const g = ctx.createGain();
    osc.frequency.value = 620; g.gain.value = 0.03; osc.connect(g); g.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.35);
    osc._int = setInterval(() => { try { osc.start(); osc.stop(ctx.currentTime + 0.35); } catch {} }, 900);
    setTimeout(() => { clearInterval(osc._int); ctx.close().catch?.(() => {}); }, 30000);
  } catch {} };

  if (!overlay) return null;
  const video = overlay.type === 'video';
  return (
    <div className={`call-veil ${video ? '' : 'audio'}`}>
      <div className="call-card pop">
        {video ? (
          <div className="video-grid">
            <video ref={remoteRef} autoPlay playsInline className="remote-v" />
            <video ref={localRef} autoPlay playsInline muted className="local-v" />
          </div>
        ) : (
          <div className="audio-call">
            <div className="pulse-ring" />
            <h3 style={{ margin: 0 }}>{overlay.status === 'ringing' ? '📞 Incoming call' : overlay.status === 'active' ? '🔊 On call' : '⏳ Calling…'}</h3>
            {overlay.status !== 'ringing' && !peerMedia.mic && <div className="dim" style={{ fontSize: 12 }}>🔇 Peer muted</div>}
            {overlay.status !== 'ringing' && overlay.type === 'video' && !peerMedia.cam && <div className="dim" style={{ fontSize: 12 }}>📷 Peer camera off</div>}
            <div className="dim">{overlay.dir === 'in' ? 'someone wants to talk' : 'media connecting…'}</div>
          </div>
        )}
        {overlay.status === 'active' && (
          <div style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
            {String(Math.floor(secs / 60)).padStart(2, '0')}:{String(secs % 60).padStart(2, '0')}
          </div>
        )}
        <div className="call-actions row">
          {!(overlay.dir === 'in' && overlay.status === 'ringing') && (
            <>
              <button className="btn icon" title={mic ? 'Mute' : 'Unmute'} onClick={toggleMic}>{mic ? '🎙️' : '🔇'}</button>
              {video && <button className="btn icon" title={cam ? 'Camera off' : 'Camera on'} onClick={toggleCam}>{cam ? '🎥' : '🚫'}</button>}
              {video && <button className={`btn icon ${sharing ? 'primary' : ''}`} title="Share screen" onClick={sharing ? stopShare : shareScreen}>🖥️</button>}
              <button className="btn danger" onClick={endCall}>{overlay.status === 'active' || overlay.status === 'connecting' ? 'End call' : 'Cancel'}</button>
            </>
          )}
          {overlay.dir === 'in' && overlay.status === 'ringing' && (
            <>
              <button className="btn primary" onClick={accept}>✅ Accept</button>
              <button className="btn danger" onClick={decline}>❌ Decline</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
