import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';

export default function NotFoundPage() {
  return (
    <div className="min-vh-100 w-100 d-flex flex-column align-items-center justify-content-center" style={{ padding: '2rem' }}>
      <div className="not-found-card">
        <div className="d-flex justify-content-center mb-4">
          <Compass size={64} strokeWidth={1.2} className="not-found-icon" />
        </div>
        <h1 className="not-found-title">404</h1>
        <p className="not-found-subtitle">Page Not Found</p>
        <p className="not-found-desc">The route you requested does not exist in this domain.</p>
        <Link to="/" className="not-found-btn">Return Home</Link>
      </div>
    </div>
  );
}
