/**
 * Msingi — Landing Page v7.0  "Information Architecture Refinement"
 * Shorter · cleaner · faster · more intentional
 * 6-section flow: Hero → Conviction → Ecosystem → Showcase → Trust → CTA
 */
import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import * as THREE from 'three';
import {
  Activity, AlertCircle, ArrowRight, ArrowUp, BarChart3,
  BookCheck, BookOpen, Building2, Bus,
  Calendar, CheckCircle, CheckCircle2, ChevronRight, ClipboardList,
  DollarSign, FileText, GraduationCap, Globe, Layers, Lock,
  MessageCircle, MessageSquare, ShieldCheck, TrendingUp, UserCheck,
  Users,
} from 'lucide-react';
import { schoolPortalUrl, storeSchoolSlug } from '@/utils/schoolDetect.js';

const WA_NUMBER  = '254769024153';
const WA_MESSAGE = encodeURIComponent('Hello Msingi, I would like to learn more about the platform.');
const WA_URL     = `https://wa.me/${WA_NUMBER}?text=${WA_MESSAGE}`;

const EASE = [0.16, 1, 0.3, 1];
const fadeUp = {
  hidden:  { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.65, ease: EASE } },
};
const stagger = (d = 0.09) => ({
  hidden:  {},
  visible: { transition: { staggerChildren: d } },
});
const VP = { once: true, amount: 0.15 };

/* ═══════════════════════════════════════════════════════════════
   THREE.JS — OPERATIONAL NODE NETWORK HERO BACKGROUND
═══════════════════════════════════════════════════════════════ */
const NODE_DEFS = [
  { label: 'Students',    x:  0.00, y:  0.00, color: 0x6366f1, size: 0.22 },
  { label: 'Attendance',  x:  1.40, y:  0.60, color: 0x10b981, size: 0.16 },
  { label: 'Finance',     x:  1.20, y: -0.80, color: 0xf59e0b, size: 0.18 },
  { label: 'Reports',     x: -1.30, y:  0.70, color: 0x8b5cf6, size: 0.16 },
  { label: 'Timetable',   x: -1.10, y: -0.90, color: 0x0ea5e9, size: 0.15 },
  { label: 'Admissions',  x:  0.30, y:  1.50, color: 0xec4899, size: 0.15 },
  { label: 'HR',          x: -0.20, y: -1.60, color: 0xf97316, size: 0.14 },
  { label: 'Analytics',   x:  2.10, y: -0.10, color: 0x14b8a6, size: 0.17 },
];

const EDGE_DEFS = [
  [0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[1,7],[2,7],[3,5],[4,1],[5,0],[6,4],[1,2],[3,7],
];

function ThreeHeroBG() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const W = canvas.clientWidth || window.innerWidth;
    const H = canvas.clientHeight || 680;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 100);
    camera.position.set(0, 0, 5);

    const dustGeo = new THREE.BufferGeometry();
    const dustCount = 260;
    const dustPos = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      dustPos[i * 3]     = (Math.random() - 0.5) * 14;
      dustPos[i * 3 + 1] = (Math.random() - 0.5) * 10;
      dustPos[i * 3 + 2] = (Math.random() - 0.5) * 6 - 2;
    }
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const dustMat = new THREE.PointsMaterial({ color: 0x94a3b8, size: 0.025, transparent: true, opacity: 0.35 });
    scene.add(new THREE.Points(dustGeo, dustMat));

    const nodeMeshes = NODE_DEFS.map(n => {
      const geo  = new THREE.SphereGeometry(n.size, 20, 20);
      const mat  = new THREE.MeshBasicMaterial({ color: n.color });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(n.x, n.y, 0);
      scene.add(mesh);
      const haloGeo = new THREE.SphereGeometry(n.size * 1.9, 20, 20);
      const haloMat = new THREE.MeshBasicMaterial({ color: n.color, transparent: true, opacity: 0.08, side: THREE.BackSide });
      const halo    = new THREE.Mesh(haloGeo, haloMat);
      halo.position.copy(mesh.position);
      scene.add(halo);
      return { mesh, halo, def: n };
    });

    EDGE_DEFS.forEach(([ai, bi]) => {
      const a = NODE_DEFS[ai];
      const b = NODE_DEFS[bi];
      const points = [new THREE.Vector3(a.x, a.y, 0), new THREE.Vector3(b.x, b.y, 0)];
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const mat = new THREE.LineBasicMaterial({ color: 0x475569, transparent: true, opacity: 0.25 });
      scene.add(new THREE.Line(geo, mat));
    });

    const pulseCount = 18;
    const pulses = Array.from({ length: pulseCount }, (_, i) => {
      const edgeIdx = i % EDGE_DEFS.length;
      const [ai] = EDGE_DEFS[edgeIdx];
      const color   = NODE_DEFS[ai].color;
      const geo     = new THREE.SphereGeometry(0.045, 8, 8);
      const mat     = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
      const mesh    = new THREE.Mesh(geo, mat);
      scene.add(mesh);
      return { mesh, edgeIdx, t: Math.random(), speed: 0.004 + Math.random() * 0.004, forward: Math.random() > 0.5 };
    });

    let mouse = { x: 0, y: 0 };
    function onMouseMove(e) {
      mouse.x = (e.clientX / window.innerWidth  - 0.5) * 2;
      mouse.y = (e.clientY / window.innerHeight - 0.5) * 2;
    }
    window.addEventListener('mousemove', onMouseMove);

    function onResize() {
      const w = canvas.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || 680;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', onResize);

    let rafId;
    let t = 0;
    function animate() {
      rafId = requestAnimationFrame(animate);
      t += 0.012;
      scene.rotation.y = Math.sin(t * 0.18) * 0.12 + mouse.x * 0.06;
      scene.rotation.x = Math.sin(t * 0.12) * 0.06 - mouse.y * 0.04;
      nodeMeshes.forEach(({ mesh, halo }, i) => {
        const pulse = 1 + 0.07 * Math.sin(t + i * 1.1);
        mesh.scale.setScalar(pulse);
        halo.scale.setScalar(pulse * (1 + 0.1 * Math.sin(t * 0.5 + i)));
      });
      pulses.forEach(p => {
        p.t += p.forward ? p.speed : -p.speed;
        if (p.t > 1) { p.t = 0; p.forward = true; }
        if (p.t < 0) { p.t = 1; p.forward = false; }
        const [ai, bi] = EDGE_DEFS[p.edgeIdx];
        const a = NODE_DEFS[ai];
        const b = NODE_DEFS[bi];
        p.mesh.position.x = a.x + (b.x - a.x) * p.t;
        p.mesh.position.y = a.y + (b.y - a.y) * p.t;
        p.mesh.material.opacity = 0.5 + 0.5 * Math.sin(p.t * Math.PI);
      });
      renderer.render(scene, camera);
    }
    animate();

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ opacity: 0.55 }}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════
   DASHBOARD MOCKUP — hero visual
