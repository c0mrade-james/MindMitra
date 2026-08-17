import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSocket } from '../../contexts/SocketContext';
import { useAuth } from '../../contexts/AuthContext';
import { appointmentApi } from '../../services/appointment.api';

const SessionPage = () => {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { socket } = useSocket();
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const pcRef = useRef(null);
  const pendingIceRef = useRef([]);
  const iceServersRef = useRef([{ urls: 'stun:stun.l.google.com:19302' }]);
  const [appointment, setAppointment] = useState(null);
  const [sessionJoined, setSessionJoined] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [pcState, setPcState] = useState('new');
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

  const stopTracksAndClosePeer = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.getSenders().forEach((s) => { if (s.track) s.track.stop(); });
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localVideoRef.current?.srcObject) {
      localVideoRef.current.srcObject.getTracks().forEach((track) => track.stop());
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current?.srcObject) {
      remoteVideoRef.current.srcObject.getTracks().forEach((track) => track.stop());
      remoteVideoRef.current.srcObject = null;
    }
  }, []);

  const getOtherUserId = useCallback(() => {
    if (!appointment || !user) return null;
    const studentId = appointment.student._id || appointment.student;
    const counselorId = appointment.counselor._id || appointment.counselor;
    return String(studentId) === String(user._id) ? counselorId : studentId;
  }, [appointment, user]);

  const flushPendingIce = useCallback(async () => {
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
  }, []);

  const ensurePeerConnection = useCallback(async () => {
    if (pcRef.current) return pcRef.current;

    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
    }

    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
    pcRef.current = pc;

    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.ontrack = (evt) => {
      console.log('[SessionPage] Remote stream attached, tracks:', evt.streams[0]?.getTracks().length);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = evt.streams[0];
      }
    };

    pc.onicecandidate = (evt) => {
      if (evt.candidate && appointment) {
        const other = getOtherUserId();
        if (other) {
          socket.emit('webrtc:ice', { targetUserId: other, candidate: evt.candidate });
        }
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('[SessionPage] Connection state:', pc.connectionState);
      setPcState(pc.connectionState);
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[SessionPage] ICE connection state:', pc.iceConnectionState);
    };

    setStarted(true);
    return pc;
  }, [appointment, getOtherUserId, socket]);

  const createOfferAndSend = useCallback(async () => {
    if (!appointment || !socket) return;
    const pc = await ensurePeerConnection();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const other = getOtherUserId();
    if (!other) return;

    console.log('[SessionPage] Creating offer and sending to', other);
    socket.emit('webrtc:offer', { targetUserId: other, offer });
  }, [appointment, socket, ensurePeerConnection, getOtherUserId]);

  useEffect(() => {
    if (!socket || !appointment) return undefined;

    const handleSessionJoined = ({ sessionId: id, iceServers }) => {
      console.log('[SessionPage] Joined session', id);
      if (iceServers && iceServers.length > 0) {
        iceServersRef.current = iceServers;
        console.log('[SessionPage] Using custom ICE servers');
      }
      setSessionJoined(true);
    };

    const handleSessionReady = ({ sessionId: id }) => {
      console.log('[SessionPage] Session ready', id);
      setSessionReady(true);
      setPeerLeft(false);
    };

    const handleOffer = async ({ fromUserId, offer }) => {
      console.log('[SessionPage] Offer received from', fromUserId);
      await ensurePeerConnection();

      const pc = pcRef.current;
      if (!pc) return;

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        await flushPendingIce();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('webrtc:answer', { targetUserId: fromUserId, answer });
        console.log('[SessionPage] Answer sent to', fromUserId);
      } catch (err) {
        console.error('[SessionPage] Error handling offer:', err);
      }
    };

    const handleAnswer = async ({ fromUserId, answer }) => {
      console.log('[SessionPage] Answer received from', fromUserId);
      const pc = pcRef.current;
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        flushPendingIce();
      } catch (err) {
        console.error('[SessionPage] Error handling answer:', err);
      }
    };

    const handleIce = async ({ candidate }) => {
      const pc = pcRef.current;
      if (!pc) return;
      if (pc.remoteDescription && pc.remoteDescription.type) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.error('[SessionPage] addIceCandidate failed', err);
        }
      } else {
        pendingIceRef.current.push(candidate);
      }
    };

    const handlePeerLeft = ({ sessionId: id, userId }) => {
      console.log('[SessionPage] Peer left', userId);
      setPeerLeft(true);
      if (remoteVideoRef.current?.srcObject) {
        remoteVideoRef.current.srcObject.getTracks().forEach((track) => track.stop());
        remoteVideoRef.current.srcObject = null;
      }
    };

    const handleSocketConnect = () => {
      console.log('[SessionPage] Socket reconnected, rejoining session');
      socket.emit('session:join', { sessionId });
    };

    socket.on('connect', handleSocketConnect);
    socket.on('session:joined', handleSessionJoined);
    socket.on('session:ready', handleSessionReady);
    socket.on('webrtc:offer', handleOffer);
    socket.on('webrtc:answer', handleAnswer);
    socket.on('webrtc:ice', handleIce);
    socket.on('session:peer-left', handlePeerLeft);

    socket.emit('session:join', { sessionId });
    ensurePeerConnection().catch((err) => console.error('[SessionPage] Failed to initialize peer connection', err));

    return () => {
      socket.off('connect', handleSocketConnect);
      socket.off('session:joined', handleSessionJoined);
      socket.off('session:ready', handleSessionReady);
      socket.off('webrtc:offer', handleOffer);
      socket.off('webrtc:answer', handleAnswer);
      socket.off('webrtc:ice', handleIce);
      socket.off('session:peer-left', handlePeerLeft);
    };
  }, [socket, appointment, sessionId, ensurePeerConnection, flushPendingIce]);

  useEffect(() => {
    if (sessionReady) {
      if (isCounselor) {
        createOfferAndSend();
      }
    }
  }, [sessionReady, isCounselor, createOfferAndSend]);

  // Cleanup on unmount — stop camera and close peer connection
  useEffect(() => {
    return () => {
      stopTracksAndClosePeer();
    };
  }, [stopTracksAndClosePeer]);

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

  return (
    <div className="max-w-4xl mx-auto py-8">
      <h1 className="text-xl font-semibold mb-4">Session: {sessionId}</h1>
      <div className="mb-4 flex items-center gap-3">
        <span className={`badge ${pcState === 'connected' ? 'badge-success' : pcState === 'failed' ? 'badge-error' : 'badge-warning'}`}>
          {pcState === 'connected' ? 'Connected' : pcState === 'failed' ? 'Connection failed' : 'Connecting...'}
        </span>
        {peerLeft && <span className="badge badge-error">Peer left</span>}
        <button onClick={handleEnd} className="btn btn-ghost btn-sm">End session</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg p-4 shadow">
          <p className="text-sm text-teal-700 mb-2">Your camera</p>
          <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-64 bg-black rounded" />
        </div>
        <div className="bg-white rounded-lg p-4 shadow relative">
          <p className="text-sm text-teal-700 mb-2">Remote</p>
          <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-64 bg-black rounded" />
          {peerLeft && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded">
              <p className="text-white text-sm">Peer has left the session</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SessionPage;
