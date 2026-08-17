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
  const mediaRecorderRef = useRef(null);
  const sourceBufferRef = useRef(null);
  const mediaSourceRef = useRef(null);
  const chunkQueueRef = useRef([]);
  const pendingChunksRef = useRef([]);
  const peerLeftTimerRef = useRef(null);
  const [appointment, setAppointment] = useState(null);
  const [sessionJoined, setSessionJoined] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [connState, setConnState] = useState('new');
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

  const getOtherUserId = useCallback(() => {
    if (!appointment || !user) return null;
    const studentId = appointment.student._id || appointment.student;
    const counselorId = appointment.counselor._id || appointment.counselor;
    return String(studentId) === String(user._id) ? counselorId : studentId;
  }, [appointment, user]);

  const cleanupMedia = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    if (localVideoRef.current?.srcObject) {
      localVideoRef.current.srcObject.getTracks().forEach((t) => t.stop());
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current?.srcObject) {
      remoteVideoRef.current.srcObject.getTracks().forEach((t) => t.stop());
      remoteVideoRef.current.srcObject = null;
    }
    sourceBufferRef.current = null;
    mediaSourceRef.current = null;
    chunkQueueRef.current = [];
    pendingChunksRef.current = [];
  }, []);

  const startMediaRelay = useCallback(async () => {
    if (started || !socket || !sessionId) return;
    setStarted(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      setConnState('connecting');

      // Set up remote video with MediaSource for playback
      const MsClass = window.MediaSource || window.webkitMediaSource;
      if (MsClass) {
        const ms = new MsClass();
        mediaSourceRef.current = ms;
        remoteVideoRef.current.src = URL.createObjectURL(ms);

        ms.addEventListener('sourceopen', () => {
          try {
            const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
              ? 'video/webm;codecs=vp8,opus'
              : 'video/webm;codecs=vp8';
            const sb = ms.addSourceBuffer(mime);
            sb.mode = 'sequence';
            sourceBufferRef.current = sb;

            sb.addEventListener('updateend', () => {
              if (chunkQueueRef.current.length > 0 && !sb.updating) {
                sb.appendBuffer(chunkQueueRef.current.shift());
              }
            });

            // Flush any chunks that arrived before sourceopen
            while (pendingChunksRef.current.length > 0 && !sb.updating) {
              sb.appendBuffer(pendingChunksRef.current.shift());
            }
          } catch (e) {
            console.error('[SessionPage] SourceBuffer error:', e);
          }
        });
      }

      // Start MediaRecorder
      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
        ? 'video/webm;codecs=vp8,opus'
        : 'video/webm;codecs=vp8';

      const mr = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: 250000,
        audioBitsPerSecond: 64000,
      });
      mediaRecorderRef.current = mr;

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          const reader = new FileReader();
          reader.onload = () => {
            if (socket && sessionId) {
              socket.emit('session:media', { sessionId, data: reader.result });
            }
          };
          reader.readAsArrayBuffer(e.data);
        }
      };

      mr.onerror = (e) => {
        console.error('[SessionPage] MediaRecorder error:', e);
      };

      mr.onstop = () => {
        console.log('[SessionPage] MediaRecorder stopped');
      };

      mr.start(500);
      console.log('[SessionPage] Media relay started');
    } catch (err) {
      console.error('[SessionPage] Failed to start media relay:', err);
      setConnState('failed');
    }
  }, [started, socket, sessionId]);

  // Handle incoming media chunks
  useEffect(() => {
    if (!socket) return undefined;

    const handleMedia = ({ fromUserId, data }) => {
      const sb = sourceBufferRef.current;
      if (sb && !sb.updating) {
        try {
          sb.appendBuffer(new Uint8Array(data));
        } catch (e) {
          console.warn('[SessionPage] appendBuffer error:', e);
        }
      } else {
        pendingChunksRef.current.push(new Uint8Array(data));
        if (pendingChunksRef.current.length > 50) {
          pendingChunksRef.current.shift();
        }
      }
    };

    socket.on('session:media', handleMedia);
    return () => socket.off('session:media', handleMedia);
  }, [socket]);

  // Socket session management
  useEffect(() => {
    if (!socket || !appointment) return undefined;

    const handleSessionJoined = () => {
      setSessionJoined(true);
    };

    const handleSessionReady = () => {
      if (peerLeftTimerRef.current) {
        clearTimeout(peerLeftTimerRef.current);
        peerLeftTimerRef.current = null;
      }
      setPeerLeft(false);
      setSessionReady(true);
    };

    const handlePeerLeft = () => {
      peerLeftTimerRef.current = setTimeout(() => {
        setPeerLeft(true);
        setConnState('disconnected');
        if (remoteVideoRef.current?.srcObject) {
          remoteVideoRef.current.srcObject.getTracks().forEach((t) => t.stop());
          remoteVideoRef.current.srcObject = null;
        }
      }, 3000);
    };

    const handleSocketConnect = () => {
      socket.emit('session:join', { sessionId });
    };

    socket.on('connect', handleSocketConnect);
    socket.on('session:joined', handleSessionJoined);
    socket.on('session:ready', handleSessionReady);
    socket.on('session:peer-left', handlePeerLeft);

    socket.emit('session:join', { sessionId });

    return () => {
      socket.off('connect', handleSocketConnect);
      socket.off('session:joined', handleSessionJoined);
      socket.off('session:ready', handleSessionReady);
      socket.off('session:peer-left', handlePeerLeft);
    };
  }, [socket, appointment, sessionId]);

  useEffect(() => {
    if (sessionReady) {
      setConnState('connecting');
      startMediaRelay();
    }
  }, [sessionReady, startMediaRelay]);

  useEffect(() => {
    return () => {
      if (peerLeftTimerRef.current) clearTimeout(peerLeftTimerRef.current);
      cleanupMedia();
    };
  }, [cleanupMedia]);

  const handleEnd = async () => {
    try {
      if (!appointment) return;
      await appointmentApi.complete(appointment._id);
      cleanupMedia();
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
        <span className={`badge ${connState === 'connected' ? 'badge-success' : connState === 'failed' ? 'badge-error' : 'badge-warning'}`}>
          {connState === 'connected' ? 'Connected' : connState === 'failed' ? 'Connection failed' : connState === 'disconnected' ? 'Peer disconnected' : 'Connecting...'}
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