═══════════════════════════════════════════════════════════════ */
const SIDEBAR_NAV = [
  { Icon: Activity,      label: 'Dashboard',  active: true  },
  { Icon: Users,         label: 'Students'   },
  { Icon: GraduationCap, label: 'Academics'  },
  { Icon: Calendar,      label: 'Timetable'  },
  { Icon: Layers,        label: 'Subjects'   },
  { Icon: DollarSign,    label: 'Finance'    },
  { Icon: FileText,      label: 'Reports'    },
  { Icon: MessageSquare, label: 'Messages'   },
];

const KPI_CARDS = [
  { label: 'Total Students',    value: '1,247', delta: '+23 this term',        Icon: Users,      accent: 'text-indigo-600', bg: 'bg-indigo-50'  },
  { label: 'Avg. Attendance',   value: '94.2%', delta: '↑ 2.1% vs last term', Icon: Calendar,   accent: 'text-emerald-600',bg: 'bg-emerald-50' },
  { label: 'Outstanding Fees',  value: 'KSh 284k', delta: '38 open invoices', Icon: DollarSign, accent: 'text-amber-600',  bg: 'bg-amber-50'   },
  { label: 'Reports Published', value: '3 of 4', delta: '1 pending approval', Icon: FileText,   accent: 'text-violet-600', bg: 'bg-violet-50'  },
];

const YEAR_BARS = [
  { label: 'Year 7',  pct: 87 },
  { label: 'Year 8',  pct: 79 },
  { label: 'Year 9',  pct: 72 },
  { label: 'Year 10', pct: 81 },
  { label: 'Year 11', pct: 76 },
];

const ACTIVITY_FEED = [
  { Icon: CheckCircle, accent: 'text-emerald-500', bg: 'bg-emerald-50', text: 'Report card published',  sub: 'Year 7 · Term 2',       time: '2m ago' },
  { Icon: DollarSign,  accent: 'text-indigo-500',  bg: 'bg-indigo-50',  text: 'Fee payment recorded',  sub: 'S. Kimani · KSh 4,500',  time: '8m ago' },
  { Icon: UserCheck,   accent: 'text-violet-500',  bg: 'bg-violet-50',  text: 'Admission enrolled',    sub: 'J. Osei — Year 7A',      time: '1h ago' },
  { Icon: AlertCircle, accent: 'text-amber-500',   bg: 'bg-amber-50',   text: 'Attendance flagged',    sub: 'Class 9B · 82%',         time: '2h ago' },
];

