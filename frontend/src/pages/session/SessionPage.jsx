import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSocket } from '../../contexts/SocketContext';
import { useAuth } from '../../contexts/AuthContext';
import { appointmentApi } from '../../services/appointment.api';

const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

const SessionPage = () => {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { socket } = useSocket();
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  // In-flight getUserMedia / PC creation promises. Making these single-flight
  // means the mount effect and the offer/answer handlers await the SAME
  // stream/connection instead of racing: two concurrent getUserMedia calls
  // make the browser abort one (AbortError) and, when the aborted one is
  // inside handleOffer, the student silently never sends its answer.
  const localStreamPromiseRef = useRef(null);
  const pcPromiseRef = useRef(null);
  // Bumped whenever the peer connection is torn down so an in-flight
  // ensurePeerConnection() knows its freshly created PC was superseded
  // (e.g. peer-left fires while the camera is still being acquired).
  const pcGenerationRef = useRef(0);
  // Guards getUserMedia that resolves after unmount (React StrictMode
  // double-mount) so it stops its tracks instead of leaving the camera on.
  const unmountedRef = useRef(false);
  const pendingIceRef = useRef([]);
  // ICE servers (including any TURN config) sent by the backend on
  // session:joined. Kept in a ref (not state) since it's only read inside
  // callbacks, never rendered.
  const iceServersRef = useRef(DEFAULT_ICE_SERVERS);
  const [appointment, setAppointment] = useState(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [peerLeft, setPeerLeft] = useState(false);
  const { user } = useAuth();

  const isCounselor = appointment && user && String(user._id) === String(appointment.counselor._id || appointment.counselor);

  useEffect(() => {
    appointmentApi.getBySession(sessionId)
      .then((res) => setAppointment(res.data.data))
      .catch(() => {
        alert('Session not found or you are not a participant');
        navigate(-1);
      });
  }, [sessionId]);

  useEffect(() => {
    if (!socket || !appointment) return undefined;

    const handleSessionJoined = ({ sessionId: id, iceServers }) => {
      console.log('[SessionPage] Joined session', id);
      if (Array.isArray(iceServers) && iceServers.length) {
        iceServersRef.current = iceServers;
      }
    };

    const handleSessionReady = ({ sessionId: id }) => {
      console.log('[SessionPage] Session ready', id);
      setPeerLeft(false);
      setSessionReady(true);
    };

    // The backend emits this when the other participant disconnects
    // (network blip, tab closed, refresh). Tear down just the peer
    // connection — keep the local camera running — so that when the
    // backend re-emits session:ready on their rejoin, a fresh
    // offer/answer exchange can happen instead of the call staying
    // frozen on the old, now-dead connection.
    const handlePeerLeft = () => {
      console.log('[SessionPage] Peer left the session');
      setPeerLeft(true);
      setSessionReady(false);
      closePeerConnectionOnly();
    };

    const handleOffer = async ({ fromUserId, offer }) => {
      console.log('[SessionPage] Offer received', { fromUserId });
      try {
        const pc = await ensurePeerConnection();
        if (!pc) return;

        // Glare guard: the backend re-fires session:ready after a reconnect,
        // which can produce a second offer while we're still negotiating the
        // first. setRemoteDescription throws unless the state is 'stable',
        // and with no error handling that used to silently kill the answer.
        if (pc.signalingState !== 'stable') {
          console.warn('[SessionPage] Ignoring offer: signalingState is', pc.signalingState);
          return;
        }

        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        await flushPendingIce();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('webrtc:answer', { targetUserId: fromUserId, answer });
        console.log('[SessionPage] Answer sent', { targetUserId: fromUserId });
      } catch (err) {
        console.error('[SessionPage] Failed to answer offer', err);
      }
    };

    const handleAnswer = async ({ answer }) => {
      console.log('[SessionPage] Answer received');
      const pc = pcRef.current;
      if (!pc) return;
      if (pc.signalingState !== 'have-local-offer') {
        console.warn('[SessionPage] Ignoring answer: signalingState is', pc.signalingState);
        return;
      }
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        flushPendingIce();
      } catch (err) {
        console.error('[SessionPage] Failed to apply answer', err);
      }
    };

    const handleIce = async ({ candidate }) => {
      console.log('[SessionPage] ICE candidate received', candidate?.candidate);
      const pc = pcRef.current;
      // Queue candidates that arrive before the peer connection (or its
      // remote description) exists — previously these were dropped entirely,
      // losing the counselor's early candidates on the student side.
      if (!pc || !pc.remoteDescription || !pc.remoteDescription.type) {
        pendingIceRef.current.push(candidate);
        console.log('[SessionPage] Queued ICE candidate until peer connection is ready');
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('[SessionPage] addIceCandidate failed', err);
      }
    };

    const handleSocketConnect = () => {
      console.log('[SessionPage] Socket reconnected');
      socket.emit('session:join', { sessionId });
    };

    socket.on('connect', handleSocketConnect);
    socket.on('session:joined', handleSessionJoined);
    socket.on('session:ready', handleSessionReady);
    socket.on('session:peer-left', handlePeerLeft);
    socket.on('webrtc:offer', handleOffer);
    socket.on('webrtc:answer', handleAnswer);
    socket.on('webrtc:ice', handleIce);

    socket.emit('session:join', { sessionId });
    // Request the camera for the local preview here, but defer creating the
    // RTCPeerConnection until an offer/answer exchange actually starts — the
    // backend's ICE/TURN servers only arrive in session:joined, and creating
    // the connection with the default STUN list ignores them entirely.
    getLocalStream().catch((err) => console.error('[SessionPage] Failed to get local media', err));

    return () => {
      socket.off('connect', handleSocketConnect);
      socket.off('session:joined', handleSessionJoined);
      socket.off('session:ready', handleSessionReady);
      socket.off('session:peer-left', handlePeerLeft);
      socket.off('webrtc:offer', handleOffer);
      socket.off('webrtc:answer', handleAnswer);
      socket.off('webrtc:ice', handleIce);
    };
  }, [socket, appointment, sessionId]);

  useEffect(() => {
    if (sessionReady) {
      console.log('[SessionPage] session:ready fired');
      if (isCounselor) {
        console.log('[SessionPage] Counselor is initiator and will create offer');
        createOfferAndSend();
      } else {
        console.log('[SessionPage] Student is waiting for offer');
      }
    }
  }, [sessionReady, isCounselor]);

  // Release the camera/mic and close the peer connection no matter how the
  // user leaves the page (back button, closing the tab, navigating
  // elsewhere in the SPA) — not just via the explicit "End session" button.
  // Previously this cleanup only ran inside handleEnd, so any other exit
  // path left the camera light on and the RTCPeerConnection open.
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      stopTracksAndClosePeer();
    };
  }, []);

  const getOtherUserId = () => {
    if (!appointment || !user) return null;
    const studentId = appointment.student._id || appointment.student;
    const counselorId = appointment.counselor._id || appointment.counselor;
    return String(studentId) === String(user._id) ? counselorId : studentId;
  };

  const flushPendingIce = async () => {
    const pc = pcRef.current;
    if (!pc || !pc.remoteDescription || !pc.remoteDescription.type) return;
    while (pendingIceRef.current.length) {
      const candidate = pendingIceRef.current.shift();
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('[SessionPage] Failed to flush queued ICE', err);
      }
    }
  };

  // Single-flight getUserMedia: returns the cached stream if we already have
  // one, or the in-flight promise if a request is still pending. Without this
  // the mount effect and the offer handler each call getUserMedia concurrently,
  // the browser aborts one call, and the aborted handler never answers.
  const getLocalStream = async () => {
    if (localStreamRef.current) return localStreamRef.current;
    if (localStreamPromiseRef.current) return localStreamPromiseRef.current;

    localStreamPromiseRef.current = (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (unmountedRef.current) {
        // Simulated unmount (StrictMode) or real unmount raced the prompt —
        // don't keep the camera on for a dead page.
        stream.getTracks().forEach((track) => track.stop());
        throw new Error('Session page unmounted while requesting camera');
      }
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      return stream;
    })().finally(() => {
      localStreamPromiseRef.current = null;
    });

    return localStreamPromiseRef.current;
  };

  // Single-flight RTCPeerConnection creation. The connection is only built
  // when an offer/answer exchange actually starts, by which point the
  // backend's ICE/TURN servers from session:joined are in iceServersRef — so
  // it never silently falls back to the bare STUN default.
  const ensurePeerConnection = async () => {
    if (pcRef.current) return pcRef.current;
    if (pcPromiseRef.current) return pcPromiseRef.current;

    pcPromiseRef.current = (async () => {
      const generation = pcGenerationRef.current;
      const stream = await getLocalStream();
      const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });

      // The connection was torn down (peer-left / unmount) while we were
      // acquiring the camera — the just-created PC is stale, close it.
      if (generation !== pcGenerationRef.current) {
        pc.close();
        throw new Error('Peer connection superseded');
      }
      pcRef.current = pc;

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      pc.ontrack = (evt) => {
        console.log('[SessionPage] Remote stream attached');
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = evt.streams[0];
      };

      pc.onicecandidate = (evt) => {
        if (evt.candidate && appointment) {
          const other = getOtherUserId();
          if (other) {
            console.log('[SessionPage] Sending ICE candidate');
            socket.emit('webrtc:ice', { targetUserId: other, candidate: evt.candidate });
          }
        }
      };

      return pc;
    })().finally(() => {
      pcPromiseRef.current = null;
    });

    return pcPromiseRef.current;
  };

  const createOfferAndSend = async () => {
    if (!appointment || !socket) return;
    try {
      const pc = await ensurePeerConnection();
      if (!pc) return;

      // Skip re-sending an offer if one is already outstanding (session:ready
      // re-fires after reconnects) — createOffer() throws when the state is
      // not 'stable', and throwing here left the call permanently stuck.
      if (pc.signalingState !== 'stable') {
        console.warn('[SessionPage] Skipping offer: signalingState is', pc.signalingState);
        return;
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const other = getOtherUserId();
      if (!other) return;

      console.log('[SessionPage] Creating offer and sending to', other);
      socket.emit('webrtc:offer', { targetUserId: other, offer });
    } catch (err) {
      console.error('[SessionPage] Failed to create offer', err);
    }
  };

  // Closes just the RTCPeerConnection — used when the remote peer drops so
  // we can rebuild the connection on their rejoin without losing our own
  // camera feed or re-prompting for permission.
  const closePeerConnectionOnly = () => {
    pcGenerationRef.current += 1;
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    pendingIceRef.current = [];
    if (remoteVideoRef.current?.srcObject) {
      remoteVideoRef.current.srcObject.getTracks().forEach((track) => track.stop());
      remoteVideoRef.current.srcObject = null;
    }
  };

  // Full teardown — stops the camera/mic and closes the peer connection.
  // Used on "End session" and on unmount.
  const stopTracksAndClosePeer = () => {
    closePeerConnectionOnly();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    if (localVideoRef.current?.srcObject) {
      localVideoRef.current.srcObject = null;
    }
  };

  const handleEnd = async () => {
    try {
      if (!appointment) return;
      await appointmentApi.complete(appointment._id);
      stopTracksAndClosePeer();
      if (user?.role === 'counselor') navigate('/dashboard/counselor/appointments');
      else navigate('/dashboard/student/appointments');
    } catch (err) {
      alert('Failed to end session');
    }
  };

  const statusLabel = peerLeft
    ? 'Other participant disconnected — waiting for them to rejoin…'
    : sessionReady
      ? 'Connected'
      : 'Waiting for the other participant to join…';

  return (
    <div className="max-w-4xl mx-auto py-8">
      <h1 className="text-xl font-semibold mb-4">Session: {sessionId}</h1>
      <div className="mb-4 flex items-center gap-3">
        <span className={`badge ${sessionReady && !peerLeft ? 'badge-success' : 'badge-warning'}`}>{statusLabel}</span>
        <button onClick={handleEnd} className="btn btn-ghost">End session</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg p-4 shadow">
          <p className="text-sm text-teal-700 mb-2">Your camera</p>
          <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-64 bg-black rounded" />
        </div>
        <div className="bg-white rounded-lg p-4 shadow">
          <p className="text-sm text-teal-700 mb-2">Remote</p>
          <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-64 bg-black rounded" />
        </div>
      </div>
    </div>
  );
};

export default SessionPage;
