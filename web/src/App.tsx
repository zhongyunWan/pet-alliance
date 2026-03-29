import React, { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ──

interface Pet {
  id: string;
  name: string;
  species: string;
  breed: string;
  age: number;
  weight: number;
}

interface AgentMessage {
  id: string;
  from: string;
  to: string;
  type: string;
  payload: unknown;
  round: number;
  timestamp: number;
}

interface Gene {
  id: string;
  category: string;
  signals_match: string[];
  strategy: string[];
  version: number;
  pet_experience?: {
    condition: string;
    species: string;
    breed?: string;
    treatments: Array<{ method: string; effectiveness: number; notes?: string }>;
    dietAdjustments?: string[];
    preventionTips?: string[];
    confidence: number;
    sampleSize: number;
  };
}

interface Recommendation {
  title: string;
  description: string;
  priority: 'urgent' | 'high' | 'normal';
  metadata?: { source: string };
}

interface Conflict { description: string; resolution: string; }
interface AgentProposal { agentId: string; domain: string; items: unknown[]; durationMs: number; confidence: number; }

interface ConsultResult {
  status: string;
  message?: string;
  result?: {
    id: string;
    recommendations: Recommendation[];
    negotiationRounds: number;
    processingTimeMs: number;
    genesApplied: string[];
  };
  conflicts?: Conflict[];
  agentProposals?: AgentProposal[];
}

// ── Constants ──

const MAX_MESSAGES = 200;

const DOMAIN_LABEL: Record<string, string> = {
  'health-agent': '健康',
  'diet-agent': '营养',
  'medical-agent': '医疗',
  'boarding-agent': '寄养',
};

const SCENARIOS = [
  { text: '我家猫掉毛严重，皮肤有圆形红斑' },
  { text: '下周出差5天，猫在吃药，谁能帮忙？' },
  { text: '3岁英短需要做什么疫苗和驱虫？' },
];

type Tab = 'consult' | 'genes';

const CAT_BREEDS = [
  '英短蓝猫', '橘猫', '美短虎斑', '布偶猫', '暹罗猫',
  '狸花猫', '金渐层', '银渐层', '缅因猫', '三花猫',
];

// ── Cat SVG Illustration ──

function CatIllustration({ className = '' }: { className?: string }) {
  return (
    <div className={`breathe ${className}`}>
      <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        {/* Body */}
        <ellipse cx="100" cy="130" rx="52" ry="40" fill="#d6d3d1" />
        {/* Head */}
        <circle cx="100" cy="82" r="34" fill="#d6d3d1" />
        {/* Left ear */}
        <path d="M72 60 L62 30 L86 52 Z" fill="#d6d3d1" />
        <path d="M74 58 L66 36 L84 54 Z" fill="#c4b5a8" />
        {/* Right ear */}
        <path d="M128 60 L138 30 L114 52 Z" fill="#d6d3d1" />
        <path d="M126 58 L134 36 L116 54 Z" fill="#c4b5a8" />
        {/* Eyes */}
        <ellipse cx="87" cy="78" rx="5" ry="6" fill="#44403c" />
        <ellipse cx="113" cy="78" rx="5" ry="6" fill="#44403c" />
        <circle cx="85" cy="76" r="2" fill="white" opacity="0.7" />
        <circle cx="111" cy="76" r="2" fill="white" opacity="0.7" />
        {/* Nose */}
        <path d="M97 88 L100 92 L103 88 Z" fill="#a8a29e" />
        {/* Mouth */}
        <path d="M100 92 Q96 97 92 95" stroke="#a8a29e" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        <path d="M100 92 Q104 97 108 95" stroke="#a8a29e" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        {/* Whiskers */}
        <line x1="60" y1="82" x2="82" y2="86" stroke="#a8a29e" strokeWidth="1" opacity="0.5" />
        <line x1="58" y1="90" x2="81" y2="89" stroke="#a8a29e" strokeWidth="1" opacity="0.5" />
        <line x1="118" y1="86" x2="140" y2="82" stroke="#a8a29e" strokeWidth="1" opacity="0.5" />
        <line x1="119" y1="89" x2="142" y2="90" stroke="#a8a29e" strokeWidth="1" opacity="0.5" />
        {/* Front paws */}
        <ellipse cx="78" cy="162" rx="12" ry="8" fill="#d6d3d1" />
        <ellipse cx="122" cy="162" rx="12" ry="8" fill="#d6d3d1" />
        {/* Tail */}
        <path d="M148 135 Q170 120 165 100 Q162 90 155 95" stroke="#d6d3d1" strokeWidth="10" fill="none" strokeLinecap="round" />
      </svg>
    </div>
  );
}

// ── Pet Form (shared between onboarding and modal) ──

interface PetFormData {
  name: string;
  breed: string;
  customBreed: string;
  age: string;
  weight: string;
}

function PetForm({
  form,
  setForm,
  onSubmit,
  submitting,
  isModal,
}: {
  form: PetFormData;
  setForm: React.Dispatch<React.SetStateAction<PetFormData>>;
  onSubmit: () => void;
  submitting: boolean;
  isModal?: boolean;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const isValid = form.name.trim().length > 0 && (form.breed !== '' || form.customBreed.trim().length > 0);

  useEffect(() => {
    const timer = setTimeout(() => nameRef.current?.focus(), isModal ? 400 : 800);
    return () => clearTimeout(timer);
  }, [isModal]);

  return (
    <div className="space-y-7">
      {/* Name */}
      <div>
        <label className="block text-[10px] tracking-[0.2em] uppercase text-stone-400 mb-3">猫咪名字</label>
        <div className="input-glow rounded-2xl transition-shadow">
          <input
            ref={nameRef}
            type="text"
            value={form.name}
            onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
            placeholder="给你的猫咪取个名字"
            className="w-full px-5 py-4 text-[16px] text-stone-900 bg-white rounded-2xl border-0 focus:outline-none placeholder:text-stone-300"
            style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
            maxLength={20}
          />
        </div>
      </div>

      {/* Breed */}
      <div>
        <label className="block text-[10px] tracking-[0.2em] uppercase text-stone-400 mb-3">品种</label>
        <div className="flex flex-wrap gap-2 mb-3">
          {CAT_BREEDS.map(b => (
            <button
              key={b}
              onClick={() => setForm(prev => ({ ...prev, breed: prev.breed === b ? '' : b, customBreed: '' }))}
              className={`px-3.5 py-2 rounded-xl text-[13px] transition-all active:scale-[0.96] ${
                form.breed === b
                  ? 'bg-stone-900 text-white font-medium'
                  : 'bg-white text-stone-600'
              }`}
              style={{ boxShadow: form.breed === b ? 'none' : '0 1px 3px rgba(0,0,0,0.04)' }}
            >
              {b}
            </button>
          ))}
        </div>
        <div className="input-glow rounded-2xl transition-shadow">
          <input
            type="text"
            value={form.customBreed}
            onChange={e => setForm(prev => ({ ...prev, customBreed: e.target.value, breed: '' }))}
            placeholder="其他品种..."
            className="w-full px-5 py-3.5 text-[14px] text-stone-900 bg-white rounded-2xl border-0 focus:outline-none placeholder:text-stone-300"
            style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
          />
        </div>
      </div>

      {/* Age & Weight */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase text-stone-400 mb-3">年龄</label>
          <div className="input-glow rounded-2xl transition-shadow">
            <div className="relative">
              <input
                type="number"
                value={form.age}
                onChange={e => setForm(prev => ({ ...prev, age: e.target.value }))}
                placeholder="1"
                min="0"
                max="30"
                className="w-full px-5 py-3.5 pr-10 text-[14px] text-stone-900 bg-white rounded-2xl border-0 focus:outline-none placeholder:text-stone-300"
                style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[12px] text-stone-300">岁</span>
            </div>
          </div>
        </div>
        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase text-stone-400 mb-3">体重</label>
          <div className="input-glow rounded-2xl transition-shadow">
            <div className="relative">
              <input
                type="number"
                value={form.weight}
                onChange={e => setForm(prev => ({ ...prev, weight: e.target.value }))}
                placeholder="4"
                min="0"
                max="50"
                step="0.1"
                className="w-full px-5 py-3.5 pr-10 text-[14px] text-stone-900 bg-white rounded-2xl border-0 focus:outline-none placeholder:text-stone-300"
                style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[12px] text-stone-300">kg</span>
            </div>
          </div>
        </div>
      </div>

      {/* Submit */}
      <button
        onClick={onSubmit}
        disabled={!isValid || submitting}
        className="w-full py-4 bg-stone-900 text-white text-[15px] font-semibold tracking-wide rounded-2xl disabled:opacity-20 active:bg-stone-800 transition-all"
      >
        {submitting ? '建档中...' : isModal ? '添加猫咪' : '开始使用'}
      </button>
    </div>
  );
}

// ── Onboarding Screen ──

// Onboarding content (renders inside phone frame or full-screen)
function OnboardingContent({ onSubmit, form, setForm, submitting, exiting }: {
  onSubmit: () => void;
  form: PetFormData;
  setForm: React.Dispatch<React.SetStateAction<PetFormData>>;
  submitting: boolean;
  exiting: boolean;
}) {
  return (
    <div className={`flex flex-col min-h-full ${exiting ? 'onboarding-exit' : ''}`}>
      <div className="flex-1 flex flex-col justify-center px-7 py-10">
        {/* Header */}
        <div className="text-center mb-8 float-in">
          <CatIllustration className="w-28 h-28 mx-auto mb-5" />
          <p className="text-[10px] tracking-[0.3em] uppercase text-stone-400 mb-3">Pet Alliance</p>
          <h1 className="font-serif text-[28px] font-black text-stone-900 tracking-tight leading-tight">
            欢迎来到养宠联盟
          </h1>
          <p className="text-stone-400 text-[13px] mt-2.5 leading-relaxed">
            先为你的猫咪建个档案吧
          </p>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-4 mb-7 float-in" style={{ animationDelay: '0.15s' }}>
          <div className="flex-1 h-px bg-stone-200" />
          <span className="text-[9px] tracking-[0.3em] uppercase text-stone-300">cat profile</span>
          <div className="flex-1 h-px bg-stone-200" />
        </div>

        {/* Form */}
        <div className="float-in" style={{ animationDelay: '0.25s' }}>
          <PetForm
            form={form}
            setForm={setForm}
            onSubmit={onSubmit}
            submitting={submitting}
          />
        </div>
      </div>
    </div>
  );
}

function OnboardingScreen({ onComplete }: { onComplete: (pet: Pet) => void }) {
  const [form, setForm] = useState<PetFormData>({
    name: '', breed: '', customBreed: '', age: '', weight: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [exiting, setExiting] = useState(false);

  const handleSubmit = async () => {
    const breed = form.breed || form.customBreed.trim();
    if (!form.name.trim() || !breed) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/pets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          species: 'cat',
          breed,
          age: form.age ? Number(form.age) : 1,
          weight: form.weight ? Number(form.weight) : 4,
          gender: 'male',
          indoor: true,
          vaccinations: [],
          medicalHistory: [],
          allergies: [],
          currentMedications: [],
        }),
      });
      const data = await res.json();
      if (data.pet) {
        setExiting(true);
        setTimeout(() => onComplete(data.pet), 600);
      }
    } catch {
      setSubmitting(false);
    }
  };

  const contentProps = { onSubmit: handleSubmit, form, setForm, submitting, exiting };

  return (
    <>
      {/* ═══ Desktop: phone mockup ═══ */}
      <div className="hidden md:flex items-center justify-center min-h-screen" style={{ background: '#e8e6e1' }}>
        <div className="relative" style={{ width: 390, height: 844 }}>
          {/* Bezel */}
          <div className="absolute inset-0 rounded-[48px] pointer-events-none z-10"
            style={{ boxShadow: '0 50px 100px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.08)' }} />
          {/* Dynamic Island */}
          <div className="absolute top-[8px] left-1/2 -translate-x-1/2 z-20">
            <div className="w-[120px] h-[34px] bg-stone-900 rounded-[20px]" />
          </div>
          {/* Home indicator */}
          <div className="absolute bottom-[10px] left-1/2 -translate-x-1/2 w-[134px] h-[5px] rounded-full bg-black/10 z-20" />
          {/* Screen */}
          <div className="absolute inset-0 rounded-[48px] overflow-hidden bg-[#faf9f7]">
            <div className="w-full h-full overflow-y-auto no-scrollbar">
              <div className="h-14 shrink-0" />
              <OnboardingContent {...contentProps} />
              <div className="h-6 shrink-0" />
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Mobile: full screen ═══ */}
      <div className="md:hidden min-h-screen" style={{ background: '#faf9f7' }}>
        <OnboardingContent {...contentProps} />
      </div>
    </>
  );
}

