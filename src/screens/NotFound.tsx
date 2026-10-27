import { Link } from 'react-router-dom';
import TopBar from '../components/TopBar';

export default function NotFound({ message = 'This page does not exist.' }: { message?: string }) {
  return (
    <div className="screen">
      <TopBar back="/" />
      <main className="content empty">
        <p>{message}</p>
        <Link to="/" className="btn">
          Back to library
        </Link>
      </main>
    </div>
  );
}
