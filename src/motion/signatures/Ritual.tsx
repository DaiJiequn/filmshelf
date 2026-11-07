import { AnimatePresence, motion } from 'motion/react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Canister } from '../../components/Canister';
import { NumberRoll } from '../../components/NumberRoll';
import type { FilmStock } from '../../db/schema';
import { EASE_OUT, EASE_STD, scaled, SPRING, useMotionLevel } from '../tokens';

export type RitualKind = 'load' | 'unload' | 'stockin' | 'lab' | 'back' | 'light';

export interface RitualData {
  stock?: FilmStock;
  cameraName?: string;
  labName?: string;
  count?: number; // stockin/lab/back: 本次卷数
  remaining?: number; // load: 上卷后该品种剩余库存
  total?: number; // stockin: 入库后该品种库存
  litCount?: number;
  litTotal?: number;
}

interface RitualCtx {
  play: (kind: RitualKind, data: RitualData) => Promise<void>;
}
const Ctx = createContext<RitualCtx>({ play: async () => {} });
export const useRitual = () => useContext(Ctx);

/** 总时长（毫秒）：动画本身 + 停留一拍 */
const TOTAL_MS: Record<RitualKind, number> = { load: 1150, unload: 950, stockin: 1000, lab: 1050, back: 950, light: 1400 };

const CAM_W = 220;

function CameraSvg({ children }: { children?: React.ReactNode }) {
  return (
    <svg viewBox="0 0 200 130" width={CAM_W} height={(CAM_W * 130) / 200} aria-hidden="true">
      <rect x="10" y="34" width="180" height="84" rx="10" fill="#2b2724" stroke="#4a423b" strokeWidth="2" />
      <path d="M70 34 L82 16 H118 L130 34 Z" fill="#3a342f" stroke="#4a423b" strokeWidth="2" />
      <rect x="18" y="46" width="30" height="60" rx="5" fill="#15110f" />
      <circle cx="100" cy="78" r="28" fill="#14110f" stroke="#6d665f" strokeWidth="4" />
      <circle cx="100" cy="78" r="16" fill="#1d2a36" />
      <circle cx="94" cy="72" r="5" fill="#6fa8c9" opacity=".45" />
      <circle cx="168" cy="76" r="13" fill="#15110f" stroke="#6d665f" strokeWidth="2" />
      <circle cx="168" cy="76" r="4" fill="#6d665f" />
      <circle cx="162" cy="26" r="7" fill="#8a8178" />
      <rect x="22" y="44" width="22" height="3" fill="#6d665f" />
      {children}
    </svg>
  );
}

function Tag({ text, tone = 'idle', delay = 0 }: { text: string; tone?: 'idle' | 'on'; delay?: number }) {
  return (
    <motion.div
      className={`rtag ${tone === 'on' ? 'on' : ''}`}
      initial={{ rotateX: -90, opacity: 0 }}
      animate={{ rotateX: 0, opacity: 1 }}
      transition={{ delay, duration: 0.26, ease: EASE_OUT }}
    >
      {text}
    </motion.div>
  );
}

function Caption({ children, delay }: { children: React.ReactNode; delay: number }) {
  return (
    <motion.p className="rcap" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.24, ease: EASE_OUT }}>
      {children}
    </motion.p>
  );
}

