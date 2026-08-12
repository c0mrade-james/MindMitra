import { useEffect, useRef, useState } from 'react';
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
  const [appointment, setAppointment] = useState(null);
  const [sessionJoined, setSessionJoined] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [started, setStarted] = useState(false);
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

    const handleSessionJoined = ({ sessionId: id }) => {
      console.log('[SessionPage] Joined session', id);
      setSessionJoined(true);
    };

    const handleSessionReady = ({ sessionId: id }) => {
      console.log('[SessionPage] Session ready', id);
      setSessionReady(true);
    };

    const handleOffer = async ({ fromUserId, offer }) => {
      console.log('[SessionPage] Offer received', { fromUserId });
      await ensurePeerConnection(false);

      const pc = pcRef.current;
      if (!pc) return;

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      await flushPendingIce();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('webrtc:answer', { targetUserId: fromUserId, answer });
      console.log('[SessionPage] Answer sent', { targetUserId: fromUserId });
    };

    const handleAnswer = async ({ answer }) => {
      console.log('[SessionPage] Answer received');
      const pc = pcRef.current;
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      flushPendingIce();
    };

    const handleIce = async ({ candidate }) => {
      console.log('[SessionPage] ICE candidate received', candidate?.candidate);
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
        console.log('[SessionPage] Queued ICE candidate until remote description is set');
      }
    };

    const handleSocketConnect = () => {
      console.log('[SessionPage] Socket reconnected');
      socket.emit('session:join', { sessionId });
    };

    socket.on('connect', handleSocketConnect);
    socket.on('session:joined', handleSessionJoined);
    socket.on('session:ready', handleSessionReady);
    socket.on('webrtc:offer', handleOffer);
    socket.on('webrtc:answer', handleAnswer);
    socket.on('webrtc:ice', handleIce);

    socket.emit('session:join', { sessionId });
    ensurePeerConnection(false).catch((err) => console.error('[SessionPage] Failed to initialize peer connection', err));

    return () => {
      socket.off('connect', handleSocketConnect);
      socket.off('session:joined', handleSessionJoined);
      socket.off('session:ready', handleSessionReady);
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

  const ensurePeerConnection = async (isInitiator) => {
    if (pcRef.current) return pcRef.current;

    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
    }

    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
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

    setStarted(true);
    return pc;
  };

  const createOfferAndSend = async () => {
    if (!appointment || !socket) return;
    const pc = await ensurePeerConnection(true);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const other = getOtherUserId();
    if (!other) return;

    console.log('[SessionPage] Creating offer and sending to', other);
    socket.emit('webrtc:offer', { targetUserId: other, offer });
  };

  const stopTracksAndClosePeer = () => {
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

  return (
    <div className="max-w-4xl mx-auto py-8">
      <h1 className="text-xl font-semibold mb-4">Session: {sessionId}</h1>
      <div className="mb-4">
        <button disabled className="btn btn-primary mr-2">Start camera & connect</button>
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