// ── Add Pet Modal ──

function AddPetModal({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: (pet: Pet) => void;
}) {
  const [form, setForm] = useState<PetFormData>({
    name: '', breed: '', customBreed: '', age: '', weight: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [closing, setClosing] = useState(false);

  const doClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      onClose();
      setForm({ name: '', breed: '', customBreed: '', age: '', weight: '' });
    }, 280);
  }, [onClose]);

  const handleSubmit = async () => {
    const breed = form.breed || form.customBreed.trim();
    if (!form.name.trim() || !breed) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/pets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          species: 'cat',
          breed,
          age: form.age ? Number(form.age) : 1,
          weight: form.weight ? Number(form.weight) : 4,
          gender: 'male',
          indoor: true,
          vaccinations: [],
          medicalHistory: [],
          allergies: [],
          currentMedications: [],
        }),
      });
      const data = await res.json();
      if (data.pet) {
        onAdded(data.pet);
        setForm({ name: '', breed: '', customBreed: '', age: '', weight: '' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className={`fixed inset-0 z-50 flex items-end md:items-center justify-center ${closing ? 'modal-overlay-exit' : 'modal-overlay'}`}
      style={{ background: 'rgba(28, 25, 23, 0.5)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}>
      {/* Backdrop click */}
      <div className="absolute inset-0" onClick={doClose} />

      {/* Sheet */}
      <div className={`relative w-full max-w-[420px] max-h-[90vh] overflow-y-auto no-scrollbar bg-[#faf9f7] rounded-t-[28px] md:rounded-[28px] ${closing ? 'modal-sheet-exit' : 'modal-sheet'}`}>
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 md:hidden">
          <div className="w-10 h-1 rounded-full bg-stone-300" />
        </div>

        {/* Close button */}
        <button onClick={doClose}
          className="absolute top-5 right-5 w-8 h-8 rounded-full bg-stone-200/60 flex items-center justify-center text-stone-400 hover:bg-stone-200 transition-colors z-10">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="px-7 pt-7 pb-10">
          {/* Header */}
          <div className="text-center mb-6">
            <CatIllustration className="w-20 h-20 mx-auto mb-4" />
            <h2 className="font-serif text-[24px] font-black text-stone-900 tracking-tight">添加新猫咪</h2>
            <p className="text-stone-400 text-[13px] mt-1.5">为你的新伙伴建个档案</p>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-4 mb-6">
            <div className="flex-1 h-px bg-stone-200" />
            <span className="text-[9px] tracking-[0.3em] uppercase text-stone-300">new cat</span>
            <div className="flex-1 h-px bg-stone-200" />
          </div>

          <PetForm
            form={form}
            setForm={setForm}
            onSubmit={handleSubmit}
            submitting={submitting}
            isModal
          />
        </div>
      </div>
    </div>
  );
}

// ── Consult Loading ──

const LOADING_PHASES = [
  '正在召集专家团队…',
  '分析健康数据…',
  '营养评估中…',
  '制定综合方案…',
  '交叉验证建议…',
];

// Small orbiting pet illustrations for loading animation
function OrbitPetA() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Small cat sitting */}
      <ellipse cx="18" cy="24" rx="8" ry="6" fill="#d6d3d1" />
      <circle cx="18" cy="14" r="6.5" fill="#d6d3d1" />
      {/* Ears */}
      <path d="M13 9 L11 3 L15.5 8 Z" fill="#d6d3d1" />
      <path d="M13.5 8.5 L12 4.5 L15 8 Z" fill="#c4b5a8" />
      <path d="M23 9 L25 3 L20.5 8 Z" fill="#d6d3d1" />
      <path d="M22.5 8.5 L24 4.5 L21 8 Z" fill="#c4b5a8" />
      {/* Eyes — wide open curious */}
      <circle cx="15.5" cy="13" r="1.5" fill="#44403c" />
      <circle cx="20.5" cy="13" r="1.5" fill="#44403c" />
      <circle cx="15" cy="12.3" r="0.5" fill="white" opacity="0.7" />
      <circle cx="20" cy="12.3" r="0.5" fill="white" opacity="0.7" />
      {/* Nose */}
      <path d="M17 16 L18 17.2 L19 16 Z" fill="#a8a29e" />
      {/* Tail */}
      <path d="M25 22 Q29 18 28 13" stroke="#d6d3d1" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function OrbitPetB() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Small dog sitting */}
      <ellipse cx="18" cy="25" rx="7.5" ry="5.5" fill="#c4b5a8" />
      <circle cx="18" cy="15" r="6" fill="#c4b5a8" />
      {/* Floppy ears */}
      <ellipse cx="11.5" cy="15" rx="3" ry="5" fill="#b8a898" transform="rotate(-10 11.5 15)" />
      <ellipse cx="24.5" cy="15" rx="3" ry="5" fill="#b8a898" transform="rotate(10 24.5 15)" />
      {/* Eyes — happy */}
      <circle cx="15.5" cy="14" r="1.3" fill="#44403c" />
      <circle cx="20.5" cy="14" r="1.3" fill="#44403c" />
      <circle cx="15.2" cy="13.3" r="0.45" fill="white" opacity="0.7" />
      <circle cx="20.2" cy="13.3" r="0.45" fill="white" opacity="0.7" />
      {/* Nose */}
      <ellipse cx="18" cy="17" rx="1.5" ry="1" fill="#78716c" />
      {/* Tongue */}
      <path d="M18 18 Q18.5 20 18 21" stroke="#d4a0a0" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      {/* Tail */}
      <path d="M25 23 Q30 19 29 15" stroke="#c4b5a8" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function ConsultLoading() {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPhase(p => (p + 1) % LOADING_PHASES.length), 2800);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="px-6 py-8 reveal">
      <div className="relative mx-auto" style={{ width: 240, height: 240 }}>
        {/* Orbit ring */}
        <div className="absolute inset-6 rounded-full" style={{ border: '1px dashed #e0ddd8' }} />

        {/* Center cat — thinking pose */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 loading-cat-breathe">
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            <ellipse cx="32" cy="42" rx="16" ry="12" fill="#d6d3d1" />
            <circle cx="32" cy="26" r="11" fill="#d6d3d1" />
            <path d="M23 19 L19 8 L28 16 Z" fill="#d6d3d1" />
            <path d="M24 18 L21 10 L27 16 Z" fill="#c4b5a8" />
            <path d="M41 19 L45 8 L36 16 Z" fill="#d6d3d1" />
            <path d="M40 18 L43 10 L37 16 Z" fill="#c4b5a8" />
            <path d="M27 25 Q29 27 31 25" stroke="#78716c" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            <path d="M33 25 Q35 27 37 25" stroke="#78716c" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            <path d="M30.5 29 L32 31 L33.5 29 Z" fill="#a8a29e" />
            <path d="M47 39 Q55 32 53 24 Q52 20 49 22" stroke="#d6d3d1" strokeWidth="4" fill="none" strokeLinecap="round" className="loading-tail-wag" />
            <circle cx="50" cy="14" r="2" fill="#d6d3d1" className="loading-thought-1" />
            <circle cx="54" cy="8" r="3" fill="#d6d3d1" className="loading-thought-2" />
          </svg>
        </div>

        {/* Orbiting pet A — small cat */}
        <div className="absolute left-1/2 top-1/2 loading-orbit"
          style={{ width: 0, height: 0, ['--start-angle' as string]: '0deg' }}>
          <div className="absolute -translate-x-1/2 -translate-y-1/2 loading-orbit-counter"
            style={{ left: 0, top: -96 }}>
            <OrbitPetA />
          </div>
        </div>

        {/* Orbiting pet B — small dog */}
        <div className="absolute left-1/2 top-1/2 loading-orbit"
          style={{ width: 0, height: 0, ['--start-angle' as string]: '180deg' }}>
          <div className="absolute -translate-x-1/2 -translate-y-1/2 loading-orbit-counter"
            style={{ left: 0, top: -96 }}>
            <OrbitPetB />
          </div>
        </div>
      </div>

      {/* Phase text */}
      <div className="text-center mt-4 h-8 flex items-center justify-center">
        <p key={phase} className="text-[13px] text-stone-500 font-medium loading-phase-text">
          {LOADING_PHASES[phase]}
        </p>
      </div>


    </div>
  );
}