/** 上卷 ≈0.9s：提起 → 飞入卷轴仓 → 片头牵向收片轴 → 库存 −1 → 相机牌翻为「在机」 */
function LoadScene({ d }: { d: RitualData }) {
  const [n, setN] = useState((d.remaining ?? 0) + 1);
  useEffect(() => {
    const t = window.setTimeout(() => setN(d.remaining ?? 0), 520);
    return () => window.clearTimeout(t);
  }, [d.remaining]);
  return (
    <>
      <motion.div className="stage" animate={{ scale: [1, 1, 1, 1.035, 1] }} transition={{ duration: 0.9, times: [0, 0.6, 0.72, 0.84, 1] }}>
        <div className="abs" style={{ marginLeft: -CAM_W / 2, marginTop: -72, width: CAM_W }}>
          <CameraSvg>
            <motion.path
              d="M 33 70 C 70 36, 130 36, 168 70"
              fill="none"
              stroke="#e8c98a"
              strokeWidth="3"
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ delay: 0.42, duration: 0.28, ease: EASE_STD }}
            />
          </CameraSvg>
        </div>
        <motion.div
          className="abs"
          style={{ marginLeft: -20, marginTop: -30, width: 40, height: 60 }}
          initial={{ x: -20, y: 118, scale: 1.5, opacity: 0, rotate: 0 }}
          animate={{ x: [-20, -20, -74], y: [118, 104, 14], scale: [1.5, 1.62, 0.78], opacity: 1, rotate: [0, -6, 0] }}
          transition={{ duration: 0.52, times: [0, 0.23, 1], ease: EASE_STD, opacity: { duration: 0.1 } }}
        >
          <Canister stock={d.stock} size={40} />
        </motion.div>
        <div className="abs rtag-wrap" style={{ marginLeft: -40, marginTop: 84, width: 80 }}>
          <motion.div initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ delay: 0.6, duration: 0.1 }} className="rtag idle-tag">空闲</motion.div>
          <div className="rtag-pos"><Tag text="在机" tone="on" delay={0.6} /></div>
        </div>
      </motion.div>
      <Caption delay={0.5}>
        {d.stock?.name} · 库存 <NumberRoll value={n} /> 卷
      </Caption>
      <Caption delay={0.62}>{d.cameraName}</Caption>
    </>
  );
}

/** 卸卷 ≈0.7s：牌翻回空闲，胶卷罐弹出相机 */
function UnloadScene({ d }: { d: RitualData }) {
  return (
    <>
      <div className="stage">
        <div className="abs" style={{ marginLeft: -CAM_W / 2, marginTop: -72, width: CAM_W }}>
          <CameraSvg />
        </div>
        <motion.div
          className="abs"
          style={{ marginLeft: -20, marginTop: -30, width: 40, height: 60 }}
          initial={{ x: -74, y: 14, scale: 0.78 }}
          animate={{ x: [-74, -74, 96], y: [14, -34, 84], scale: [0.78, 1.1, 1.25], rotate: [0, -4, 12] }}
          transition={{ duration: 0.55, delay: 0.1, times: [0, 0.4, 1], ease: EASE_STD }}
        >
          <Canister stock={d.stock} size={40} />
        </motion.div>
        <div className="abs rtag-wrap" style={{ marginLeft: -40, marginTop: 84, width: 80 }}>
          <motion.div initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 0.1 }} className="rtag on">在机</motion.div>
          <div className="rtag-pos"><Tag text="空闲" delay={0.12} /></div>
        </div>
      </div>
      <Caption delay={0.4}>已卸卷 · 等待送冲</Caption>
    </>
  );
}

/** 入库 ≈0.6s：胶卷罐依次落进货架，数字 +N */
function StockInScene({ d }: { d: RitualData }) {
  const k = Math.min(5, Math.max(1, d.count ?? 1));
  const base = (d.total ?? k) - (d.count ?? k);
  const [n, setN] = useState(base);
  useEffect(() => {
    const t = window.setTimeout(() => setN(d.total ?? k), 420);
    return () => window.clearTimeout(t);
  }, [d.total, k]);
  const gap = 46;
  return (
    <>
      <div className="stage">
        <div className="shelf-line abs" style={{ marginLeft: -120, marginTop: 38, width: 240 }} />
        {Array.from({ length: k }, (_, i) => (
          <motion.div
            key={i}
            className="abs"
            style={{ marginLeft: -20, marginTop: -30, width: 40, height: 60, left: `calc(50% + ${(i - (k - 1) / 2) * gap}px)` }}
            initial={{ y: -170, opacity: 0, rotate: (i % 2 ? 1 : -1) * 10 }}
            animate={{ y: 8, opacity: 1, rotate: 0 }}
            transition={{ ...SPRING.ritual, delay: i * 0.06, opacity: { duration: 0.1, delay: i * 0.06 } }}
          >
            <Canister stock={d.stock} size={40} />
          </motion.div>
        ))}
      </div>
      <Caption delay={0.2}>
        {d.stock?.name} 入库 +{d.count} · 现有 <NumberRoll value={n} /> 卷
      </Caption>
    </>
  );
}

