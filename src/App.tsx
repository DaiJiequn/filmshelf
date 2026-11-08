import { motion } from 'motion/react';
import { useEffect, useMemo, useRef } from 'react';
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom';
import { SheetsProvider } from './components/SheetHost';
import { TabBar } from './components/TabBar';
import { ToastProvider } from './components/Toast';
import { useSettings } from './lib/hooks';
import { UpdatePrompt } from './components/UpdatePrompt';
import { maybeAutoBackup } from './lib/autobackup';
import { maybeAutoSync } from './lib/gdrive';
import { MotionContext, scaled, useMotionLevel, type MotionLevel } from './motion/tokens';
import { RitualProvider } from './motion/signatures/Ritual';
import Catalog from './pages/Catalog';
import Home from './pages/Home';
import { Backup, Cameras, Labs, Locations, Me, SettingsPage } from './pages/Me';
import Negatives from './pages/Negatives';
import Playground from './pages/Playground';
import RollDetail from './pages/RollDetail';
import Scans from './pages/Scans';
import Stock from './pages/Stock';
import StockDetail from './pages/StockDetail';

function useReducedMotion(): boolean {
  const q = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : undefined;
  return !!q?.matches;
}

const TAB_ORDER = ['/', '/stock', '/catalog', '/negatives', '/me'];
const depthOf = (p: string) => p.split('/').filter(Boolean).length;
const tabOf = (p: string) => TAB_ORDER.indexOf('/' + (p.split('/')[1] ?? ''));

/** 页面切换的方向：同级标签按左右顺序滑；进入子页从右边推入，返回从左边回来。 */
function pageDir(from: string, to: string): number {
  if (from === to) return 0;
  const a = tabOf(from), b = tabOf(to);
  if (a !== b && a >= 0 && b >= 0 && depthOf(from) <= 1 && depthOf(to) <= 1) return Math.sign(b - a);
  const da = depthOf(from), db = depthOf(to);
  if (db !== da) return Math.sign(db - da);
  return 0;
}

function Pages() {
  const loc = useLocation();
  const level = useMotionLevel();
  const prev = useRef(loc.pathname);
  const dir = pageDir(prev.current, loc.pathname);
  useEffect(() => { prev.current = loc.pathname; }, [loc.pathname]);
  const key = loc.pathname;
  const x = level === 'full' ? dir * 28 : 0;
  return (
    <motion.main key={key} className="app-main" initial={{ opacity: 0, y: dir ? 0 : 6, x }} animate={{ opacity: 1, y: 0, x: 0 }} transition={{ duration: scaled(level, 0.28), ease: [0.2, 0, 0, 1] }}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/stock" element={<Stock />} />
        <Route path="/roll/:id" element={<RollDetail />} />
        <Route path="/roll/:id/scans" element={<Scans />} />
        <Route path="/catalog" element={<Catalog />} />
        <Route path="/catalog/:id" element={<StockDetail />} />
        <Route path="/negatives" element={<Negatives />} />
        <Route path="/me" element={<Me />} />
        <Route path="/me/cameras" element={<Cameras />} />
        <Route path="/me/labs" element={<Labs />} />
        <Route path="/me/locations" element={<Locations />} />
        <Route path="/me/backup" element={<Backup />} />
        <Route path="/me/settings" element={<SettingsPage />} />
        <Route path="/me/lab" element={<Playground />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </motion.main>
  );
}

export default function App() {
  const [settings] = useSettings();
  const reduced = useReducedMotion();
  const level: MotionLevel = settings.motionLevel === 'off' ? 'off' : reduced && settings.motionLevel === 'full' ? 'lite' : settings.motionLevel;
  const ctx = useMemo(() => ({ level }), [level]);

  useEffect(() => {
    document.documentElement.dataset.motion = level;
  }, [level]);

  // 自动备份：打开应用、以及回到前台时检查一次（到期才会真正备份）
  useEffect(() => {
    const t = setTimeout(() => { maybeAutoBackup().catch(() => {}); maybeAutoSync().catch(() => {}); }, 4000);
    const onVis = () => { if (document.visibilityState === 'visible') maybeAutoBackup().catch(() => {}); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  return (
    <MotionContext.Provider value={ctx}>
      <ToastProvider>
        <RitualProvider>
          <HashRouter>
            <SheetsProvider>
              <div className="app">
                <Pages />
                <UpdatePrompt />
                <TabBar />
              </div>
            </SheetsProvider>
          </HashRouter>
        </RitualProvider>
      </ToastProvider>
    </MotionContext.Provider>
  );
}
