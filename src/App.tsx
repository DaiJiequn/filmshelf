import { motion } from 'motion/react';
import { useEffect, useMemo } from 'react';
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom';
import { SheetsProvider } from './components/SheetHost';
import { TabBar } from './components/TabBar';
import { ToastProvider } from './components/Toast';
import { useSettings } from './lib/hooks';
import { MotionContext, type MotionLevel } from './motion/tokens';
import { RitualProvider } from './motion/signatures/Ritual';
import Catalog from './pages/Catalog';
import Home from './pages/Home';
import { Backup, Cameras, Labs, Locations, Me, SettingsPage } from './pages/Me';
import Negatives from './pages/Negatives';
import Playground from './pages/Playground';
import RollDetail from './pages/RollDetail';
import Stock from './pages/Stock';
import StockDetail from './pages/StockDetail';

function useReducedMotion(): boolean {
  const q = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : undefined;
  return !!q?.matches;
}

function Pages() {
  const loc = useLocation();
  const key = loc.pathname.split('/').slice(0, 2).join('/');
  return (
    <motion.main key={key} className="app-main" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/stock" element={<Stock />} />
        <Route path="/roll/:id" element={<RollDetail />} />
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

  return (
    <MotionContext.Provider value={ctx}>
      <ToastProvider>
        <RitualProvider>
          <HashRouter>
            <SheetsProvider>
              <div className="app">
                <Pages />
                <TabBar />
              </div>
            </SheetsProvider>
          </HashRouter>
        </RitualProvider>
      </ToastProvider>
    </MotionContext.Provider>
  );
}
