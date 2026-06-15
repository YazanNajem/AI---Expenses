import { useState, useRef, useCallback } from 'react';
import { RotateCcw } from 'lucide-react';

export const useUndo = () => {
    const [toast, setToast] = useState({ visible: false, message: '', timeLeft: 0 });
    const timerRef = useRef(null);
    const intervalRef = useRef(null);
    const actionRefs = useRef({ onCommit: null, onRollback: null });

    const triggerUndo = useCallback((message, onOptimistic, onCommit, onRollback) => {
        if (timerRef.current) clearTimeout(timerRef.current);
        if (intervalRef.current) clearInterval(intervalRef.current);

        if (onOptimistic) onOptimistic();

        actionRefs.current = { onCommit, onRollback };

        setToast({ visible: true, message, timeLeft: 5 });

        intervalRef.current = setInterval(() => {
            setToast(prev => {
                if (prev.timeLeft <= 1) {
                    clearInterval(intervalRef.current);
                    return prev;
                }
                return { ...prev, timeLeft: prev.timeLeft - 1 };
            });
        }, 1000);

        timerRef.current = setTimeout(() => {
            clearInterval(intervalRef.current);
            if (actionRefs.current.onCommit) actionRefs.current.onCommit();
            setToast({ visible: false, message: '', timeLeft: 0 });
            actionRefs.current = { onCommit: null, onRollback: null };
        }, 5000);
    }, []);

    const handleUndo = useCallback(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        if (intervalRef.current) clearInterval(intervalRef.current);

        if (actionRefs.current.onRollback) actionRefs.current.onRollback();

        setToast({ visible: false, message: '', timeLeft: 0 });
        actionRefs.current = { onCommit: null, onRollback: null };
    }, []);

    const UndoToastUI = toast.visible ? (
        <div className="modern-toast">
            <span className="small text-muted">{toast.message}</span>
            <button type="button" className="btn btn-sm btn-link text-primary p-0 fw-bold small text-decoration-none" onClick={handleUndo}>
                <RotateCcw size={14} strokeWidth={2} className="me-1" /> Undo
            </button>
        </div>
    ) : null;

    return { triggerUndo, UndoToastUI };
};
