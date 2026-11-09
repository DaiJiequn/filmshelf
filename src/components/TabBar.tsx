import { motion } from 'motion/react';
import { NavLink, useLocation } from 'react-router-dom';
import { SPRING, useMotionLevel } from '../motion/tokens';

const TABS = [
  { to: '/', label: '底片', icon: 'M5 3h14a1 1 0 011 1v16a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1zM4 8h16M4 16h16M8 8v8M16 8v8' },
  { to: '/negatives', label: '底片柜', icon: 'M4 5h16v5H4zM4 14h16v5H4zM10 7.5h4M10 16.5h4' },
  { to: '/shoot', label: '拍摄', icon: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 100-7 3.5 3.5 0 000 7z' },
  { to: '/stock', label: '库存', icon: 'M5 4h14v4H5zM5 10h14v4H5zM5 16h14v4H5z' },
  { to: '/me', label: '我的', icon: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 20c0-4 4-6 8-6s8 2 8 6z' },
];

export function TabBar() {
  const { pathname } = useLocation();
  const level = useMotionLevel();
  const active = (to: string) =>
    to === '/' ? pathname === '/' || /^\/roll\/[^/]+\/scans/.test(pathname)
    : to === '/stock' ? pathname.startsWith('/stock') || pathname.startsWith('/catalog')
    : pathname.startsWith(to);
  return (
    <nav className="tabbar" aria-label="主导航">
      {TABS.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.to === '/'} className={`tab ${active(t.to) ? 'on' : ''}`}>
          {active(t.to) && (
            <motion.span
              layoutId="tab-pill"
              className="tab-pill"
              transition={level === 'off' ? { duration: 0 } : SPRING.snappy}
            />
          )}
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d={t.icon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          </svg>
          <span>{t.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