function DashboardMockup() {
  return (
    <div className="rounded-2xl overflow-hidden border border-slate-200/80 shadow-2xl shadow-slate-900/10 bg-white select-none pointer-events-none">
      <div className="bg-slate-900 px-4 py-3 flex items-center gap-3">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-400/80" />
          <div className="w-3 h-3 rounded-full bg-yellow-400/80" />
          <div className="w-3 h-3 rounded-full bg-green-400/80" />
        </div>
        <div className="flex-1 flex justify-center">
          <div className="bg-slate-800 rounded-md px-5 py-1 text-xs text-slate-400 font-mono tracking-tight">
            app.msingi.io / dashboard
          </div>
        </div>
        <div className="w-[52px]" />
      </div>

      <div className="flex" style={{ height: '420px' }}>
        <div className="w-[54px] bg-slate-900 flex flex-col items-center py-4 gap-1 flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-xs font-bold mb-3">M</div>
          {SIDEBAR_NAV.map(({ Icon, label, active }) => (
            <div key={label} title={label}
              className={`w-9 h-9 rounded-lg flex items-center justify-center ${active ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}>
              <Icon size={15} />
            </div>
          ))}
        </div>

        <div className="flex-1 bg-slate-50 flex flex-col overflow-hidden">
          <div className="bg-white border-b border-slate-100 px-5 py-3 flex items-center justify-between flex-shrink-0">
            <div>
              <p className="text-[10px] text-slate-400 font-medium tracking-wide uppercase">Greenwood Academy</p>
              <p className="text-sm font-semibold text-slate-800">Dashboard</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-400 bg-slate-100 rounded px-2 py-1 font-medium">Term 2 · 2025–26</span>
              <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 text-[10px] font-bold">PM</div>
            </div>
          </div>

          <div className="flex-1 p-4 overflow-hidden">
            <div className="grid grid-cols-4 gap-2.5 mb-4">
              {KPI_CARDS.map(({ label, value, delta, Icon, accent, bg }) => (
                <div key={label} className="bg-white rounded-xl p-3 border border-slate-100 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] text-slate-400 font-medium leading-tight">{label}</span>
                    <div className={`w-5 h-5 rounded-md ${bg} ${accent} flex items-center justify-center flex-shrink-0`}><Icon size={11} /></div>
                  </div>
                  <p className="text-base font-bold text-slate-800 leading-none mb-1">{value}</p>
                  <p className="text-[10px] text-slate-400">{delta}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div className="col-span-2 bg-white rounded-xl p-4 border border-slate-100 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-[9px] text-slate-400 font-medium uppercase tracking-widest mb-0.5">Academic Performance</p>
                    <p className="text-xs font-semibold text-slate-800">Year Group Summary · Term 2</p>
                  </div>
                  <span className="text-[10px] text-indigo-600 font-medium">View report →</span>
                </div>
                <div className="space-y-2.5">
                  {YEAR_BARS.map(({ label, pct }) => (
                    <div key={label} className="flex items-center gap-3">
                      <span className="text-[10px] text-slate-500 w-12 font-medium flex-shrink-0">{label}</span>
                      <div className="flex-1 bg-slate-100 rounded-full h-1.5">
                        <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[10px] font-semibold text-slate-600 w-8 text-right flex-shrink-0">{pct}%</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-xl p-4 border border-slate-100 shadow-sm">
                <p className="text-[9px] text-slate-400 font-medium uppercase tracking-widest mb-0.5">Recent Activity</p>
                <p className="text-xs font-semibold text-slate-800 mb-3">Live updates</p>
                <div className="space-y-3">
                  {ACTIVITY_FEED.map(({ Icon, accent, bg, text, sub, time }, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <div className={`w-5 h-5 rounded-md ${bg} ${accent} flex items-center justify-center flex-shrink-0 mt-0.5`}><Icon size={10} /></div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-medium text-slate-700 truncate leading-tight">{text}</p>
                        <p className="text-[10px] text-slate-400 truncate">{sub}</p>
                        <p className="text-[9px] text-slate-300 mt-0.5">{time}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   REPORT GOVERNANCE MOCKUP
═══════════════════════════════════════════════════════════════ */
const REPORT_STAGES = [
  { stage: 'Grade Submission', person: 'Mr. Kariuki',    status: 'Complete', date: '14 May 16:04', ok: true  },
  { stage: 'HOD Review',       person: 'Mrs. Wanjiku',   status: 'Approved', date: '15 May 09:30', ok: true  },
  { stage: 'Moderation',       person: 'Deputy Ochieng', status: 'Passed',   date: '16 May 14:45', ok: true  },
  { stage: 'Principal Sign',   person: 'Dr. Mwangi',     status: 'Pending',  date: '— awaiting',   ok: false },
  { stage: 'Parent Portal',    person: '28 families',    status: 'Locked',   date: '— blocked',    ok: false },
];

function ReportGovernanceMockup() {
  return (
    <div className="rounded-2xl overflow-hidden border border-slate-200/80 shadow-2xl shadow-slate-900/10 bg-white select-none pointer-events-none">
      <div className="bg-slate-900 px-4 py-3 flex items-center gap-3">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-400/80" />
          <div className="w-3 h-3 rounded-full bg-yellow-400/80" />
          <div className="w-3 h-3 rounded-full bg-green-400/80" />
        </div>
        <div className="flex-1 flex justify-center">
          <div className="bg-slate-800 rounded-md px-5 py-1 text-xs text-slate-400 font-mono tracking-tight">
            app.msingi.io / reports / year-8 / term-2
          </div>
        </div>
        <div className="w-[52px]" />
      </div>

      <div className="px-5 pt-4 pb-3 border-b border-slate-100 flex items-start justify-between">
        <div>
          <p className="text-[10px] text-slate-400 uppercase tracking-widest font-medium mb-0.5">Greenwood Academy · Year 8</p>
          <p className="text-sm font-semibold text-slate-900">Report Cards · Term 2 · 2025–26</p>
          <p className="text-[10px] text-slate-400 mt-0.5">28 reports · 9 subjects · Initiated 14 May · Target publish: 23 May</p>
        </div>
        <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-semibold shrink-0">3 / 5 Done</span>
      </div>

      <div className="p-4">
        <div className="space-y-1.5">
          {REPORT_STAGES.map(({ stage, person, status, date, ok }) => (
            <div key={stage} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg ${ok ? 'bg-emerald-50/60' : 'bg-slate-50'}`}>
              <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${ok ? 'bg-emerald-500' : 'bg-slate-200'}`}>
                {ok
                  ? <CheckCircle size={11} className="text-white" />
                  : <div className="w-2 h-2 rounded-full bg-slate-400" />
                }
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-slate-800">{stage}</p>
                <p className="text-[10px] text-slate-400">{person}</p>
              </div>
              <div className="text-right shrink-0">
                <p className={`text-[10px] font-semibold ${ok ? 'text-emerald-700' : 'text-slate-400'}`}>{status}</p>
                <p className="text-[9px] text-slate-300">{date}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="text-[10px] text-slate-400 uppercase tracking-widest font-medium mb-2">Audit Trail</p>
          {[
            "Grade submission locked by Mr. Kariuki · 14 May 16:04",
            "HOD Mrs. Wanjiku reviewed all 28 reports · 15 May 09:30",
            "Deputy Ochieng moderated 2 flagged grades · 16 May 14:45",
          ].map((e, i) => (
            <div key={i} className="flex items-start gap-2 mb-1.5">
              <div className="w-1 h-1 rounded-full bg-slate-300 mt-1.5 shrink-0" />
              <p className="text-[10px] text-slate-500">{e}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   FEE CLARITY MOCKUP
═══════════════════════════════════════════════════════════════ */
function FeeRegisterMockup() {
  return (
    <div className="rounded-2xl overflow-hidden border border-slate-200/80 shadow-2xl shadow-slate-900/10 bg-white select-none pointer-events-none">
      <div className="bg-slate-900 px-4 py-3 flex items-center gap-3">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-400/80" />
          <div className="w-3 h-3 rounded-full bg-yellow-400/80" />
          <div className="w-3 h-3 rounded-full bg-green-400/80" />
        </div>
        <div className="flex-1 flex justify-center">
          <div className="bg-slate-800 rounded-md px-5 py-1 text-xs text-slate-400 font-mono tracking-tight">
            app.msingi.io / finance / term-3-register
          </div>
        </div>
        <div className="w-[52px]" />
      </div>

      <div className="px-5 pt-4 pb-3 border-b border-slate-100">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest font-medium mb-0.5">Greenwood Academy</p>
            <p className="text-sm font-semibold text-slate-900">Term 3 Fee Register</p>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold">Live</span>
        </div>
        <div className="flex items-center gap-3 mt-2">
          <div className="flex-1 bg-slate-100 rounded-full h-2">
            <div className="bg-indigo-500 h-2 rounded-full" style={{ width: '78%' }} />
          </div>
          <span className="text-[11px] font-bold text-slate-700 shrink-0">78%</span>
        </div>
        <div className="flex gap-4 mt-1.5">
          <span className="text-[10px] text-slate-500">KSh 2.41M collected of 3.10M</span>
          <span className="text-[10px] text-slate-400">23 outstanding · 4 overdue</span>
        </div>
      </div>

      <div className="p-4 space-y-1.5">
        {[
          { name: 'J. Kamau', cls: 'Year 7A', sub: 'KSh 24,500 · M-Pesa QKL78F2B · 2 May · Receipt #3847',  status: '✓ Cleared', badge: 'bg-emerald-50 text-emerald-700' },
          { name: 'A. Osei',  cls: 'Year 8B', sub: 'KSh 18,000 paid · Balance KSh 6,500 due 30 May',          status: 'Partial',   badge: 'bg-amber-50 text-amber-700'    },
          { name: 'M. Ndege', cls: 'Year 9A', sub: 'KSh 0 received · 45 days overdue · SMS reminder sent',    status: 'Overdue',   badge: 'bg-red-50 text-red-600'         },
          { name: 'P. Liu',   cls: 'Year 7B', sub: 'KSh 24,500 · M-Pesa QKL90R7P · 8 May · Receipt #3851',   status: '✓ Cleared', badge: 'bg-emerald-50 text-emerald-700' },
        ].map(({ name, cls, sub, status, badge }) => (
          <div key={name} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-slate-50/80">
            <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold flex items-center justify-center shrink-0">
              {name[0]}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-slate-800">{name} · {cls}</p>
              <p className="text-[10px] text-slate-400 truncate">{sub}</p>
            </div>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${badge}`}>{status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DATA — Ecosystem + Showcase + Conviction
═══════════════════════════════════════════════════════════════ */
const ECOSYSTEM_NODES = [
  { label: 'Admissions',      Icon: ClipboardList, color: 'bg-pink-500',    desc: 'First enquiry in'      },
  { label: 'Student Records', Icon: Users,         color: 'bg-indigo-500',  desc: 'Profile created'       },
  { label: 'Classes',         Icon: Layers,        color: 'bg-blue-500',    desc: 'Sections & streams'    },
  { label: 'Timetable',       Icon: Calendar,      color: 'bg-sky-500',     desc: 'Lessons scheduled'     },
  { label: 'Attendance',      Icon: CheckCircle,   color: 'bg-emerald-500', desc: 'Daily tracked'         },
  { label: 'Lessons',         Icon: BookCheck,     color: 'bg-cyan-500',    desc: 'Curriculum covered'    },
  { label: 'Grades',          Icon: GraduationCap, color: 'bg-violet-500',  desc: 'Marks attributed'      },
  { label: 'Behaviour',       Icon: ShieldCheck,   color: 'bg-orange-500',  desc: 'Incidents logged'      },
  { label: 'Reports',         Icon: FileText,      color: 'bg-purple-500',  desc: 'Governed publish'      },
  { label: 'Finance',         Icon: DollarSign,    color: 'bg-amber-500',   desc: 'Fees collected'        },
  { label: 'Library',         Icon: BookOpen,      color: 'bg-lime-600',    desc: 'Resources managed'     },
  { label: 'Transport',       Icon: Bus,           color: 'bg-rose-500',    desc: 'Routes tracked'        },
  { label: 'Hostel',          Icon: Building2,     color: 'bg-stone-500',   desc: 'Boarders managed'      },
  { label: 'Analytics',       Icon: TrendingUp,    color: 'bg-teal-500',    desc: 'Director insight'      },
];

const CONVICTION_PAIRS = [
  { before: 'Fee tracking in Excel, reconciled every Friday',               after: 'Real-time fee ledger — every payment, every receipt, live'          },
  { before: 'Report cards assembled manually by the registrar',             after: 'Governed publishing: Teacher → HOD → Principal → Portal' },
  { before: 'Curriculum coverage tracked in a teacher\'s notebook',         after: 'Syllabus tracker — every topic marked, every subject covered live'    },
  { before: 'Parent notices via personal WhatsApp groups',                  after: 'Structured institutional channels with full audit trail'              },
  { before: 'Leadership decisions on week-old paper summaries',             after: 'Live director dashboard across attendance, grades, and finance'       },
];

const SHOWCASE_TABS = [
  {
    id: 'director',
    label: "Director's View",
    Icon: BarChart3,
    headline: "Every operational signal on one screen.",
    bullets: [
      "Live attendance, academic performance, and financial health — one view",
      "Outliers and alerts surface automatically. No manual compilation",
      "Real-time updates. Decisions made on current institutional reality",
    ],
    Mockup: DashboardMockup,
  },
  {
    id: 'reports',
    label: "Report Governance",
    Icon: FileText,
    headline: "No report leaves without sign-off.",
    bullets: [
      "Five-stage approval chain — enforced by the platform, not by email",
      "Every action logged: who approved, when, what was reviewed",
      "Publication blocked until every gate is cleared. Permanently auditable",
    ],
    Mockup: ReportGovernanceMockup,
  },
  {
    id: 'finance',
    label: "Fee Clarity",
    Icon: DollarSign,
    headline: "Fee collection without the spreadsheets.",
    bullets: [
      "M-Pesa STK Push triggers payment to parent phones — auto-reconciled on receipt",
      "Paybill · bank transfer · cash — all recorded with receipt numbers in one live register",
      "Overdue accounts surface automatically with SMS reminders and a full notification log",
    ],
    Mockup: FeeRegisterMockup,
  },
];

/* ═══════════════════════════════════════════════════════════════
   PLANS DATA — Portal tiers (server/config/pricing.js)
   All ERP modules included in every tier.
   Tier controls who gets a login portal, not which features exist.
═══════════════════════════════════════════════════════════════ */
const PORTAL_TIERS_LANDING = [
  {
    name:     'Base',
    rate:     100,
    tagline:  'Full school ERP for admin and teaching staff',
    badge:    null,
    dark:     false,
    portals:  ['Admin Portal', 'Teacher Portal'],
    features: [
      'All ERP modules — no feature gates',
      'Admin & teacher dashboards',
      'Students, attendance, behaviour & finance',
      'Timetable, exams, HR & lessons tracker',
      'Library, transport, hostel & admissions',
    ],
    cta: 'Get Started',
  },
  {
    name:     'Student',
    rate:     120,
    tagline:  'Base + dedicated student login and dashboard',
    badge:    'Popular',
    dark:     true,
    portals:  ['Admin Portal', 'Teacher Portal', 'Student Portal'],
    features: [
      'Everything in Base',
      'Student login accounts',
      'Student dashboard: lessons, timetable, report cards',
      'Attendance & fee balance view',
    ],
    cta: 'Get Student',
  },
  {
    name:     'Family',
    rate:     160,
    tagline:  'Student + parent portal with full family visibility',
    badge:    'Recommended',
    dark:     false,
    portals:  ['Admin Portal', 'Teacher Portal', 'Student Portal', 'Parent Portal'],
    features: [
      'Everything in Student',
      'Parent login accounts',
      'Parent dashboard: child progress, fees & curriculum',
      'Parent–teacher messaging',
      'Real-time lesson coverage per subject',
    ],
    cta: 'Get Family',
  },
];

function PlansSection() {
  const [expanded, setExpanded] = useState(false);

  return (
    <section id="plans" className="py-24 sm:py-32 bg-slate-50 border-y border-slate-100">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">

        <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()} className="text-center mb-14">
          <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Pricing</motion.p>
          <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 mb-4 leading-tight">
            Per student, per term.<br />
            <span className="text-slate-400">Choose who gets a portal.</span>
          </motion.h2>
          <motion.p variants={fadeUp} className="text-base text-slate-500 max-w-xl mx-auto">
            Every tier unlocks the full ERP — all modules, all data, complete audit trail.
            The tier only determines which portals your students and parents can log in to.
          </motion.p>
        </motion.div>

        {/* Portal tier cards */}
        <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger(0.1)}
          className="grid md:grid-cols-3 gap-5 mb-8">
          {PORTAL_TIERS_LANDING.map((tier) => (
            <motion.div key={tier.name} variants={fadeUp}
              className={`relative rounded-2xl p-7 flex flex-col ${
                tier.dark
                  ? 'bg-slate-900 text-white ring-2 ring-indigo-500 shadow-xl shadow-indigo-500/10'
                  : 'bg-white border border-slate-200 shadow-sm'
              }`}>

              {tier.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-indigo-500 text-white text-[10px] font-bold px-3 py-1 rounded-full tracking-wide uppercase">
                    {tier.badge}
                  </span>
                </div>
              )}

              <div className="mb-4">
                <h3 className={`text-xl font-bold mb-1 ${tier.dark ? 'text-white' : 'text-slate-900'}`}>{tier.name}</h3>
                <p className={`text-sm leading-snug ${tier.dark ? 'text-slate-400' : 'text-slate-500'}`}>{tier.tagline}</p>
              </div>

              <div className="mb-5">
                <span className={`text-4xl font-bold tracking-tight ${tier.dark ? 'text-white' : 'text-slate-900'}`}>
                  KSh {tier.rate}
                </span>
                <span className={`text-sm ml-1.5 ${tier.dark ? 'text-slate-400' : 'text-slate-500'}`}>/ student / term</span>
              </div>

              {/* Portal access chips */}
              <div className="flex flex-wrap gap-1.5 mb-5">
                {tier.portals.map(p => (
                  <span key={p} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    tier.dark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'
                  }`}>{p}</span>
                ))}
              </div>

              {/* Features */}
              <ul className="space-y-2 mb-6 flex-1">
                {tier.features.map((f, i) => (
                  <li key={i} className="flex items-center gap-2.5">
                    <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                      tier.dark ? 'bg-indigo-500' : 'bg-slate-900'
                    }`}>
                      <CheckCircle size={9} className="text-white" />
                    </div>
                    <span className={`text-sm ${tier.dark ? 'text-slate-300' : 'text-slate-600'}`}>{f}</span>
                  </li>
                ))}
              </ul>

              <Link to="/contact"
                className={`w-full text-center rounded-xl py-3 text-sm font-semibold transition-all ${
                  tier.dark
                    ? 'bg-indigo-500 text-white hover:bg-indigo-400'
                    : 'bg-slate-900 text-white hover:bg-slate-700'
                }`}>
                {tier.cta} →
              </Link>
            </motion.div>
          ))}
        </motion.div>

        {/* Estimator link */}
        <div className="text-center mb-5">
          <Link to="/plans"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-600 hover:text-indigo-800 transition-colors">
            Calculate your school cost with the interactive estimator
            <ChevronRight size={14} />
          </Link>
        </div>

        {/* Setup fee toggle */}
        <div className="text-center mb-6">
          <button onClick={() => setExpanded(p => !p)}
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors">
            <ChevronRight size={15} className={`transition-transform duration-300 ${expanded ? 'rotate-90' : ''}`} />
            {expanded ? 'Hide setup fee details' : 'View one-time setup fee bands'}
          </button>
        </div>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.35 }}
              className="overflow-hidden"
            >
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm max-w-2xl mx-auto">
                <h4 className="font-bold text-slate-900 mb-2">One-time setup fee: KSh 30,000 – 50,000</h4>
                <p className="text-sm text-slate-500 mb-4">
                  Varies by student count and data migration scope.
                  Final amount agreed during the onboarding call.
                </p>
                <div className="grid sm:grid-cols-2 gap-2.5">
                  {[
                    { band: 'Up to 200 students',  fee: 'KSh 30,000' },
                    { band: '201 – 500 students',   fee: 'KSh 35,000' },
                    { band: '501 – 1,000 students', fee: 'KSh 42,000' },
                    { band: 'Over 1,000 students',  fee: 'KSh 50,000' },
                  ].map(({ band, fee }) => (
                    <div key={band} className="flex justify-between items-center bg-slate-50 rounded-xl px-4 py-3 text-sm">
                      <span className="text-slate-600">{band}</span>
                      <span className="font-bold text-slate-900">{fee}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-400 mt-4">
                  Setup includes data migration, staff training, and full onboarding support.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
          transition={{ delay: 0.5 }}
          className="text-center text-xs text-slate-400 mt-8">
          All tiers include every module · Billed at term start · Tenant data isolation · Role-based access control · Full audit trail
        </motion.p>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   FLOATING ACTIONS
═══════════════════════════════════════════════════════════════ */
function FloatingActions() {
  const [showTop, setShowTop] = useState(false);
  useEffect(() => {
    function onScroll() { setShowTop(window.scrollY > 400); }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      <AnimatePresence>
        {showTop && (
          <motion.button initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }}
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="w-10 h-10 rounded-full bg-white border border-slate-200 shadow-md flex items-center justify-center text-slate-600 hover:bg-slate-50 transition-all">
            <ArrowUp size={16} />
          </motion.button>
        )}
      </AnimatePresence>
      <a href={WA_URL} target="_blank" rel="noopener noreferrer"
        className="w-12 h-12 rounded-full bg-[#25D366] flex items-center justify-center shadow-lg shadow-green-500/30 hover:scale-110 transition-all">
        <MessageCircle size={22} className="text-white" />
      </a>
    </div>
  );
}

/* ─── Social icons ── */
function XIcon({ size = 16 }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"/></svg>; }
function LinkedInIcon({ size = 16 }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>; }
function FacebookIcon({ size = 16 }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>; }
function InstagramIcon({ size = 16 }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg>; }
function YouTubeIcon({ size = 16 }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>; }

let _cachedSettings = null;
async function getPlatformSettings() {
  if (_cachedSettings) return _cachedSettings;
  try {
    const res = await fetch('/api/platform/settings');
    if (res.ok) { _cachedSettings = await res.json(); return _cachedSettings; }
  } catch {}
  return {};
}

function SocialLinks({ links = {} }) {
  const socials = [
    { key: 'twitter',   Icon: XIcon,         label: 'X / Twitter' },
    { key: 'linkedin',  Icon: LinkedInIcon,  label: 'LinkedIn'    },
    { key: 'facebook',  Icon: FacebookIcon,  label: 'Facebook'    },
    { key: 'instagram', Icon: InstagramIcon, label: 'Instagram'   },
    { key: 'youtube',   Icon: YouTubeIcon,   label: 'YouTube'     },
  ].filter(({ key }) => links[key]);
  if (!socials.length) return null;
  return (
    <div className="flex items-center gap-4">
      {socials.map(({ key, Icon, label }) => (
        <a key={key} href={links[key]} target="_blank" rel="noopener noreferrer" aria-label={label}
          className="text-slate-400 hover:text-slate-600 transition-colors"><Icon size={16} /></a>
      ))}
    </div>
  );
}

/* ── Landing CMS defaults (shown if DB has no override) ─────── */
const CMS_DEFAULTS = {
  hero: {
    headline:    'The Operating System\nfor Modern Schools.',
    subheadline: 'Admissions, academics, attendance, curriculum, finance, reporting, and communications — connected in one operational platform so institutions run with clarity and accountability.',
    tagline:     'Operational infrastructure for modern institutions',
    cta1:        'Book a Demo',
    cta2:        'Explore the Platform',
    italic:      'Most school systems digitize tasks. Msingi structures institutions.',
  },
  conviction: CONVICTION_PAIRS,
  ecosystem: {
    heading:     'One student. Every operational layer — connected.',
    subheading:  'From the first enquiry to the published report card, collected fee, and lesson covered — one unbroken data trail across the entire institution.',
    enabledNodes: ECOSYSTEM_NODES.map(n => n.label), // all enabled by default
    nodeDescs:   Object.fromEntries(ECOSYSTEM_NODES.map(n => [n.label, n.desc])),
  },
  showcase: SHOWCASE_TABS.map(t => ({
    id:       t.id,
    label:    t.label,
    headline: t.headline,
    bullets:  t.bullets,
  })),
  trust: {
    schools: ['Greenwood Academy', 'Sunrise School', 'TestSync Academy', 'MLA', 'Westbrook College', 'Horizon Institute'],
    tagline: 'Built for institutions that require operational clarity and academic accountability',
  },
  footer: {
    tagline: 'The operating system for modern African schools.',
    email:   'hello@msingi.io',
  },
  seo: {
    title:       'Msingi — The Operating System for Modern Schools',
    description: 'Admissions, academics, attendance, finance, reporting and communications — connected in one platform.',
    ogImageUrl:  '',
  },
};

let _cachedCMS    = null;
let _cmsPromise   = null;
async function getLandingCMS() {
  if (_cachedCMS) return _cachedCMS;
  if (_cmsPromise) return _cmsPromise;
  _cmsPromise = fetch('/api/platform/landing-content')
    .then(r => r.ok ? r.json() : { data: null })
    .then(json => {
      const db = json?.data || {};
      // Deep merge: DB values override defaults, but defaults fill any gaps
      _cachedCMS = {
        hero:       { ...CMS_DEFAULTS.hero,       ...(db.hero       || {}) },
        conviction: db.conviction?.length ? db.conviction : CMS_DEFAULTS.conviction,
        ecosystem:  { ...CMS_DEFAULTS.ecosystem,  ...(db.ecosystem  || {}) },
        showcase:   db.showcase?.length   ? db.showcase   : CMS_DEFAULTS.showcase,
        trust:      { ...CMS_DEFAULTS.trust,      ...(db.trust      || {}) },
        footer:     { ...CMS_DEFAULTS.footer,     ...(db.footer     || {}) },
        seo:        { ...CMS_DEFAULTS.seo,        ...(db.seo        || {}) },
      };
      return _cachedCMS;
    })
    .catch(() => { _cachedCMS = CMS_DEFAULTS; return CMS_DEFAULTS; });
  return _cmsPromise;
}

/* ═══════════════════════════════════════════════════════════════
   MAIN LANDING PAGE
═══════════════════════════════════════════════════════════════ */
export default function Landing() {
  const [schoolInput, setSchoolInput] = useState('');
  const [finding,     setFinding]     = useState(false);
  const [findError,   setFindError]   = useState('');
  const [socialLinks, setSocialLinks] = useState({});
  const [navScrolled, setNavScrolled] = useState(false);
  const [showcaseTab, setShowcaseTab] = useState(0);
  const [cms,         setCms]         = useState(CMS_DEFAULTS);

  useEffect(() => {
    getLandingCMS().then(c => setCms(c));
    getPlatformSettings().then(s => setSocialLinks(s.socialLinks || {}));
    function onScroll() { setNavScrolled(window.scrollY > 20); }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  function goToSchool(slug) {
    storeSchoolSlug(slug);
    window.open(schoolPortalUrl(slug), '_blank', 'noopener,noreferrer');
  }

  async function handleFindSchool(e) {
    e.preventDefault();
    const slug = schoolInput.trim().toLowerCase().replace(/\s+/g, '-');
    if (!slug) return;
    setFinding(true); setFindError('');
    try {
      const res = await fetch(`/api/public/school-info?slug=${slug}`);
      if (!res.ok) { setFindError(`No school found for "${slug}".`); setFinding(false); return; }
      goToSchool(slug);
    } catch {
      setFindError('Could not connect. Please try again.');
      setFinding(false);
    }
  }

  const ActiveMockup = SHOWCASE_TABS[showcaseTab].Mockup;

  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">

      {/* ══════════════════════════════════════════
          NAVBAR
      ══════════════════════════════════════════ */}
      <motion.nav
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE }}
        className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
          navScrolled ? 'bg-white/95 backdrop-blur-md shadow-sm border-b border-slate-100' : 'bg-transparent'
        }`}
      >
        <div className="max-w-7xl mx-auto px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Logo */}
          <Link to="/" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-[10px] font-bold shadow-sm">M</div>
            <span className="text-sm font-bold text-slate-900 tracking-tight">Msingi</span>
          </Link>

          {/* Centre nav */}
          <div className="hidden md:flex items-center gap-1">
            {[
              { label: 'Platform',        href: '#ecosystem'  },
              { label: 'Solutions',       href: '#showcase'   },
              { label: 'Plans',           href: '#plans'      },
              { label: 'Infrastructure',  href: '#trust'      },
            ].map(({ label, href }) => (
              <a key={label} href={href}
                className="px-3.5 py-2 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-all">
                {label}
              </a>
            ))}
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-2.5">
            <Link to="/login"
              className="hidden sm:block px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">
              Login
            </Link>
            <Link to="/contact"
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition-colors shadow-sm">
              Book Demo
            </Link>
          </div>
        </div>
      </motion.nav>

      <div className="h-16" />

      {/* ══════════════════════════════════════════
          1. HERO
      ══════════════════════════════════════════ */}
      <section className="relative max-w-7xl mx-auto px-6 lg:px-8 pt-20 pb-16 overflow-hidden">
        <div className="absolute inset-0 -z-10 pointer-events-none" style={{ height: '110%' }}>
          <ThreeHeroBG />
          <div className="absolute inset-0 bg-gradient-to-b from-white/70 via-white/50 to-white/90" />
        </div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}
          className="flex justify-center mb-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 backdrop-blur-sm px-3.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
            {cms.hero.tagline}
          </div>
        </motion.div>

        <motion.div initial="hidden" animate="visible" variants={stagger(0.07)} className="text-center max-w-4xl mx-auto">
          <motion.h1 variants={fadeUp}
            className="text-5xl sm:text-6xl lg:text-[72px] font-bold tracking-tighter text-slate-900 leading-[1.04] mb-6">
            {cms.hero.headline.split('\n').map((line, i, arr) => (
              i < arr.length - 1
                ? <span key={i}>{line}<br /></span>
                : <span key={i} className="text-indigo-600">{line}</span>
            ))}
          </motion.h1>

          <motion.p variants={fadeUp} className="text-lg sm:text-xl text-slate-500 max-w-2xl mx-auto leading-relaxed mb-3">
            {cms.hero.subheadline}
          </motion.p>

          <motion.p variants={fadeUp} className="text-base text-slate-400 italic mb-10">
            {cms.hero.italic}
          </motion.p>

          <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link to="/contact"
              className="group inline-flex items-center gap-2 rounded-xl bg-slate-900 px-7 py-3.5 text-sm font-semibold text-white hover:bg-slate-700 transition-all shadow-lg shadow-slate-900/20">
              Book a Demo
              <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <button onClick={() => goToSchool('demo')}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white/80 backdrop-blur-sm px-7 py-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-all">
              Explore the Platform
              <ChevronRight size={15} className="text-slate-400" />
            </button>
          </motion.div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 48, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.9, delay: 0.25, ease: EASE }} className="mt-16 relative">
          <div className="absolute -inset-x-4 top-0 h-40 bg-gradient-to-b from-indigo-50/40 via-transparent to-transparent -z-10" />
          <DashboardMockup />
        </motion.div>
      </section>

      {/* ══════════════════════════════════════════
          TRUST BAND — school names
      ══════════════════════════════════════════ */}
      <section className="py-10 bg-white border-y border-slate-100">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 text-center">
          <p className="text-xs font-medium uppercase tracking-widest text-slate-400 mb-6">
            {cms.trust.tagline}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-8 lg:gap-14">
            {(cms.trust.schools || []).map(name => (
              <span key={name} className="text-slate-300 font-bold text-sm tracking-widest uppercase select-none">{name}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          2. CONVICTION STRIP
      ══════════════════════════════════════════ */}
      <section className="py-20 sm:py-28 bg-slate-50 border-b border-slate-100">
        <div className="max-w-5xl mx-auto px-6 lg:px-8">
          <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
            <motion.div variants={fadeUp} className="mb-12">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">The Operational Reality</p>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 leading-tight">
                From fragmented chaos<br />
                <span className="text-slate-400">to institutional clarity.</span>
              </h2>
            </motion.div>

            <div className="space-y-3">
              {(cms.conviction || CONVICTION_PAIRS).map(({ before, after }, i) => (
                <motion.div key={i} variants={fadeUp}
                  className="grid sm:grid-cols-[1fr_auto_1fr] gap-3 sm:gap-5 items-center">
                  <div className="flex items-start gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3.5">
                    <div className="w-4 h-4 rounded-full border-2 border-slate-300 shrink-0 mt-0.5" />
                    <p className="text-sm text-slate-500 leading-snug">{before}</p>
                  </div>
                  <div className="hidden sm:flex items-center justify-center">
                    <ArrowRight size={16} className="text-indigo-400" />
                  </div>
                  <div className="flex items-start gap-3 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3.5">
                    <div className="w-4 h-4 rounded-full bg-indigo-600 flex items-center justify-center shrink-0 mt-0.5">
                      <CheckCircle size={9} className="text-white" />
                    </div>
                    <p className="text-sm font-medium text-slate-800 leading-snug">{after}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          3. ECOSYSTEM CENTERPIECE
      ══════════════════════════════════════════ */}
      <section id="ecosystem" className="py-24 sm:py-32 bg-slate-950 overflow-hidden">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">

          <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()} className="text-center mb-16">
            <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">Platform Architecture</motion.p>
            <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-4 leading-tight">
              {cms.ecosystem.heading}
            </motion.h2>
            <motion.p variants={fadeUp} className="text-base text-slate-400 max-w-xl mx-auto leading-relaxed">
              {cms.ecosystem.subheading}
            </motion.p>
          </motion.div>

          {/* Ecosystem grid — fully responsive, no horizontal scroll */}
          <div className="relative rounded-3xl border border-slate-800/60 bg-slate-900/40 p-6 sm:p-8 lg:p-10">
            {/* Subtle radial glow — enterprise depth */}
            <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-indigo-950/30 via-transparent to-slate-950/30 pointer-events-none" />

            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={VP}
              variants={stagger(0.045)}
              className="relative grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-y-8 gap-x-4 sm:gap-x-6"
            >
              {ECOSYSTEM_NODES.filter(n => (cms.ecosystem.enabledNodes || []).includes(n.label)).map((node, i) => (
                <motion.div
                  key={node.label}
                  variants={fadeUp}
                  className="flex flex-col items-center gap-2.5 group cursor-default"
                >
                  <div className={`w-12 h-12 rounded-2xl ${node.color} flex items-center justify-center shadow-lg group-hover:scale-110 group-hover:shadow-xl transition-all duration-200`}>
                    <node.Icon size={22} className="text-white" />
                  </div>
                  <p className="text-xs font-semibold text-white text-center leading-tight">{node.label}</p>
                  <p className="text-[10px] text-slate-500 text-center leading-tight">{cms.ecosystem.nodeDescs?.[node.label] ?? node.desc}</p>
                </motion.div>
              ))}
            </motion.div>
          </div>

          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.6, duration: 0.6 }}
            className="text-center text-slate-600 text-sm mt-8 font-medium tracking-wide"
          >
            No data re-entry. No reconciliation. No manual handoff.
          </motion.p>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          4. PRODUCT EXPERIENCE SHOWCASE
      ══════════════════════════════════════════ */}
      <section id="showcase" className="py-24 sm:py-32 bg-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">

          <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()} className="mb-12">
            <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Product Experience</motion.p>
            <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 leading-tight">
              Three moments that define<br />
              <span className="text-slate-400">institutional operations.</span>
            </motion.h2>
          </motion.div>

          {/* Tab selector */}
          <div className="flex items-center gap-2 mb-10 flex-wrap">
            {SHOWCASE_TABS.map((tab, i) => (
              <button key={tab.id} onClick={() => setShowcaseTab(i)}
                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                  showcaseTab === i
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700'
                }`}>
                <tab.Icon size={14} />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <AnimatePresence mode="wait">
            <motion.div key={showcaseTab}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.35, ease: EASE }}
              className="grid lg:grid-cols-[1fr_2fr] gap-10 lg:gap-16 items-start"
            >
              {/* Left: copy */}
              <div className="lg:pt-4">
                <h3 className="text-xl sm:text-2xl font-bold text-slate-900 mb-5 leading-tight">
                  {SHOWCASE_TABS[showcaseTab].headline}
                </h3>
                <ul className="space-y-3.5">
                  {SHOWCASE_TABS[showcaseTab].bullets.map((b, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <div className="w-5 h-5 rounded-full bg-slate-900 flex items-center justify-center shrink-0 mt-0.5">
                        <CheckCircle size={10} className="text-white" />
                      </div>
                      <p className="text-sm text-slate-600 leading-relaxed">{b}</p>
                    </li>
                  ))}
                </ul>
                <div className="mt-8">
                  <Link to="/contact"
                    className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 hover:text-indigo-600 transition-colors">
                    See it in a demo
                    <ArrowRight size={14} />
                  </Link>
                </div>
              </div>

              {/* Right: mockup */}
              <div>
                <ActiveMockup />
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          5. PLANS
      ══════════════════════════════════════════ */}
      <PlansSection />

      {/* ══════════════════════════════════════════
          6. TRUST / INFRASTRUCTURE
      ══════════════════════════════════════════ */}
      <section id="trust" className="py-24 sm:py-32 bg-slate-950">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
            <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">Trust Architecture</motion.p>
            <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-4 leading-tight">
              Built for institutional trust.<br />
              <span className="text-slate-500">Not a startup experiment.</span>
            </motion.h2>
            <motion.p variants={fadeUp} className="text-base text-slate-400 max-w-xl mb-6 leading-relaxed">
              School directors are asked to trust a platform with their most sensitive operational and academic data.
              Msingi is engineered specifically for that responsibility.
            </motion.p>

            {/* Signal pills */}
            <motion.div variants={fadeUp} className="flex flex-wrap gap-2.5 mb-14">
              {['99.9% uptime SLA', 'Automated daily backups', 'Full audit log on all actions', 'Tenant data isolation', 'RBAC at API layer', 'Immutable academic records', 'M-Pesa STK Push & Paybill'].map(t => (
                <span key={t} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-700 text-xs text-slate-400 font-medium">
                  <CheckCircle2 size={10} className="text-emerald-500" />{t}
                </span>
              ))}
            </motion.div>

            {/* 4 pillar cards */}
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger(0.08)} className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { Icon: Layers,      title: 'Tenant isolation',       desc: "Every school's data is architecturally isolated at the database layer. No cross-tenant reads, no data bleed." },
                { Icon: ShieldCheck, title: 'Role-based governance',  desc: 'Granular, per-module permissions enforced server-side. Teachers see their classes. Parents see their children.' },
                { Icon: Lock,        title: 'Permanent audit trail',  desc: 'Every login, grade entry, payment, and approval is permanently logged with attribution, timestamp, and context.' },
                { Icon: Globe,       title: 'Multi-curriculum native',desc: 'CBC, Cambridge, IB, British, American, and fully custom frameworks — built into the academic engine from day one.' },
              ].map(({ Icon, title, desc }, i) => (
                <motion.div key={i} variants={fadeUp}
                  className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 hover:border-slate-700 hover:bg-slate-900 transition-all duration-300">
                  <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center mb-4"><Icon size={15} className="text-slate-400" /></div>
                  <h3 className="text-sm font-semibold text-white mb-2">{title}</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">{desc}</p>
                </motion.div>
              ))}
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          7. FINAL CTA
      ══════════════════════════════════════════ */}
      <section className="py-24 sm:py-32 bg-white">
        <div className="max-w-3xl mx-auto px-6 lg:px-8 text-center">
          <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
            <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-6">The next step</motion.p>
            <motion.h2 variants={fadeUp}
              className="text-4xl sm:text-5xl lg:text-[56px] font-bold tracking-tighter text-slate-900 leading-[1.05] mb-6">
              Replace the chaos<br />with operational calm.
            </motion.h2>
            <motion.p variants={fadeUp} className="text-base text-slate-400 leading-relaxed mb-3 max-w-lg mx-auto">
              The institutions running on Msingi do not patch workflows with WhatsApp groups and spreadsheets.
              They run structured, governed, auditable operations from day one.
            </motion.p>
            <motion.blockquote variants={fadeUp} className="text-sm italic text-slate-400 border-l-2 border-slate-200 pl-4 text-left max-w-md mx-auto mb-10">
              "Our principal now makes the same decisions in minutes that used to take a week of follow-up emails."
              <cite className="block mt-1 not-italic font-medium text-slate-500 text-xs">— School Director, Greenwood Academy</cite>
            </motion.blockquote>
            <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link to="/contact"
                className="group inline-flex items-center gap-2 rounded-xl bg-slate-900 px-8 py-4 text-sm font-semibold text-white hover:bg-slate-700 transition-all shadow-lg shadow-slate-900/20">
                Book a Demo
                <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
              </Link>
              <button onClick={() => goToSchool('demo')}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-8 py-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-all">
                Explore the Platform
                <ChevronRight size={15} className="text-slate-400" />
              </button>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          FOOTER
      ══════════════════════════════════════════ */}
      <footer className="border-t border-slate-100 pt-12 pb-8 bg-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">

          {/* Find School */}
          <div className="max-w-md mx-auto text-center mb-10">
            <p className="text-sm font-semibold text-slate-800 mb-1">Already have a school account?</p>
            <p className="text-xs text-slate-400 mb-4">Enter your school slug to go to your portal.</p>
            <form onSubmit={handleFindSchool} className="flex gap-2">
              <input type="text" value={schoolInput}
                onChange={(e) => { setSchoolInput(e.target.value); setFindError(''); }}
                placeholder="e.g. greenwood-academy"
                className="flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/20 transition shadow-sm" />
              <button type="submit" disabled={finding || !schoolInput.trim()}
                className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40 transition-colors">
                {finding ? '…' : 'Go'}
              </button>
            </form>
            {findError && <p className="mt-2 text-xs text-red-500">{findError}</p>}
          </div>

          {/* Bottom bar */}
          <div className="border-t border-slate-100 pt-8 flex flex-col sm:flex-row items-center justify-between gap-5">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-[10px] font-bold">M</div>
              <span className="text-sm font-bold text-slate-900">Msingi</span>
              <span className="text-xs text-slate-400 ml-1">· The School Operating System</span>
            </div>
            <SocialLinks links={socialLinks} />
            <div className="flex gap-5 text-xs text-slate-400">
              <a href="mailto:hello@msingi.io" className="hover:text-slate-700 transition-colors">hello@msingi.io</a>
              <Link to="/contact" className="hover:text-slate-700 transition-colors">Contact</Link>
            </div>
          </div>
          <p className="text-xs text-slate-400 text-center mt-6">© {new Date().getFullYear()} Msingi. All rights reserved.</p>
        </div>
      </footer>

      <FloatingActions />
    </div>
  );
}
