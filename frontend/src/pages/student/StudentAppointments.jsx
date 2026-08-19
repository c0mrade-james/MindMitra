import { forwardRef, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import toast from 'react-hot-toast';
import { CalendarDays, Plus, Video, X } from 'lucide-react';
import { appointmentApi } from '../../services/appointment.api';
import Rating from '../../components/forms/Rating';
import { userApi } from '../../services/user.api';
import Card from '../../components/shared/Card';
import EmptyState from '../../components/shared/EmptyState';
import TextArea from '../../components/forms/TextArea';
import { useSocket } from '../../contexts/SocketContext';

const statusStyle = {
  pending: 'bg-amber-500/10 text-amber-600',
  approved: 'bg-teal-600/10 text-teal-700',
  in_session: 'bg-teal-500/20 text-teal-700',
  completed: 'bg-teal-600/20 text-teal-800',
  cancelled: 'bg-teal-600/5 text-teal-600/50',
  rejected: 'bg-clay-500/10 text-clay-600',
};

const DateInput = forwardRef(({ value, onClick }, ref) => (
  <button
    type="button"
    ref={ref}
    onClick={onClick}
    className="focus-ring w-full rounded-xl border border-teal-600/20 bg-white dark:bg-teal-900 px-4 py-2.5 text-left text-sm text-teal-900 dark:text-white flex items-center justify-between gap-2"
  >
    <span className={`truncate ${!value ? 'text-teal-500' : ''}`}>{value || 'Select a date'}</span>
    <CalendarDays className="w-4 h-4 text-teal-600" />
  </button>
));

const StudentAppointments = () => {
  const navigate = useNavigate();
  const { socket } = useSocket();
  const [appointments, setAppointments] = useState([]);
  const [counselors, setCounselors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [availability, setAvailability] = useState({ slots: [], reason: null, loading: false });
  const [form, setForm] = useState({ counselor: '', preferredDate: null, timeSlot: '', consultationMode: 'online', reason: '' });

  const load = () => {
    Promise.all([appointmentApi.getMy(), userApi.getCounselors()])
      .then(([apptRes, userRes]) => {
        setAppointments(apptRes.data.data);
        setCounselors(userRes.data.data || []);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // Real-time: re-fetch appointments when a new notification arrives
  useEffect(() => {
    if (!socket) return;
    const handleNotification = () => load();
    socket.on('notification:new', handleNotification);
    return () => socket.off('notification:new', handleNotification);
  }, [socket]);

  const formatDateForApi = (date) => {
    if (!date) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const fetchAvailability = async (counselorId, dateValue) => {
    if (!counselorId || !dateValue) {
      setAvailability({ slots: [], reason: null, loading: false });
      return;
    }

    const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
    if (Number.isNaN(date.getTime())) {
      setAvailability({ slots: [], reason: 'error', loading: false });
      return;
    }

    const dateStr = formatDateForApi(date);
    setAvailability((prev) => ({ ...prev, loading: true }));

    try {
      const res = await userApi.getCounselorAvailability(counselorId, dateStr);
      setAvailability({ slots: res.data.data.slots || [], reason: res.data.data.reason || null, loading: false });
    } catch (err) {
      setAvailability({ slots: [], reason: 'error', loading: false });
    }
  };

  useEffect(() => {
    setForm((prev) => ({ ...prev, timeSlot: '' }));
    if (form.counselor && form.preferredDate) {
      fetchAvailability(form.counselor, form.preferredDate);
    } else {
      setAvailability({ slots: [], reason: null, loading: false });
    }
  }, [form.counselor, form.preferredDate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      // check if selected counselor requires payment
      const selected = counselors.find((c) => c._id === form.counselor);
      if (selected?.counselorProfile?.consultationFee > 0) {
        // simple client-side prompt to confirm payment — replace with real payment flow
        const confirmPay = window.confirm(`This counselor requires a fee of ${selected.counselorProfile.consultationFee}. Mark as paid to proceed?`);
        if (!confirmPay) throw new Error('Payment required');
        await appointmentApi.create({ ...form, paid: true });
      } else {
        await appointmentApi.create(form);
      }
      toast.success('Appointment requested');
      setForm({ counselor: '', preferredDate: null, timeSlot: '', consultationMode: 'online', reason: '' });
      setAvailability({ slots: [], reason: null, loading: false });
      setShowForm(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to request appointment');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRate = async (id, value, feedback) => {
    try {
      await appointmentApi.rate(id, { rating: value, feedback });
      toast.success('Thanks for the rating');
      load();
    } catch (err) {
      toast.error('Failed to submit rating');
    }
  };

  const handleCancel = async (id) => {
    try {
      await appointmentApi.cancel(id);
      toast.success('Appointment cancelled');
      load();
    } catch (err) {
      toast.error('Failed to cancel appointment');
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl font-semibold text-teal-900 dark:text-white">Appointments</h1>
        <button onClick={() => setShowForm((s) => !s)} className="btn btn-sm bg-teal-600 hover:bg-teal-700 text-white border-none rounded-full gap-1">
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />} {showForm ? 'Cancel' : 'Request appointment'}
        </button>
      </div>

      {showForm && (
        <Card>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-teal-800 dark:text-white/90">Counselor</label>
              <select
                required
                value={form.counselor}
                onChange={(e) => setForm({ ...form, counselor: e.target.value })}
                className="focus-ring w-full rounded-xl border border-teal-600/20 bg-white dark:bg-teal-900 px-4 py-2.5 text-sm text-teal-900 dark:text-white"
              >
                <option value="">Select a counselor</option>
                {counselors.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-teal-800 dark:text-white/90">Preferred date</label>
              <DatePicker
                selected={form.preferredDate}
                onChange={(date) => setForm({ ...form, preferredDate: date })}
                minDate={new Date()}
                dateFormat="yyyy-MM-dd"
                customInput={<DateInput />}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-teal-800 dark:text-white/90">Time slot</label>
              {availability.loading ? (
                <span className="text-sm text-teal-700">Loading available slots…</span>
              ) : !form.counselor ? (
                <span className="text-sm text-teal-700">Select a counselor first.</span>
              ) : !form.preferredDate ? (
                <span className="text-sm text-teal-700">Select a date to view available slots.</span>
              ) : availability.reason === 'not_working_day' ? (
                <span className="text-sm text-red-600">Counselor is not available on that day.</span>
              ) : availability.reason === 'error' ? (
                <span className="text-sm text-red-600">Unable to load availability. Try another date.</span>
              ) : availability.slots.length === 0 ? (
                <span className="text-sm text-teal-700">No available slots for this counselor on that date.</span>
              ) : (
                <select
                  required
                  value={form.timeSlot}
                  onChange={(e) => setForm({ ...form, timeSlot: e.target.value })}
                  className="focus-ring w-full rounded-xl border border-teal-600/20 bg-white dark:bg-teal-900 px-4 py-2.5 text-sm text-teal-900 dark:text-white"
                >
                  <option value="">Select a time slot</option>
                  {availability.slots.map((slot) => (
                    <option key={slot.slot} value={slot.slot} disabled={!slot.available}>
                      {slot.slot}{!slot.available ? ' (booked)' : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-teal-800 dark:text-white/90">Consultation mode</label>
              <select
                required
                value={form.consultationMode}
                onChange={(e) => setForm({ ...form, consultationMode: e.target.value })}
                className="focus-ring w-full rounded-xl border border-teal-600/20 bg-white dark:bg-teal-900 px-4 py-2.5 text-sm text-teal-900 dark:text-white"
              >
                <option value="online">Online</option>
                <option value="offline">Offline</option>
                <option value="phone">Phone</option>
              </select>
            </div>
            <TextArea label="Reason for visit" rows={3} required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            <button type="submit" disabled={submitting} className="btn bg-teal-600 hover:bg-teal-700 text-white border-none rounded-xl">
              {submitting ? <span className="loading loading-spinner loading-sm" /> : 'Request appointment'}
            </button>
          </form>
        </Card>
      )}

      {loading ? (
        <span className="loading loading-spinner text-teal-600" />
      ) : appointments.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No appointments yet" message="Request time with a counselor whenever you're ready." />
      ) : (
        <div className="space-y-3">
          {appointments.map((a) => (
            <Card key={a._id} className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="font-semibold text-sm text-teal-900 dark:text-white">{a.counselor?.name}</p>
                <p className="text-xs text-teal-600/70">{new Date(a.preferredDate).toLocaleDateString()} · {a.timeSlot}</p>
                <p className="text-xs text-teal-700/60 mt-1 max-w-xs">{a.reason}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2.5 py-1 rounded-full capitalize font-medium ${statusStyle[a.status]}`}>{a.status === 'in_session' ? 'In Session' : a.status}</span>
                {a.status === 'pending' && (
                  <button onClick={() => handleCancel(a._id)} className="text-xs text-clay-600 hover:underline">Cancel</button>
                )}
                {a.status === 'in_session' && a.sessionId && (
                  <button
                    onClick={() => navigate(`/session/${a.sessionId}`)}
                    className="btn btn-sm bg-teal-600 hover:bg-teal-700 text-white border-none rounded-xl gap-1.5"
                  >
                    <Video className="w-4 h-4" /> Join Session
                  </button>
                )}
                {a.status === 'approved' && (
                  <span className="text-xs text-teal-600/70 italic">Waiting for counselor</span>
                )}
              </div>
                {a.status === 'completed' && !a.rating && (
                  <div className="mt-3">
                    <p className="text-sm text-teal-700 mb-2">Rate your session</p>
                    <Rating onSubmit={(value, feedback) => handleRate(a._id, value, feedback)} />
                  </div>
                )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default StudentAppointments;