import { useState } from 'react';
import { addSession } from './api';
import { fmtAED } from './helpers';

const AddSessionModal = ({ show, onClose, students, onSessionAdded }) => {
    const [studentPhone, setStudentPhone] = useState('');
    const [studentId, setStudentId] = useState('');
    const [subject, setSubject] = useState('');
    const [rate, setRate] = useState('');
    const [hours, setHours] = useState('0');
    const [minutes, setMinutes] = useState('0');
    const [sessionDate, setSessionDate] = useState(new Date().toISOString().split('T')[0]);
    const [amountPaid, setAmountPaid] = useState('0');
    const [notes, setNotes] = useState('');

    const h = parseFloat(hours) || 0;
    const m = parseFloat(minutes) || 0;
    const r = parseFloat(rate) || 0;
    const amountDue = r * (h + m / 60);

    const handleFormSubmit = async (e) => {
        e.preventDefault();
        if (!studentId || !rate) return;
        const data = await addSession({ student_id: studentId, subject, hourly_rate: rate, hours, minutes, session_date: sessionDate, amount_paid: amountPaid, notes, phone_number: studentPhone });
        if (data.error) return;
        setSubject(''); setRate(''); setHours('0'); setMinutes('0'); setAmountPaid('0'); setNotes(''); setStudentPhone('');
        onSessionAdded();
        onClose();
    };

    if (!show) return null;

    return (
        <div className="modal fade show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <div className="modal-dialog modal-dialog-centered modal-lg">
                <div className="modal-content">
                    <div className="modal-header">
                        <h5 className="modal-title m-0">Record New Session</h5>
                        <button type="button" className="btn-close" onClick={onClose}></button>
                    </div>
                    <form onSubmit={handleFormSubmit}>
                        <div className="modal-body">
                            <div className="row g-3">
                                <div className="col-md-4">
                                    <label className="form-label">Student</label>
                                    <select className="form-select" value={studentId} onChange={e => setStudentId(e.target.value)} required>
                                        <option value="">Select Student</option>
                                        {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                    </select>
                                </div>
                                <div className="col-md-4 mb-3">
                                    <label className="form-label">Student Phone</label>
                                    <input
                                        type="tel"
                                        className="form-control"
                                        placeholder="e.g. 971501234567"
                                        value={studentPhone}
                                        onChange={(e) => setStudentPhone(e.target.value)}
                                    />
                                </div>
                                <div className="col-md-4"><label className="form-label">Subject</label><input type="text" className="form-control" value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. Algorithm" /></div>
                                <div className="col-md-4"><label className="form-label">Rate per Hour (AED)</label><input type="number" className="form-control" step="0.01" min="0.01" value={rate} onChange={e => setRate(e.target.value)} required /></div>
                                <div className="col-md-3"><label className="form-label">Hours</label><input type="number" className="form-control" min="0" value={hours} onChange={e => setHours(e.target.value)} /></div>
                                <div className="col-md-3"><label className="form-label">Minutes</label><input type="number" className="form-control" min="0" max="59" value={minutes} onChange={e => setMinutes(e.target.value)} /></div>
                                <div className="col-md-3"><label className="form-label">Amount Due</label><input type="text" className="form-control" value={fmtAED(amountDue)} readOnly style={{ fontWeight: 'bold', background: '#e9ecef' }} /></div>
                                <div className="col-md-3"><label className="form-label">Date</label><input type="date" className="form-control" value={sessionDate} onChange={e => setSessionDate(e.target.value)} /></div>
                                <div className="col-md-8"><label className="form-label">Notes</label><input type="text" className="form-control" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes..." /></div>
                                <div className="col-md-4"><label className="form-label">Amount Paid (AED)</label><input type="number" className="form-control" step="0.01" min="0" value={amountPaid} onChange={e => setAmountPaid(e.target.value)} /></div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
                            <button type="submit" className="btn btn-success">Save Session</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default AddSessionModal;