function Bag({ children }: { children?: React.ReactNode }) {
  return (
    <svg viewBox="0 0 120 130" width="120" height="130" aria-hidden="true">
      <path d="M14 30 H106 L112 124 H8 Z" fill="#c9a574" stroke="#8c6d44" strokeWidth="2" />
      <path d="M14 30 H106" stroke="#8c6d44" strokeWidth="2" />
      <rect x="34" y="62" width="52" height="30" rx="3" fill="#f3e8d2" opacity=".85" />
      <text x="60" y="82" textAnchor="middle" fontSize="12" fontWeight="800" fill="#6b4f2b" fontFamily="system-ui">FILM</text>
      {children}
    </svg>
  );
}

/** 送冲 ≈0.7s：胶卷落入纸袋 → 袋口合上 → 纸袋上滑离开 */
function LabScene({ d }: { d: RitualData }) {
  const k = Math.min(3, Math.max(1, d.count ?? 1));
  return (
    <>
      <div className="stage">
        <motion.div
          className="abs"
          style={{ marginLeft: -60, marginTop: -50, width: 120, height: 130 }}
          initial={{ y: 0, opacity: 1 }}
          animate={{ y: [0, 0, -140], opacity: [1, 1, 0] }}
          transition={{ duration: 0.72, times: [0, 0.65, 1], ease: EASE_STD }}
        >
          <Bag />
          <motion.div
            className="bag-flap"
            initial={{ rotateX: -170 }}
            animate={{ rotateX: 0 }}
            transition={{ delay: 0.34, duration: 0.2, ease: EASE_OUT }}
          />
        </motion.div>
        {Array.from({ length: k }, (_, i) => (
          <motion.div
            key={i}
            className="abs"
            style={{ marginLeft: -20 + (i - (k - 1) / 2) * 22, marginTop: -30, width: 40, height: 60, zIndex: 3 }}
            initial={{ y: -120, scale: 1, opacity: 0 }}
            animate={{ y: [-120, 6], scale: [1, 0.7], opacity: [0, 1, 1, 0] }}
            transition={{ duration: 0.4, delay: i * 0.08, ease: EASE_STD, opacity: { times: [0, 0.15, 0.8, 1], duration: 0.4, delay: i * 0.08 } }}
          >
            <Canister stock={d.stock} size={40} />
          </motion.div>
        ))}
      </div>
      <Caption delay={0.5}>送冲 · {d.labName} · {d.count} 卷</Caption>
    </>
  );
}

/** 取回：纸袋落下，胶卷弹出 */
function BackScene({ d }: { d: RitualData }) {
  const k = Math.min(3, Math.max(1, d.count ?? 1));
  return (
    <>
      <div className="stage">
        <motion.div
          className="abs"
          style={{ marginLeft: -60, marginTop: -50, width: 120, height: 130 }}
          initial={{ y: -150, opacity: 0 }}
          animate={{ y: 20, opacity: 1 }}
          transition={{ ...SPRING.ritual, opacity: { duration: 0.12 } }}
        >
          <Bag />
        </motion.div>
        {Array.from({ length: k }, (_, i) => (
          <motion.div
            key={i}
            className="abs"
            style={{ marginLeft: -20 + (i - (k - 1) / 2) * 34, marginTop: -30, width: 40, height: 60, zIndex: 3 }}
            initial={{ y: 20, scale: 0.5, opacity: 0 }}
            animate={{ y: -52, scale: 1, opacity: 1 }}
            transition={{ ...SPRING.ritual, delay: 0.3 + i * 0.07 }}
          >
            <Canister stock={d.stock} size={40} />
          </motion.div>
        ))}
      </div>
      <Caption delay={0.4}>已取回 {d.count} 卷 · 去看看底片吧</Caption>
    </>
  );
}