// ── Cat Avatar Button ──

function CatAvatar({ onClick, genesCount, connected }: { onClick: () => void; genesCount: number; connected: boolean }) {
  return (
    <button onClick={onClick} className="relative group active:scale-[0.92] transition-transform" aria-label="基因库">
      <div className="w-10 h-10 rounded-full overflow-hidden" style={{ background: '#eae8e4', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
        <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
          {/* Head */}
          <circle cx="20" cy="22" r="11" fill="#d6d3d1" />
          {/* Left ear */}
          <path d="M12 15 L9 5 L16 13 Z" fill="#d6d3d1" />
          <path d="M12.5 14 L10.5 7 L15 13 Z" fill="#c4b5a8" />
          {/* Right ear */}
          <path d="M28 15 L31 5 L24 13 Z" fill="#d6d3d1" />
          <path d="M27.5 14 L29.5 7 L25 13 Z" fill="#c4b5a8" />
          {/* Eyes */}
          <ellipse cx="16.5" cy="20.5" rx="1.8" ry="2.2" fill="#44403c" />
          <ellipse cx="23.5" cy="20.5" rx="1.8" ry="2.2" fill="#44403c" />
          <circle cx="16" cy="19.5" r="0.7" fill="white" opacity="0.7" />
          <circle cx="23" cy="19.5" r="0.7" fill="white" opacity="0.7" />
          {/* Nose */}
          <path d="M19 24 L20 25.5 L21 24 Z" fill="#a8a29e" />
          {/* Mouth */}
          <path d="M20 25.5 Q18.5 27 17.5 26.2" stroke="#a8a29e" strokeWidth="0.6" fill="none" strokeLinecap="round" />
          <path d="M20 25.5 Q21.5 27 22.5 26.2" stroke="#a8a29e" strokeWidth="0.6" fill="none" strokeLinecap="round" />
        </svg>
      </div>
      {/* Connection indicator */}
      <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#faf9f7] ${connected ? 'bg-green-500' : 'bg-stone-300'}`} />
      {/* Gene count badge */}
      {genesCount > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center text-[9px] font-bold text-white bg-stone-900 rounded-full">
          {genesCount}
        </span>
      )}
    </button>
  );
}

// ── Gene Card ──

function GeneCard({ gene, index }: { gene: Gene; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);

  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight);
    }
  }, [expanded, gene]);

  const exp = gene.pet_experience;
  const categoryConfig = {
    optimize: { label: '优化', color: '#16a34a', bg: 'rgba(22,163,74,0.06)', border: 'rgba(22,163,74,0.12)' },
    innovate: { label: '创新', color: '#2563eb', bg: 'rgba(37,99,235,0.06)', border: 'rgba(37,99,235,0.12)' },
    fix: { label: '修复', color: '#dc2626', bg: 'rgba(220,38,38,0.06)', border: 'rgba(220,38,38,0.12)' },
  }[gene.category] || { label: gene.category, color: '#78716c', bg: 'rgba(120,113,108,0.06)', border: 'rgba(120,113,108,0.12)' };

  const speciesEmoji = exp?.species === 'cat' ? '🐱' : exp?.species === 'dog' ? '🐶' : '🐾';
  const topTreatment = exp?.treatments?.[0];

  return (
    <div
      className="reveal gene-card group"
      style={{ animationDelay: `${index * 0.08}s` }}
      onClick={() => setExpanded(!expanded)}
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <span className="gene-category-pill" style={{
              background: categoryConfig.bg,
              border: `1px solid ${categoryConfig.border}`,
              color: categoryConfig.color,
            }}>
              <span className="gene-category-dot" style={{ background: categoryConfig.color }} />
              {categoryConfig.label}
            </span>
            {exp?.breed && (
              <span className="text-[11px] text-stone-400 tracking-wide">
                {speciesEmoji} {exp.breed}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
<svg
              width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className={`text-stone-300 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
        </div>

        {/* Title */}
        <h3 className="font-serif text-[16px] font-bold text-stone-900 leading-snug tracking-tight">
          {exp?.condition || gene.id}
        </h3>

        {/* Quick stats bar */}
        {exp && (
          <div className="flex items-center gap-4 mt-3 pb-4">
            {topTreatment && (
              <div className="flex items-center gap-1.5">
                <div className="gene-effectiveness-ring" style={{
                  background: `conic-gradient(${categoryConfig.color} ${topTreatment.effectiveness * 360}deg, #e7e5e4 0deg)`
                }}>
                  <div className="gene-effectiveness-inner" />
                </div>
                <span className="text-[11px] text-stone-500">{Math.round(topTreatment.effectiveness * 100)}%</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a8a29e" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
              </svg>
              <span className="text-[11px] text-stone-400">{exp.treatments.length} 方案</span>
            </div>
          </div>
        )}
      </div>

      {/* Expandable detail section */}
      <div
        className="gene-expand-wrapper"
        style={{
          maxHeight: expanded ? `${contentHeight}px` : '0px',
          opacity: expanded ? 1 : 0,
        }}
      >
        <div ref={contentRef}>
          {/* Divider */}
          <div className="mx-5 h-px" style={{ background: 'linear-gradient(90deg, transparent, #e8e6e1 20%, #e8e6e1 80%, transparent)' }} />

          {/* Treatments */}
          {exp?.treatments && exp.treatments.length > 0 && (
            <div className="px-5 pt-4">
              <p className="gene-section-label">治疗方案</p>
              <div className="space-y-3 mt-2.5">
                {exp.treatments.map((t, i) => (
                  <div key={i} className="gene-treatment-item">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[13px] text-stone-700 font-medium">{t.method}</span>
                      <span className="text-[11px] font-mono" style={{ color: categoryConfig.color }}>
                        {Math.round(t.effectiveness * 100)}%
                      </span>
                    </div>
                    {/* Effectiveness bar */}
                    <div className="gene-eff-track">
                      <div
                        className="gene-eff-fill"
                        style={{
                          width: expanded ? `${t.effectiveness * 100}%` : '0%',
                          background: `linear-gradient(90deg, ${categoryConfig.color}60, ${categoryConfig.color})`,
                          transitionDelay: `${i * 0.1 + 0.2}s`,
                        }}
                      />
                    </div>
                    {t.notes && (
                      <p className="text-[11px] text-stone-400 mt-1.5 leading-relaxed">{t.notes}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Diet adjustments */}
          {exp?.dietAdjustments && exp.dietAdjustments.length > 0 && (
            <div className="px-5 pt-4">
              <p className="gene-section-label">🍽 饮食建议</p>
              <div className="mt-2 space-y-1.5">
                {exp.dietAdjustments.map((d, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="w-1 h-1 rounded-full bg-stone-300 mt-[7px] shrink-0" />
                    <span className="text-[12px] text-stone-500 leading-relaxed">{d}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Prevention tips */}
          {exp?.preventionTips && exp.preventionTips.length > 0 && (
            <div className="px-5 pt-4">
              <p className="gene-section-label">🛡 预防措施</p>
              <div className="mt-2 space-y-1.5">
                {exp.preventionTips.map((p, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="w-1 h-1 rounded-full bg-stone-300 mt-[7px] shrink-0" />
                    <span className="text-[12px] text-stone-500 leading-relaxed">{p}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer metadata */}
          <div className="px-5 pt-4 pb-5">
            <div className="flex items-center gap-3 flex-wrap">
              {gene.signals_match?.filter(s => !s.includes('_') && s.length < 20).slice(0, 2).map((sig, i) => (
                <span key={i} className="gene-tag">{sig}</span>
              ))}
              {exp?.sampleSize && (
                <span className="text-[10px] text-stone-300 ml-auto">
                  样本 ×{exp.sampleSize}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Collapsed bottom padding */}
      {!expanded && !exp && (
        <div className="px-5 pb-4">
          <div className="mt-3 space-y-1.5">
            {gene.strategy?.slice(0, 2).map((s, j) => <p key={j} className="text-[12px] text-stone-400 leading-relaxed">{s}</p>)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared content component ──

interface PhoneContentProps {
  tab: Tab;
  setTab: (t: Tab) => void;
  pets: Pet[];
  selectedPet: string;
  setSelectedPet: (id: string) => void;
  input: string;
  setInput: (s: string) => void;
  messages: AgentMessage[];
  result: ConsultResult | null;
  loading: boolean;
  genes: Gene[];
  connected: boolean;
  feedbackMsg: string;
  feedbackScore: number | null;
  showProcess: boolean;
  setShowProcess: (v: boolean) => void;
  chiefComplaint: string;
  currentPet: Pet | undefined;
  handleConsult: () => void;
  handleFeedback: (score: number) => void;
  onOpenAddModal: () => void;
  inFrame?: boolean;
}

function PhoneContent({
  tab, setTab, pets, selectedPet, setSelectedPet, input, setInput,
  messages, result, loading, genes, connected, feedbackMsg, feedbackScore,
  showProcess, setShowProcess, chiefComplaint, currentPet, handleConsult, handleFeedback,
  onOpenAddModal, inFrame,
}: PhoneContentProps) {
  return (
    <div className="flex flex-col min-h-full">
      {/* Scrollable content */}
      <div className="flex-1">

        {/* ═══ Consult ═══ */}
        {tab === 'consult' && (
          <div>
            {/* Hero with avatar */}
            <div className="px-6 pt-8 pb-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs tracking-[0.2em] uppercase text-stone-400 mb-3">Pet Alliance</p>
                  <h1 className="font-serif text-[28px] font-black leading-[1.15] text-stone-900 tracking-tight">
                    养宠联盟
                  </h1>
                  <p className="text-stone-400 text-[13px] mt-2 leading-relaxed">
                    四位 AI 专家协作，给出综合建议
                  </p>
                </div>
                <div className="mt-1">
                  <CatAvatar onClick={() => setTab('genes')} genesCount={genes.length} connected={connected} />
                </div>
              </div>
            </div>

            {/* Pet selection */}
            <div className="px-6 mb-6">
              <div className="flex gap-2 overflow-x-auto no-scrollbar">
                {pets.map(pet => (
                  <button key={pet.id} onClick={() => setSelectedPet(pet.id)}
                    className={`shrink-0 px-5 py-3 rounded-2xl transition-all active:scale-[0.97] ${
                      selectedPet === pet.id ? 'bg-stone-900 text-white' : 'bg-white text-stone-700'
                    }`}
                    style={{ boxShadow: selectedPet === pet.id ? 'none' : '0 1px 3px rgba(0,0,0,0.04)' }}>
                    <span className="text-sm font-semibold">{pet.name}</span>
                    <span className={`text-[11px] ml-2 ${selectedPet === pet.id ? 'text-stone-400' : 'text-stone-400'}`}>
                      {pet.breed} · {pet.age}岁
                    </span>
                  </button>
                ))}
                <button onClick={onOpenAddModal}
                  className="shrink-0 px-4 py-3 rounded-2xl border border-dashed border-stone-300 text-stone-400 text-sm active:scale-[0.97] transition-transform hover:border-stone-400 hover:text-stone-500">
                  +
                </button>
              </div>
            </div>

            {/* Suggestion prompts — hidden once consulting */}
            {!loading && !result?.result && (
              <div className="px-6 mb-5">
                <p className="text-[11px] text-stone-300 tracking-wide mb-3">试试这样问</p>
                <div className="flex flex-col gap-1.5">
                  {SCENARIOS.map((s, i) => (
                    <button key={i} onClick={() => setInput(s.text)}
                      className={`text-left px-3 py-2 rounded-lg text-[13px] leading-relaxed transition-all active:scale-[0.98] ${
                        input === s.text
                          ? 'text-stone-900 font-medium'
                          : 'text-stone-400'
                      }`}>
                      {s.text}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Input */}
            <div className={`px-6 mb-6 ${loading ? 'loading-input-collapse' : ''}`}>
              <textarea value={input} onChange={e => setInput(e.target.value)}
                placeholder="描述你的问题..." rows={3}
                className="w-full px-0 py-4 text-[15px] text-stone-800 leading-relaxed bg-transparent border-b border-stone-200 resize-none focus:outline-none focus:border-stone-900 transition-colors placeholder:text-stone-300"
              />
              {!loading && (
                <button onClick={handleConsult} disabled={!selectedPet || !input.trim()}
                  className="mt-5 w-full py-4 bg-stone-900 text-white text-[15px] font-semibold tracking-wide rounded-2xl disabled:opacity-20 active:bg-stone-800 transition-all">
                  开始咨询
                </button>
              )}
            </div>

            {/* Loading */}
            {loading && <ConsultLoading />}

            {/* Error */}
            {result?.status === 'error' && (
              <div className="px-6 reveal">
                <div className="py-4 px-5 bg-red-50 rounded-2xl text-sm text-red-600">{result.message}</div>
              </div>
            )}

            {/* Results — unified report card */}
            {result?.result && (
              <div className="px-6 pb-8 reveal">
                <div className="report-card">
                  {/* ── Report header ── */}
                  <div className="px-6 pt-6 pb-5">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-xl bg-stone-900 flex items-center justify-center shrink-0">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/>
                        </svg>
                      </div>
                      <div className="min-w-0">
                        <h2 className="font-serif text-[20px] font-black text-stone-900 tracking-tight leading-tight">诊疗报告</h2>
                        <p className="text-[10px] tracking-[0.2em] uppercase text-stone-300 mt-0.5">Consultation Report</p>
                      </div>
                    </div>
                    {/* Pet info + chief complaint */}
                    <div className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[12px]">
                      {currentPet && (
                        <>
                          <span className="text-stone-300 tracking-wide">宠物</span>
                          <span className="text-stone-600 font-medium">{currentPet.name} · {currentPet.breed} · {currentPet.age}岁</span>
                        </>
                      )}
                      <span className="text-stone-300 tracking-wide">主诉</span>
                      <span className="text-stone-600">{chiefComplaint}</span>
                    </div>
                  </div>

                  <div className="report-divider" />

                  {/* ── Recommendations ── */}
                  <div className="px-6 py-5">
                    <div className="space-y-5">
                      {result.result.recommendations?.map((rec, i) => (
                        <div key={i} className="flex gap-4 reveal" style={{ animationDelay: `${0.15 + i * 0.1}s` }}>
                          {/* Number + priority bar */}
                          <div className="flex flex-col items-center gap-2 pt-0.5">
                            <span className="text-[11px] font-bold text-stone-300 tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                            <div className={`priority-bar flex-1 ${
                              rec.priority === 'urgent' ? 'priority-urgent' : rec.priority === 'high' ? 'priority-high' : 'priority-normal'
                            }`} />
                          </div>
                          {/* Content */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              {rec.priority === 'urgent' && <span className="inline-block px-1.5 py-0.5 text-[9px] tracking-widest uppercase font-bold text-red-500 bg-red-50 rounded">紧急</span>}
                              {rec.priority === 'high' && <span className="inline-block px-1.5 py-0.5 text-[9px] tracking-widest uppercase font-bold text-amber-600 bg-amber-50 rounded">重要</span>}
                            </div>
                            <h3 className="font-serif text-[16px] font-bold text-stone-900 leading-snug mt-1">{rec.title}</h3>
                            <p className="text-[13px] text-stone-500 mt-2 leading-[1.8] whitespace-pre-line">{rec.description}</p>
                            {rec.metadata?.source && (
                              <p className="text-[10px] text-stone-300 mt-2.5 tracking-widest uppercase">{DOMAIN_LABEL[rec.metadata.source] || rec.metadata.source}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="report-divider" />

                  {/* ── Footer metadata ── */}
                  <div className="px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3 text-[10px] text-stone-300 tracking-wide">
                      {result.result.negotiationRounds > 0 && <span>协作 {result.result.negotiationRounds} 轮</span>}
                      {result.result.processingTimeMs > 0 && <span>· {(result.result.processingTimeMs / 1000).toFixed(1)}s</span>}
                      {messages.length > 0 && (
                        <button onClick={() => setShowProcess(!showProcess)} className="underline underline-offset-2 decoration-stone-200 hover:text-stone-400 transition-colors">
                          {showProcess ? '收起' : '过程'}
                        </button>
                      )}
                    </div>
                    {result.result.genesApplied?.length > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] tracking-wide bg-stone-900 text-white rounded-full">
                        <span className="opacity-70">&#10022;</span> 继承经验
                      </span>
                    )}
                  </div>

                  {/* ── Collaboration process (collapsible) ── */}
                  {showProcess && messages.length > 0 && (
                    <>
                      <div className="report-divider" />
                      <div className="px-6 py-4 max-h-48 overflow-y-auto fade">
                        <div className="space-y-2">
                          {messages.map((msg, i) => (
                            <div key={i} className="text-[11px] text-stone-400 leading-relaxed">
                              <span className="text-stone-600 font-medium">{DOMAIN_LABEL[msg.from] || msg.from}</span>
                              <span className="mx-1.5 text-stone-300">&#8594;</span>
                              <span>{DOMAIN_LABEL[msg.to] || msg.to}</span>
                              {(msg.payload as Record<string, unknown>)?.message && (
                                <span className="ml-1.5 text-stone-300">{String((msg.payload as Record<string, unknown>).message).slice(0, 50)}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  <div className="report-divider" />

                  {/* ── Feedback ── */}
                  <div className="px-6 py-5">
                    {feedbackScore !== null ? (
                      <div className={`flex items-center justify-center gap-2.5 py-2 rounded-xl transition-all duration-500 ${feedbackScore >= 4 ? 'feedback-glow' : ''}`}>
                        {feedbackScore >= 4 ? (
                          <>
                            <span className="check-draw">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#78716c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M5 12l5 5L19 7"/>
                              </svg>
                            </span>
                            <span className="text-[13px] text-stone-500 sparkle-float">{feedbackMsg || '经验沉淀中...'}</span>
                          </>
                        ) : (
                          <>
                            <span className="text-stone-300 sparkle-float">&#9679;</span>
                            <span className="text-[13px] text-stone-400 sparkle-float" style={{ animationDelay: '0.1s' }}>{feedbackMsg || '记录中...'}</span>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] text-stone-300 tracking-wide uppercase shrink-0">反馈</span>
                        <div className="flex gap-2 flex-1">
                          <button onClick={() => handleFeedback(2)}
                            className="flex-1 py-2.5 rounded-xl text-[12px] text-stone-400 border border-stone-200 hover:border-stone-300 active:bg-stone-50 transition-all">
                            没帮助
                          </button>
                          <button onClick={() => handleFeedback(3)}
                            className="flex-1 py-2.5 rounded-xl text-[12px] text-stone-400 border border-stone-200 hover:border-stone-300 active:bg-stone-50 transition-all">
                            一般
                          </button>
                          <button onClick={() => handleFeedback(5)}
                            className="flex-1 py-2.5 rounded-xl text-[12px] font-medium text-white bg-stone-900 hover:bg-stone-800 active:bg-stone-700 transition-all">
                            有效
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ Genes ═══ */}
        {tab === 'genes' && (
          <div className="page-slide-in">
            {/* Back navigation header */}
            <div className="px-6 pt-6 pb-2">
              <button onClick={() => setTab('consult')}
                className="inline-flex items-center gap-2 text-stone-400 hover:text-stone-600 active:scale-[0.96] transition-all group">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  className="transition-transform group-hover:-translate-x-0.5">
                  <path d="M15 18l-6-6 6-6"/>
                </svg>
                <span className="text-[12px] tracking-wide">返回</span>
              </button>
            </div>

            <div className="px-6 pt-2 pb-6">
              <p className="text-xs tracking-[0.2em] uppercase text-stone-400 mb-3">Gene Library</p>
              <div className="flex items-center justify-between">
                <h1 className="font-serif text-[28px] font-black text-stone-900 tracking-tight">经验基因库</h1>
                {genes.length > 0 && (
                  <button onClick={async () => {
                    if (!confirm('确定要清空所有经验基因吗？')) return;
                    await fetch('/api/genes', { method: 'DELETE' });
                    setGenes([]);
                  }}
                    className="text-[11px] text-stone-400 hover:text-red-400 transition-colors">
                    清空
                  </button>
                )}
              </div>
              <p className="text-stone-400 text-[13px] mt-2">被验证的治疗经验，自动帮助其他宠物</p>
            </div>
            <div className="px-6 pb-8">
              {genes.length === 0 ? (
                <div className="reveal flex flex-col items-center pt-10 pb-16">
                  {/* Decorative DNA helix illustration */}
                  <div className="relative w-20 h-28 mb-8 opacity-[0.12]">
                    <svg viewBox="0 0 80 112" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                      <path d="M20 8 C20 8, 60 24, 60 36 C60 48, 20 56, 20 68 C20 80, 60 88, 60 104" stroke="#78716c" strokeWidth="2" strokeLinecap="round" />
                      <path d="M60 8 C60 8, 20 24, 20 36 C20 48, 60 56, 60 68 C60 80, 20 88, 20 104" stroke="#78716c" strokeWidth="2" strokeLinecap="round" />
                      <line x1="28" y1="16" x2="52" y2="16" stroke="#78716c" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
                      <line x1="22" y1="28" x2="58" y2="28" stroke="#78716c" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
                      <line x1="28" y1="52" x2="52" y2="52" stroke="#78716c" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
                      <line x1="22" y1="68" x2="58" y2="68" stroke="#78716c" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
                      <line x1="28" y1="88" x2="52" y2="88" stroke="#78716c" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
                      <circle cx="20" cy="68" r="3" fill="#78716c" opacity="0.3" />
                      <circle cx="60" cy="36" r="3" fill="#78716c" opacity="0.3" />
                      <circle cx="60" cy="68" r="2" fill="#78716c" opacity="0.2" />
                      <circle cx="20" cy="36" r="2" fill="#78716c" opacity="0.2" />
                    </svg>
                  </div>
                  <p className="font-serif text-[17px] font-bold text-stone-400 tracking-tight">尚无经验沉淀</p>
                  <p className="text-[12px] text-stone-300 mt-2 leading-relaxed text-center max-w-[200px]">
                    完成一次咨询并给予正面反馈<br/>系统将自动提炼治疗经验
                  </p>
                  <div className="mt-8 flex items-center gap-3">
                    <div className="h-px w-8 bg-stone-200" />
                    <span className="text-[9px] tracking-[0.3em] uppercase text-stone-300">waiting for data</span>
                    <div className="h-px w-8 bg-stone-200" />
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {genes.map((gene, i) => (
                    <GeneCard key={gene.id || i} gene={gene} index={i} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── App (root) ──

export default function App() {
  const [tab, setTab] = useState<Tab>('consult');
  const [pets, setPets] = useState<Pet[]>([]);
  const [selectedPet, setSelectedPet] = useState<string>('');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [result, setResult] = useState<ConsultResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [genes, setGenes] = useState<Gene[]>([]);
  const [connected, setConnected] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [feedbackScore, setFeedbackScore] = useState<number | null>(null);
  const [showProcess, setShowProcess] = useState(false);
  const [chiefComplaint, setChiefComplaint] = useState('');

  // Onboarding / modal state
  const [initialized, setInitialized] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [mainEnter, setMainEnter] = useState(false);
  const [transitioning, setTransitioning] = useState(false);

  const currentPet = pets.find(p => p.id === selectedPet);

  useEffect(() => {
    fetch('/api/health').then(r => setConnected(r.ok)).catch(() => setConnected(false));
    fetch('/api/genes').then(r => r.json()).then(d => setGenes(d.genes || [])).catch(() => {});
    fetch('/api/pets').then(r => r.json()).then(d => {
      const petList = d.pets || [];
      setPets(petList);
      if (petList.length > 0) {
        setSelectedPet(petList[0].id);
        setShowOnboarding(false);
      } else {
        setShowOnboarding(true);
      }
      setInitialized(true);
    }).catch(() => {
      setShowOnboarding(true);
      setInitialized(true);
    });
  }, []);

  useEffect(() => {
    let es: EventSource;
    let retryDelay = 1000;
    let closed = false;
    function connect() {
      if (closed) return;
      es = new EventSource('/api/messages/stream');
      es.onopen = () => { retryDelay = 1000; };
      es.onmessage = (e) => {
        const msg = JSON.parse(e.data) as AgentMessage;
        setMessages(prev => {
          const next = [...prev, msg];
          return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
        });
      };
      es.onerror = () => { es.close(); setTimeout(connect, retryDelay); retryDelay = Math.min(retryDelay * 2, 30000); };
    }
    connect();
    return () => { closed = true; es?.close(); };
  }, []);

  const handleOnboardingComplete = (pet: Pet) => {
    setPets([pet]);
    setSelectedPet(pet.id);
    // Cross-fade: keep both screens mounted, animate simultaneously
    setTransitioning(true);
    setMainEnter(true);
    // Clean up after cross-fade completes
    setTimeout(() => {
      setShowOnboarding(false);
      setTransitioning(false);
      setMainEnter(false);
    }, 800);
  };

  const handleAddPet = (pet: Pet) => {
    setPets(prev => [...prev, pet]);
    setSelectedPet(pet.id);
    setShowAddModal(false);
  };

  const handleConsult = async () => {
    if (!selectedPet || !input.trim()) return;
    setLoading(true); setMessages([]); setResult(null); setShowProcess(false); setFeedbackMsg(''); setFeedbackScore(null); setChiefComplaint(input);
    try {
      const res = await fetch('/api/consult', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ petId: selectedPet, text: input, type: 'general' }) });
      setResult(await res.json());
    } catch (err) { setResult({ status: 'error', message: (err as Error).message }); }
    setLoading(false);
  };

  const handleFeedback = async (score: number) => {
    if (!result?.result?.id || feedbackScore !== null) return;
    setFeedbackScore(score);
    setFeedbackMsg(score >= 4 ? '经验沉淀中...' : '记录中...');
    await fetch('/api/feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consultId: result.result.id, petId: selectedPet, overallScore: score, comments: score >= 4 ? '方案有效' : '效果不理想', outcome: score >= 4 ? 'resolved' : 'not_resolved', condition: input, consultSummary: result.result.recommendations?.map(r => r.title).join('; ') || input }),
    });
    const gRes = await fetch('/api/genes'); const gData = await gRes.json(); setGenes(gData.genes || []);
    setFeedbackMsg(score >= 4 ? '经验已沉淀' : '已记录');
  };

  // Don't render until we know whether to show onboarding
  if (!initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#faf9f7' }}>
        <div className="text-center">
          <div className="w-8 h-8 rounded-full border-2 border-stone-300 border-t-stone-900 spin mx-auto mb-4" />
          <p className="text-[11px] text-stone-400 tracking-widest uppercase">Loading</p>
        </div>
      </div>
    );
  }

  const contentProps: PhoneContentProps = {
    tab, setTab, pets, selectedPet, setSelectedPet, input, setInput,
    messages, result, loading, genes, connected, feedbackMsg, feedbackScore,
    showProcess, setShowProcess, chiefComplaint, currentPet, handleConsult, handleFeedback,
    onOpenAddModal: () => setShowAddModal(true),
  };

  // Show onboarding for first-time users (non-transitioning)
  if (showOnboarding && !transitioning) {
    return <OnboardingScreen onComplete={handleOnboardingComplete} />;
  }

  return (
    <>
      {/* Onboarding layer — stays mounted during cross-fade, fades out on top */}
      {showOnboarding && transitioning && (
        <div className="transition-layer-exit">
          <OnboardingScreen onComplete={() => {}} />
        </div>
      )}

      {/* ═══ Desktop: phone mockup ═══ */}
      <div className={`hidden md:flex items-center justify-center min-h-screen ${mainEnter ? 'main-enter' : ''}`} style={{ background: '#e8e6e1' }}>
        <div className="relative" style={{ width: 390, height: 844 }}>
          {/* Bezel */}
          <div className="absolute inset-0 rounded-[48px] pointer-events-none z-10"
            style={{ boxShadow: '0 50px 100px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.08)' }} />
          {/* Dynamic Island */}
          <div className="absolute top-[8px] left-1/2 -translate-x-1/2 z-20">
            <div className="w-[120px] h-[34px] bg-stone-900 rounded-[20px]" />
          </div>
          {/* Home indicator */}
          <div className="absolute bottom-[10px] left-1/2 -translate-x-1/2 w-[134px] h-[5px] rounded-full bg-black/10 z-20" />
          {/* Screen */}
          <div className="absolute inset-0 rounded-[48px] overflow-hidden bg-[#faf9f7]">
            <div className="w-full h-full overflow-y-auto no-scrollbar">
              {/* Status bar space */}
              <div className="h-14 shrink-0" />
              <PhoneContent {...contentProps} inFrame />
              <div className="h-6 shrink-0" />
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Mobile: full screen ═══ */}
      <div className={`md:hidden min-h-screen ${mainEnter ? 'main-enter' : ''}`} style={{ background: '#faf9f7' }}>
        <PhoneContent {...contentProps} />
      </div>

      {/* ═══ Add Pet Modal ═══ */}
      <AddPetModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdded={handleAddPet}
      />
    </>
  );
}
