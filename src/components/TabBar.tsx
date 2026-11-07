import { motion } from 'motion/react';
import { NavLink, useLocation } from 'react-router-dom';
import { SPRING, useMotionLevel } from '../motion/tokens';

const TABS = [
  { to: '/', label: '首页', icon: 'M4 11l8-7 8 7v8a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1z' },
  { to: '/stock', label: '库存', icon: 'M5 4h14v4H5zM5 10h14v4H5zM5 16h14v4H5z' },
  { to: '/catalog', label: '图鉴', icon: 'M4 5a1 1 0 011-1h6v16H5a1 1 0 01-1-1zM13 4h6a1 1 0 011 1v14a1 1 0 01-1 1h-6z' },
  { to: '/me', label: '我的', icon: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 20c0-4 4-6 8-6s8 2 8 6z' },
];

export function TabBar() {
  const { pathname } = useLocation();
  const level = useMotionLevel();
  const active = (to: string) => (to === '/' ? pathname === '/' : to === '/me' ? pathname.startsWith('/me') || pathname.startsWith('/negatives') : pathname.startsWith(to));
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