/** 图鉴点亮 ≈0.8s：灰色剪影 → 光环扩散 → 彩色罐体弹出 */
function LightScene({ d }: { d: RitualData }) {
  const [n, setN] = useState(Math.max(0, (d.litCount ?? 1) - 1));
  useEffect(() => {
    const t = window.setTimeout(() => setN(d.litCount ?? 1), 450);
    return () => window.clearTimeout(t);
  }, [d.litCount]);
  return (
    <>
      <div className="stage">
        <motion.div
          className="glow abs"
          style={{ marginLeft: -50, marginTop: -50, width: 100, height: 100 }}
          initial={{ scale: 0.5, opacity: 0.9 }}
          animate={{ scale: 2.6, opacity: 0 }}
          transition={{ delay: 0.15, duration: 0.65, ease: EASE_OUT }}
        />
        <motion.div
          className="abs"
          style={{ marginLeft: -45, marginTop: -68, width: 90, height: 135 }}
          initial={{ opacity: 1, scale: 0.92 }}
          animate={{ opacity: 0 }}
          transition={{ delay: 0.2, duration: 0.2 }}
        >
          <Canister stock={d.stock} size={90} unlit />
        </motion.div>
        <motion.div
          className="abs"
          style={{ marginLeft: -45, marginTop: -68, width: 90, height: 135 }}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: [0.9, 1.14, 1] }}
          transition={{ delay: 0.2, duration: 0.5, times: [0, 0.55, 1], ease: EASE_OUT }}
        >
          <Canister stock={d.stock} size={90} />
        </motion.div>
      </div>
      <Caption delay={0.35}>图鉴点亮 · {d.stock?.brand} {d.stock?.name}</Caption>
      <Caption delay={0.45}>已点亮 <NumberRoll value={n} /> / {d.litTotal}</Caption>
    </>
  );
}

function LiteScene({ kind, d }: { kind: RitualKind; d: RitualData }) {
  const text: Record<RitualKind, string> = {
    load: `已上卷 · ${d.cameraName ?? ''}`,
    unload: '已卸卷',
    stockin: `已入库 ${d.count ?? ''} 卷`,
    lab: `已送冲 · ${d.labName ?? ''}`,
    back: '已取回',
    light: `图鉴点亮 ${d.litCount}/${d.litTotal}`,
  };
  return <p className="rcap lite">{text[kind]}</p>;
}

interface Active {
  kind: RitualKind;
  data: RitualData;
  resolve: () => void;
  id: number;
}

export function RitualProvider({ children }: { children: React.ReactNode }) {
  const level = useMotionLevel();
  const [active, setActive] = useState<Active | null>(null);
  const seq = useRef(0);
  const activeRef = useRef<Active | null>(null);
  activeRef.current = active;

  const finish = useCallback(() => {
    const a = activeRef.current;
    if (!a) return;
    setActive(null);
    a.resolve();
  }, []);

  const play = useCallback<RitualCtx['play']>(
    (kind, data) => {
      if (level === 'off') return Promise.resolve();
      return new Promise<void>((resolve) => {
        activeRef.current?.resolve();
        setActive({ kind, data, resolve, id: ++seq.current });
      });
    },
    [level],
  );

  useEffect(() => {
    if (!active) return;
    const ms = level === 'lite' ? 700 : TOTAL_MS[active.kind];
    const t = window.setTimeout(finish, ms);
    return () => window.clearTimeout(t);
  }, [active, level, finish]);

  const value = useMemo(() => ({ play }), [play]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <AnimatePresence>
        {active && (
          <motion.div
            key={active.id}
            className="ritual"
            role="status"
            aria-live="polite"
            onClick={finish}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: scaled(level, 0.14), ease: 'linear' }}
          >
            {level === 'lite' ? (
              <LiteScene kind={active.kind} d={active.data} />
            ) : (
              <div className="ritual-inner">
                {active.kind === 'load' && <LoadScene d={active.data} />}
                {active.kind === 'unload' && <UnloadScene d={active.data} />}
                {active.kind === 'stockin' && <StockInScene d={active.data} />}
                {active.kind === 'lab' && <LabScene d={active.data} />}
                {active.kind === 'back' && <BackScene d={active.data} />}
                {active.kind === 'light' && <LightScene d={active.data} />}
              </div>
            )}
            <span className="ritual-skip">轻触跳过</span>
          </motion.div>
        )}
      </AnimatePresence>
    </Ctx.Provider>
  );
}
