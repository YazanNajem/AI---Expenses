import { useState, useRef, useEffect } from 'react';
import { Trash2 } from 'lucide-react';

const SmartStudentSelector = ({ students, onSelectStudent, onStudentAdded, onDeleteStudent, effectiveTheme }) => {
    const isDark = effectiveTheme === 'dark';
    const [searchTerm, setSearchTerm] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const inputRef = useRef(null);
    const containerRef = useRef(null);

    const filtered = students.filter(s => s.name.toLowerCase().includes(searchTerm.toLowerCase()));
    const exactMatch = students.find(s => s.name.toLowerCase() === searchTerm.toLowerCase());
    const showCreate = searchTerm.trim() && !exactMatch;

    useEffect(() => {
        const handleClick = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    const handleSelect = (student) => {
        onSelectStudent(student.id);
        setSearchTerm(student.name);
        setIsOpen(false);
    };

    const handleCreate = async () => {
        if (!searchTerm.trim()) return;
        const res = await fetch('/tutoring/add-student', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ name: searchTerm.trim(), phone_number: '', subject: '', notes: '' })
        });
        const data = await res.json();
        if (data.id) {
            onStudentAdded(data);
            onSelectStudent(data.id);
            setSearchTerm(data.name);
            setIsOpen(false);
        }
    };

    return (
        <div ref={containerRef} className="position-relative">
            <label className="form-label">Student</label>
            <input
                ref={inputRef}
                type="text"
                className="form-control"
                placeholder="Search or create student..."
                value={searchTerm}
                onChange={e => {
                    setSearchTerm(e.target.value);
                    setIsOpen(true);
                }}
                onFocus={() => setIsOpen(true)}
            />
            {isOpen && (searchTerm || filtered.length > 0) && (
                <ul className={`list-group position-absolute w-100 mt-1 shadow ${isDark ? 'border-secondary' : ''}`} style={{ zIndex: 1000, maxHeight: 200, overflowY: 'auto', backgroundColor: isDark ? '#18181a' : undefined }}>
                    {filtered.slice(0, 5).map(s => (
                        <li
                            key={s.id}
                            className={`list-group-item d-flex justify-content-between align-items-center ${isDark ? 'text-white border-secondary' : ''}`}
                            style={{ cursor: 'pointer', backgroundColor: isDark ? '#18181a' : undefined }}
                            onMouseEnter={(e) => { if (isDark) e.target.style.backgroundColor = '#242427'; }}
                            onMouseLeave={(e) => { if (isDark) e.target.style.backgroundColor = '#18181a'; }}
                        >
                            <span style={{ flex: 1 }} onClick={() => handleSelect(s)}>{s.name}</span>
                            <button
                                className="btn btn-link p-0 text-muted"
                                style={{ minWidth: 24, minHeight: 24, lineHeight: 1, textDecoration: 'none' }}
                                title="Delete student"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (onDeleteStudent) onDeleteStudent(s);
                                }}
                            >
                                <Trash2 size={14} strokeWidth={2} />
                            </button>
                        </li>
                    ))}
                    {showCreate && (
                        <li
                            className={`list-group-item ${isDark ? 'text-primary fw-bold border-secondary' : ''}`}
                            style={{ cursor: 'pointer', backgroundColor: isDark ? '#18181a' : undefined }}
                            onMouseEnter={(e) => { if (isDark) e.target.style.backgroundColor = '#242427'; }}
                            onMouseLeave={(e) => { if (isDark) e.target.style.backgroundColor = '#18181a'; }}
                            onClick={handleCreate}
                        >
                            + Create "{searchTerm}"
                        </li>
                    )}
                </ul>
            )}
        </div>
    );
};

export default SmartStudentSelector;
