import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon';

/** Screen header: optional back link, a title, and optional actions on the right. */
export default function TopBar({ back, title, actions }: { back?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="topbar">
      {back ? (
        <Link to={back} className="icon-btn" aria-label="Back">
          <Icon name="back" />
        </Link>
      ) : null}
      <div className="topbar-title">{title}</div>
      <div className="topbar-actions">{actions}</div>
    </header>
  );
}
