/**
 * Msingi — Landing Page v6.0  "Product Experience Architecture"
 * A living institutional operational experience.
 * Not software marketing. Institutional operational infrastructure.
 *
 * Three.js hero network · living workflow story · operational module
 * mini-stories · workflow connector · institutional trust language
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence, useScroll, useTransform } from 'framer-motion';
import * as THREE from 'three';
import {
  Activity, AlertCircle, ArrowRight, ArrowUp, Award, BarChart3,
  Calendar, CheckCircle, CheckCircle2, ChevronRight, ClipboardList,
  DollarSign, FileText, GraduationCap, Globe, Layers, Lock,
  MessageCircle, MessageSquare, ShieldCheck, TrendingUp, UserCheck,
  Users, Zap, BookOpen, Clock, Bell, RefreshCcw, Cpu,
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
const fadeIn = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.5 } },
};
const stagger = (d = 0.09) => ({
  hidden:  {},
  visible: { transition: { staggerChildren: d } },
});
const VP = { once: true, amount: 0.15 };

/* ═══════════════════════════════════════════════════════════════
   THREE.JS — OPERATIONAL NODE NETWORK HERO BACKGROUND
   Nodes = school modules, edges = data flows, pulsing particles
   travel along edges to show live institutional data movement.
═══════════════════════════════════════════════════════════════ */
const NODE_DEFS = [
  { label: 'Students',    x:  0.00, y:  0.00, color: 0x6366f1, size: 0.22 },
  { label: 'Attendance',  x:  1.40, y:  0.60, color: 0x10b981, size: 0.16 },
  { label: 'Finance',     x:  1.20, y: -0.80, color: 0xf59e0b, size: 0.18 },
  { label: 'Reports',     x: -1.30, y:  0.70, color: 0x8b5cf6, size: 0.16 },
  { label: 'Timetable',  x: -1.10, y: -0.90, color: 0x0ea5e9, size: 0.15 },
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

    /* ── Renderer ── */
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 100);
    camera.position.set(0, 0, 5);

    /* ── Ambient particles (background dust) ── */
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

    /* ── Node spheres ── */
    const nodeMeshes = NODE_DEFS.map(n => {
      const geo  = new THREE.SphereGeometry(n.size, 20, 20);
      const mat  = new THREE.MeshBasicMaterial({ color: n.color });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(n.x, n.y, 0);
      scene.add(mesh);

      /* Glow halo */
      const haloGeo = new THREE.SphereGeometry(n.size * 1.9, 20, 20);
      const haloMat = new THREE.MeshBasicMaterial({ color: n.color, transparent: true, opacity: 0.08, side: THREE.BackSide });
      const halo    = new THREE.Mesh(haloGeo, haloMat);
      halo.position.copy(mesh.position);
      scene.add(halo);

      return { mesh, halo, def: n };
    });

    /* ── Edges (thin tubes) ── */
    const edgeMeshes = EDGE_DEFS.map(([ai, bi]) => {
      const a = NODE_DEFS[ai];
      const b = NODE_DEFS[bi];
      const points = [new THREE.Vector3(a.x, a.y, 0), new THREE.Vector3(b.x, b.y, 0)];
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const mat = new THREE.LineBasicMaterial({ color: 0x475569, transparent: true, opacity: 0.25 });
      const line = new THREE.Line(geo, mat);
      scene.add(line);
      return { line, ai, bi };
    });

    /* ── Travelling pulse particles ── */
    const pulseCount = 18;
    const pulses = Array.from({ length: pulseCount }, (_, i) => {
      const edgeIdx = i % EDGE_DEFS.length;
      const [ai, bi] = EDGE_DEFS[edgeIdx];
      const color    = NODE_DEFS[ai].color;
      const geo      = new THREE.SphereGeometry(0.045, 8, 8);
      const mat      = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
      const mesh     = new THREE.Mesh(geo, mat);
      scene.add(mesh);
      return { mesh, edgeIdx, t: Math.random(), speed: 0.004 + Math.random() * 0.004, forward: Math.random() > 0.5 };
    });

    /* ── Mouse parallax ── */
    let mouse = { x: 0, y: 0 };
    function onMouseMove(e) {
      mouse.x = (e.clientX / window.innerWidth  - 0.5) * 2;
      mouse.y = (e.clientY / window.innerHeight - 0.5) * 2;
    }
    window.addEventListener('mousemove', onMouseMove);

    /* ── Resize ── */
    function onResize() {
      const w = canvas.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || 680;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', onResize);

    /* ── Animate ── */
    let rafId;
    let t = 0;
    function animate() {
      rafId = requestAnimationFrame(animate);
      t += 0.012;

      /* Gentle scene rotation + mouse parallax */
      scene.rotation.y = Math.sin(t * 0.18) * 0.12 + mouse.x * 0.06;
      scene.rotation.x = Math.sin(t * 0.12) * 0.06 - mouse.y * 0.04;

      /* Node pulse */
      nodeMeshes.forEach(({ mesh, halo, def }, i) => {
        const pulse = 1 + 0.07 * Math.sin(t + i * 1.1);
        mesh.scale.setScalar(pulse);
        halo.scale.setScalar(pulse * (1 + 0.1 * Math.sin(t * 0.5 + i)));
      });

      /* Travelling pulses */
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
      {/* Browser chrome */}
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

      {/* App shell */}
      <div className="flex" style={{ height: '420px' }}>
        {/* Sidebar */}
        <div className="w-[54px] bg-slate-900 flex flex-col items-center py-4 gap-1 flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-xs font-bold mb-3">M</div>
          {SIDEBAR_NAV.map(({ Icon, label, active }) => (
            <div key={label} title={label}
              className={`w-9 h-9 rounded-lg flex items-center justify-center ${active ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}>
              <Icon size={15} />
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 bg-slate-50 flex flex-col overflow-hidden">
          {/* Top bar */}
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
            {/* KPI row */}
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

            {/* Chart + activity */}
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
   LIVING WORKFLOW STORY
   Animated sequence: Admission → Enrolment → Academic → Report → Finance → Analytics
   Shows how Msingi connects institutional workflows end-to-end.
═══════════════════════════════════════════════════════════════ */
const WORKFLOW_STEPS = [
  {
    id: 'admission',
    phase: '01 Admission',
    title: 'Structured intake — from first enquiry to enrolled student.',
    desc: 'A parent submits an enquiry. The admission pipeline moves it through assessment, offer, and enrolment stages — automatically creating the full student record, class placement, and fee account the moment an offer is accepted.',
    color: 'from-pink-500 to-rose-500',
    iconBg: 'bg-pink-50 text-pink-600',
    Icon: ClipboardList,
    ui: {
      header: 'Admissions Pipeline · Term 3 2025–26',
      stats: '18 active applications · 4 enrolled this week · 2 offers awaiting response',
      items: [
        { name: 'John Kamau',    sub: 'Year 7 · Applied 14 May · Guardian: R. Kamau',         status: 'Enrolled',   badge: 'bg-emerald-50 text-emerald-700' },
        { name: 'Amara Osei',   sub: 'Year 8 · Applied 18 May · Offer letter sent 20 May',    status: 'Offer Sent', badge: 'bg-indigo-50 text-indigo-700'  },
        { name: 'M. Ndege',     sub: 'Year 7 · Applied 19 May · Interview: 23 May 10:00am',   status: 'Assessment', badge: 'bg-amber-50 text-amber-700'    },
        { name: 'Priya Mwangi', sub: 'Year 9 · Applied 21 May · Awaiting documents',          status: 'Enquiry',    badge: 'bg-slate-100 text-slate-600'   },
      ],
    },
  },
  {
    id: 'academic',
    phase: '02 Academics',
    title: 'Multi-curriculum grading with full teacher attribution.',
    desc: 'The enrolled student appears in their assigned class immediately. Teachers enter grades across all subjects. Every mark is attributed, timestamped, and versioned — no silent overwrites, no lost data.',
    color: 'from-indigo-500 to-violet-500',
    iconBg: 'bg-indigo-50 text-indigo-600',
    Icon: GraduationCap,
    ui: {
      header: 'Grade Entry · Mathematics · Year 7A · Term 2',
      stats: 'Mr. Kariuki · 28 students enrolled · Class avg: 83.4% · Submitted: 19 / 28',
      items: [
        { name: 'J. Kamau',   sub: 'Exam: 72  |  Coursework: 15  |  Total: 87 / 100', status: 'A · Excellent',    badge: 'bg-indigo-50 text-indigo-700'   },
        { name: 'A. Osei',    sub: 'Exam: 65  |  Coursework: 14  |  Total: 79 / 100', status: 'B+ · Good',        badge: 'bg-violet-50 text-violet-700'   },
        { name: 'S. Mendes',  sub: 'Exam: 78  |  Coursework: 13  |  Total: 91 / 100', status: 'A+ · Outstanding', badge: 'bg-emerald-50 text-emerald-700' },
        { name: 'D. Liu',     sub: 'Exam: 55  |  Coursework: 10  |  Total: 65 / 100', status: 'C · Average',      badge: 'bg-amber-50 text-amber-700'     },
      ],
    },
  },
  {
    id: 'reports',
    phase: '03 Reports',
    title: 'Governed publishing workflow. No report leaves without sign-off.',
    desc: 'Grades flow through a locked multi-stage approval chain. Teacher → HOD → Moderation → Principal → Published. Each stage records who approved, when, and what was reviewed. No report is published until every gate is cleared.',
    color: 'from-violet-500 to-purple-600',
    iconBg: 'bg-violet-50 text-violet-600',
    Icon: FileText,
    ui: {
      header: 'Report Card Workflow · Year 7 · Term 2 · 2025–26',
      stats: '28 reports · Initiated 14 May · Target publish: 23 May · 0 disputes',
      items: [
        { name: 'Grade submission',   sub: 'All 8 subjects · Mr. Kariuki · Completed 14 May 16:04', status: '✓ Complete', badge: 'bg-emerald-50 text-emerald-700' },
        { name: 'HOD sign-off',       sub: 'Mrs. Wanjiku · Reviewed 28 reports · Approved 15 May',  status: '✓ Approved', badge: 'bg-emerald-50 text-emerald-700' },
        { name: 'Moderation',         sub: 'Deputy Ochieng · 2 grades flagged and resolved 16 May',  status: '✓ Complete', badge: 'bg-emerald-50 text-emerald-700' },
        { name: 'Principal approval', sub: 'Principal Mwangi · Awaiting final sign-off · Sent today', status: '⟳ Pending',  badge: 'bg-amber-50 text-amber-700'    },
      ],
    },
  },
  {
    id: 'finance',
    phase: '04 Finance',
    title: 'Fee lifecycle from invoice to reconciled payment.',
    desc: 'Term fees are auto-generated at enrolment. Payments are recorded in real time with receipt numbers. Outstanding balances, partial payments, and overdue accounts are instantly visible — no spreadsheets, no reconciliation weekend.',
    color: 'from-amber-500 to-orange-500',
    iconBg: 'bg-amber-50 text-amber-600',
    Icon: DollarSign,
    ui: {
      header: 'Term 3 Fee Register · Greenwood Academy',
      stats: 'KSh 2.41M collected of 3.10M · 23 outstanding · 4 overdue · 91% collection rate',
      items: [
        { name: 'J. Kamau · Year 7A', sub: 'KSh 24,500 paid in full · 2 May · Receipt #3847',  status: '✓ Cleared', badge: 'bg-emerald-50 text-emerald-700' },
        { name: 'A. Osei · Year 8B',  sub: 'KSh 18,000 paid · Balance: KSh 6,500 outstanding', status: 'Partial',   badge: 'bg-amber-50 text-amber-700'    },
        { name: 'M. Ndege · Year 9A', sub: 'KSh 0 received · 45 days overdue · Parent notified',status: 'Overdue',   badge: 'bg-red-50 text-red-600'         },
        { name: 'P. Liu · Year 7B',   sub: 'KSh 24,500 paid in full · 8 May · Receipt #3851',  status: '✓ Cleared', badge: 'bg-emerald-50 text-emerald-700' },
      ],
    },
  },
  {
    id: 'analytics',
    phase: '05 Analytics',
    title: 'The entire institution visible in one director dashboard.',
    desc: 'Attendance, academic performance, financial health, and staff operations converge in a single live view. Leadership no longer waits for weekly summaries — they see what is happening right now, with the context to act.',
    color: 'from-teal-500 to-cyan-500',
    iconBg: 'bg-teal-50 text-teal-600',
    Icon: BarChart3,
    ui: {
      header: 'Director Dashboard · Greenwood Academy',
      stats: 'Live · Last updated 2 minutes ago · Term 3 · Week 6 of 12',
      items: [
        { name: 'Attendance Today',   sub: '1,172 present of 1,247 enrolled · 3 absences escalated', status: '94.2% ↑', badge: 'bg-emerald-50 text-emerald-700' },
        { name: 'Academic Avg.',      sub: 'Year group average · Term 2 · ↑ 3.2% vs Term 1',         status: '82.1% ↑', badge: 'bg-indigo-50 text-indigo-700'   },
        { name: 'Fee Collection',     sub: 'KSh 2.41M of 3.10M · 23 invoices outstanding',           status: '78% rate',badge: 'bg-amber-50 text-amber-700'     },
        { name: 'Report Cards',       sub: '3 year groups published · Year 9 pending principal',      status: '3 / 4 ✓', badge: 'bg-violet-50 text-violet-700'   },
      ],
    },
  },
];

function WorkflowUI({ ui }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden">
      {/* Browser chrome */}
      <div className="bg-slate-900 px-4 py-2.5 flex items-center gap-2">
        <div className="flex gap-1">
          <div className="w-2 h-2 rounded-full bg-red-400/70" />
          <div className="w-2 h-2 rounded-full bg-yellow-400/70" />
          <div className="w-2 h-2 rounded-full bg-green-400/70" />
        </div>
        <span className="text-[10px] text-slate-400 ml-2 font-mono truncate">{ui.header}</span>
      </div>
      {/* Context stats bar */}
      {ui.stats && (
        <div className="px-4 py-2 bg-slate-50 border-b border-slate-100">
          <p className="text-[10px] text-slate-500 font-medium">{ui.stats}</p>
        </div>
      )}
      {/* Rows */}
      <div className="p-3 space-y-1.5">
        {ui.items.map((item, i) => (
          <div key={i} className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-slate-50/80 hover:bg-slate-100/80 transition gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold text-slate-800 leading-tight">{item.name}</p>
              {item.sub && <p className="text-[10px] text-slate-400 mt-0.5 truncate">{item.sub}</p>}
            </div>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${item.badge}`}>{item.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkflowStorySection() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setActive(p => (p + 1) % WORKFLOW_STEPS.length), 3800);
    return () => clearInterval(t);
  }, []);

  const step = WORKFLOW_STEPS[active];

  return (
    <section className="py-24 sm:py-32 bg-slate-950 overflow-hidden">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">

        <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()} className="text-center mb-16">
          <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">Operational Workflow</motion.p>
          <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-4 leading-tight">
            Every workflow connected.
            <br /><span className="text-slate-400">End to end.</span>
          </motion.h2>
          <motion.p variants={fadeUp} className="text-base text-slate-500 max-w-2xl mx-auto leading-relaxed">
            From the moment a student enquires to when their report is published and fees collected — Msingi structures every step without any manual handoff.
          </motion.p>
        </motion.div>

        {/* Step selector */}
        <div className="flex items-center justify-center gap-2 mb-12 flex-wrap">
          {WORKFLOW_STEPS.map((s, i) => (
            <button key={s.id} onClick={() => setActive(i)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${active === i ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-300 border border-slate-800'}`}>
              {s.phase}
            </button>
          ))}
        </div>

        {/* Active step */}
        <AnimatePresence mode="wait">
          <motion.div key={step.id}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.45, ease: EASE }}
            className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center"
          >
            {/* Copy */}
            <div>
              <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r ${step.color} text-white text-xs font-bold mb-6`}>
                <step.Icon size={12} />
                {step.phase}
              </div>
              <h3 className="text-2xl sm:text-3xl font-bold text-white mb-4 leading-tight">{step.title}</h3>
              <p className="text-base text-slate-400 leading-relaxed mb-8">{step.desc}</p>

              {/* Connection arrow */}
              {active < WORKFLOW_STEPS.length - 1 && (
                <div className="flex items-center gap-3 text-slate-600 text-xs">
                  <div className="h-px flex-1 bg-slate-800" />
                  <span>flows into</span>
                  <span className="text-slate-400 font-semibold">{WORKFLOW_STEPS[active + 1].phase}</span>
                  <div className="h-px flex-1 bg-slate-800" />
                </div>
              )}
            </div>

            {/* UI mockup */}
            <WorkflowUI ui={step.ui} />
          </motion.div>
        </AnimatePresence>

        {/* Progress bar */}
        <div className="mt-12 flex gap-1.5 justify-center">
          {WORKFLOW_STEPS.map((_, i) => (
            <div key={i} className={`h-1 rounded-full transition-all duration-500 ${i === active ? 'bg-white w-8' : 'bg-slate-700 w-4'}`} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   OPERATIONAL MODULE STORIES — all 12 platform modules
   Each: real pain → institutional transformation → concrete outcomes
═══════════════════════════════════════════════════════════════ */
const MODULE_STORIES = [
  {
    label: 'Students',
    Icon: Users,
    accent: 'text-indigo-600', bg: 'bg-indigo-50',
    pain: 'Student records spread across spreadsheets, paper files, and disconnected systems. No single source of truth.',
    transform: 'Centralize every learner\'s complete institutional record — enrolment, academics, fees, attendance, behaviour, and communications — in one searchable, role-governed profile.',
    outcomes: ['Single student record accessible school-wide', 'Full history: academic, financial, behavioural', 'Role-based visibility — parents see their child only'],
  },
  {
    label: 'Academics',
    Icon: GraduationCap,
    accent: 'text-violet-600', bg: 'bg-violet-50',
    pain: 'Grades entered in Excel with no attribution, no version control, and no protection against silent edits.',
    transform: 'Structure subject management and multi-curriculum grading (CBC, Cambridge, IB, custom) into one accountable academic infrastructure — every mark attributed, timestamped, and immutable.',
    outcomes: ['CBC, Cambridge, IB, and custom grade frameworks', 'Attributed grade entry with edit audit trail', 'Year group and class academic history by term'],
  },
  {
    label: 'Attendance',
    Icon: CheckCircle,
    accent: 'text-emerald-600', bg: 'bg-emerald-50',
    pain: 'Attendance taken on paper registers. Summaries compiled hours later — by which time a missing student is already a risk.',
    transform: 'Synchronize daily attendance tracking per class and lesson — connected to the timetable, flagging low-attendance students automatically and surfacing trends on the director dashboard in real time.',
    outcomes: ['Per-lesson attendance against timetable', 'Auto-flagging of attendance below threshold', 'Real-time summary on director dashboard'],
  },
  {
    label: 'Behaviour',
    Icon: ShieldCheck,
    accent: 'text-orange-600', bg: 'bg-orange-50',
    pain: 'Behaviour records kept informally — verbal warnings forgotten, merit awards unrecorded, patterns invisible until a serious incident.',
    transform: 'Replace informal behaviour tracking with a structured merit and demerit system (BPS) — each incident logged with category, context, witness, and outcome. Patterns surface automatically.',
    outcomes: ['Merit and demerit point tracking per student', 'Behaviour categories and incident logging', 'Behaviour trends visible on student profile'],
  },
  {
    label: 'Finance',
    Icon: DollarSign,
    accent: 'text-amber-600', bg: 'bg-amber-50',
    pain: 'Fee tracking in Excel. Reconciliation is a weekly ritual. Outstanding balances are always stale by the time leadership sees them.',
    transform: 'Automate the complete fee lifecycle — from invoice generation at enrolment through payment recording, receipting, and financial reporting — with real-time visibility for finance staff and directors.',
    outcomes: ['Auto-invoiced fee structures at enrolment', 'Real-time payment recording with receipts', 'Outstanding balance and overdue tracking'],
  },
  {
    label: 'Admissions',
    Icon: ClipboardList,
    accent: 'text-pink-600', bg: 'bg-pink-50',
    pain: 'Enquiries arrive by WhatsApp. Application stages tracked in a notebook. Enrolment creates a new spreadsheet row.',
    transform: 'Structure intake from first enquiry through assessment, offer, and enrolment — with automatic student record, class placement, and fee account created the moment an offer is accepted.',
    outcomes: ['Enquiry → Assessment → Offer → Enrolled pipeline', 'Automatic student record on acceptance', 'Admissions analytics and conversion tracking'],
  },
  {
    label: 'Timetable',
    Icon: Calendar,
    accent: 'text-sky-600', bg: 'bg-sky-50',
    pain: 'Scheduling done manually in Excel across disconnected sheets. Teacher and room conflicts discovered on the first day of term.',
    transform: 'Synchronize teachers, rooms, sections, and subjects through one centralized scheduling infrastructure — directly connected to attendance tracking and academic records.',
    outcomes: ['Teacher and room conflict detection', 'Timetable feeds attendance automatically', 'Class schedules visible to teachers and staff'],
  },
  {
    label: 'Communication',
    Icon: MessageSquare,
    accent: 'text-blue-600', bg: 'bg-blue-50',
    pain: 'School-parent communication fragmented across personal WhatsApp groups, SMS blasts, and physical notice boards — unaccountable and unarchived.',
    transform: 'Route all institutional messaging — staff-to-parent, staff-to-student, and internal school communications — through one governed, role-based channel with a permanent audit trail.',
    outcomes: ['Role-based channels: staff, parents, students', 'Institutional announcements and broadcasts', 'Full message history and accountability log'],
  },
  {
    label: 'Report Cards',
    Icon: FileText,
    accent: 'text-purple-600', bg: 'bg-purple-50',
    pain: 'Report cards assembled manually by the academic registrar. Published without governance — no approval chain, no version control, no audit trail.',
    transform: 'Govern the entire report publishing workflow — teacher entry → HOD review → moderation → principal approval → publication — enforced by the platform, with every action permanently logged.',
    outcomes: ['Multi-stage approval: Teacher → HOD → Principal', 'Publication blocked until all stages clear', 'Immutable audit trail per report card'],
  },
  {
    label: 'HR & Staff',
    Icon: UserCheck,
    accent: 'text-teal-600', bg: 'bg-teal-50',
    pain: 'Staff records in filing cabinets. Payroll computed in Excel. Contracts and leave tracked informally with no institutional record.',
    transform: 'Consolidate staff profiles, contracts, department assignments, leave management, and payroll computation into one HR infrastructure — visible to principals and directors with governance controls.',
    outcomes: ['Staff profiles, contracts, and department records', 'Leave application and approval workflow', 'Payroll computation and export by pay period'],
  },
  {
    label: 'Events',
    Icon: Bell,
    accent: 'text-rose-600', bg: 'bg-rose-50',
    pain: 'School events communicated via notice boards and WhatsApp groups. Scheduling conflicts missed. Parents informed late.',
    transform: 'Centralize the institutional calendar — school events, academic milestones, parent meetings, and term dates — published to staff, students, and parents through one coordinated channel.',
    outcomes: ['Centralized institutional event calendar', 'Role-based visibility: staff, parents, students', 'Events linked to academic and communication modules'],
  },
  {
    label: 'Analytics',
    Icon: TrendingUp,
    accent: 'text-cyan-600', bg: 'bg-cyan-50',
    pain: "Leadership makes decisions based on weekly paper summaries — compiled by hand, days old by the time they reach a director's desk.",
    transform: 'Converge attendance, academic performance, financial health, and HR operations into one live director dashboard — so institutional leadership always operates on current institutional reality.',
    outcomes: ['Live attendance trends by class and year group', 'Academic performance tracking across terms', 'Financial health and fee collection KPIs'],
  },
];

/* ═══════════════════════════════════════════════════════════════
   ECOSYSTEM FLOW — visual chain showing how modules connect
═══════════════════════════════════════════════════════════════ */
const ECOSYSTEM_CHAIN = [
  { label: 'Admissions',  Icon: ClipboardList, color: 'bg-pink-500',   desc: 'Enquiry → enrolled student' },
  { label: 'Student Record', Icon: Users,      color: 'bg-indigo-500', desc: 'One institutional profile' },
  { label: 'Timetable',   Icon: Calendar,      color: 'bg-sky-500',    desc: 'Scheduled across subjects' },
  { label: 'Attendance',  Icon: CheckCircle,   color: 'bg-emerald-500',desc: 'Tracked per lesson' },
  { label: 'Grades',      Icon: GraduationCap, color: 'bg-violet-500', desc: 'Attributed and immutable' },
  { label: 'Behaviour',   Icon: ShieldCheck,   color: 'bg-orange-500', desc: 'Merits and demerits' },
  { label: 'Reports',     Icon: FileText,      color: 'bg-purple-500', desc: 'Governed and published' },
  { label: 'Finance',     Icon: DollarSign,    color: 'bg-amber-500',  desc: 'Invoiced and collected' },
  { label: 'Analytics',   Icon: BarChart3,     color: 'bg-teal-500',   desc: 'Director visibility' },
];

function EcosystemFlowSection() {
  return (
    <section className="py-20 bg-slate-950 border-t border-slate-800/50 overflow-hidden">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()} className="text-center mb-14">
          <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">Ecosystem Architecture</motion.p>
          <motion.h2 variants={fadeUp} className="text-2xl sm:text-3xl font-bold tracking-tight text-white mb-3 leading-tight">
            Every module is connected.<br /><span className="text-slate-500">That connectedness is the advantage.</span>
          </motion.h2>
          <motion.p variants={fadeUp} className="text-sm text-slate-500 max-w-xl mx-auto">
            Msingi is not a collection of modules. It is one operational system where each workflow feeds the next — automatically, without manual handoffs.
          </motion.p>
        </motion.div>

        {/* Flow chain */}
        <div className="overflow-x-auto pb-4">
          <div className="flex items-center gap-0 min-w-max mx-auto w-fit">
            {ECOSYSTEM_CHAIN.map((node, i) => (
              <div key={node.label} className="flex items-center">
                {/* Node */}
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.07, duration: 0.4, ease: EASE }}
                  className="flex flex-col items-center gap-2 w-[88px]"
                >
                  <div className={`w-10 h-10 rounded-xl ${node.color} flex items-center justify-center shadow-lg`}>
                    <node.Icon size={16} className="text-white" />
                  </div>
                  <p className="text-[10px] font-bold text-slate-300 text-center leading-tight">{node.label}</p>
                  <p className="text-[9px] text-slate-600 text-center leading-tight">{node.desc}</p>
                </motion.div>

                {/* Connector arrow */}
                {i < ECOSYSTEM_CHAIN.length - 1 && (
                  <motion.div
                    initial={{ opacity: 0, scaleX: 0 }}
                    whileInView={{ opacity: 1, scaleX: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.07 + 0.2, duration: 0.3 }}
                    className="flex items-center mx-1 origin-left"
                  >
                    <div className="w-6 h-px bg-gradient-to-r from-slate-600 to-slate-700" />
                    <div className="w-0 h-0 border-t-[3px] border-b-[3px] border-l-[4px] border-t-transparent border-b-transparent border-l-slate-600" />
                  </motion.div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Tagline */}
        <motion.p
          initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
          transition={{ delay: 0.6 }}
          className="text-center text-xs text-slate-600 mt-10"
        >
          One student. One record. Nine connected operational layers. No data re-entry. No manual reconciliation.
        </motion.p>
      </div>
    </section>
  );
}

function ModuleStoryCard({ story, index }) {
  const [open, setOpen] = useState(false);
  return (
    <motion.div variants={fadeUp}
      className={`group rounded-2xl border ${open ? 'border-slate-200 shadow-lg' : 'border-slate-100'} bg-white p-6 cursor-pointer hover:border-slate-200 hover:shadow-md transition-all duration-300`}
      onClick={() => setOpen(p => !p)}
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className={`w-10 h-10 rounded-xl ${story.bg} ${story.accent} flex items-center justify-center shadow-sm shrink-0`}>
          <story.Icon size={18} />
        </div>
        <ChevronRight size={15} className={`text-slate-400 mt-1 transition-transform shrink-0 ${open ? 'rotate-90' : ''}`} />
      </div>

      <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${story.accent}`}>{story.label}</p>

      {/* Pain point */}
      <p className="text-xs text-slate-400 italic mb-3 leading-relaxed">"{story.pain}"</p>

      {/* Transformation */}
      <p className="text-sm font-medium text-slate-800 leading-snug mb-4">{story.transform}</p>

      {/* Outcomes — expanded */}
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3 }}>
            <div className="space-y-2 pt-2 border-t border-slate-100">
              {story.outcomes.map((o, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <CheckCircle2 size={12} className={`${story.accent} mt-0.5 shrink-0`} />
                  <span className="text-xs text-slate-600">{o}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   REPORT CARD MOCKUP
═══════════════════════════════════════════════════════════════ */
const REPORT_STUDENTS = [
  { name: 'Amara Osei',   avg: '87%', grade: 'A',  status: 'published' },
  { name: 'James Liu',    avg: '79%', grade: 'B+', status: 'published' },
  { name: 'Sofia Mendes', avg: '72%', grade: 'B',  status: 'published' },
  { name: 'David Kimani', avg: '91%', grade: 'A+', status: 'published' },
  { name: 'Grace Waweru', avg: '68%', grade: 'B−', status: 'review'    },
];

const AUDIT_TRAIL = [
  { event: 'Published by Principal Mwangi',    time: 'Today, 09:41'     },
  { event: 'Approved by Deputy Kariuki',        time: 'Today, 09:15'     },
  { event: 'Submitted for review — 28 reports', time: 'Yesterday, 16:32' },
];

function ReportCardMockup() {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
      <div className="bg-slate-900 px-4 py-2.5 flex items-center gap-2">
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-400/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-400/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-400/70" />
        </div>
        <span className="text-[10px] text-slate-500 ml-2 font-mono">Report Cards · Year 7 · Term 2</span>
      </div>
      <div className="p-6">
        <div className="flex items-start justify-between mb-5">
          <div>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest font-medium mb-1">Year 7 · Term 2 · 2025–26</p>
            <p className="text-base font-semibold text-slate-900">Report Cards</p>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold">Published</span>
        </div>
        <div className="space-y-1 mb-5">
          {REPORT_STUDENTS.map(({ name, avg, grade, status }) => (
            <div key={name} className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-slate-50">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold flex items-center justify-center flex-shrink-0">{name[0]}</div>
                <span className="text-sm font-medium text-slate-800">{name}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="text-sm text-slate-400">{avg}</span>
                <span className="w-8 text-center text-xs font-bold text-slate-800 bg-slate-100 rounded py-0.5">{grade}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${status === 'published' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                  {status === 'published' ? '✓ Published' : '⟳ In review'}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-slate-100 pt-4">
          <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest mb-2">Audit Trail</p>
          <div className="space-y-2">
            {AUDIT_TRAIL.map(({ event, time }) => (
              <div key={event} className="flex items-start gap-2 text-xs">
                <div className="w-1 h-1 rounded-full bg-slate-300 mt-1.5 flex-shrink-0" />
                <span className="flex-1 text-slate-500">{event}</span>
                <span className="text-slate-300 flex-shrink-0 text-[10px]">{time}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
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

/* ═══════════════════════════════════════════════════════════════
   MAIN LANDING PAGE
═══════════════════════════════════════════════════════════════ */
export default function Landing() {
  const [schoolInput, setSchoolInput] = useState('');
  const [finding,     setFinding]     = useState(false);
  const [findError,   setFindError]   = useState('');
  const [socialLinks, setSocialLinks] = useState({});
  const [navScrolled, setNavScrolled] = useState(false);

  useEffect(() => {
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

  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased overflow-x-hidden">

      {/* ── NAVBAR ── */}
      <motion.nav initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }}
        className={`fixed top-0 left-0 right-0 w-full z-50 transition-all duration-300 ${navScrolled ? 'bg-white/90 backdrop-blur-xl shadow-sm border-b border-slate-100/80' : 'bg-transparent'}`}>
        <div className="max-w-7xl mx-auto px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-xs font-bold shadow-sm shadow-indigo-500/30">M</div>
            <span className="text-[15px] font-bold text-slate-900 tracking-tight">Msingi</span>
          </div>
          <div className="hidden md:flex items-center gap-7 text-sm text-slate-500">
            <button onClick={() => document.getElementById('modules')?.scrollIntoView({ behavior: 'smooth' })}
              className="hover:text-slate-900 transition-colors">Modules</button>
            <Link to="/plans"   className="hover:text-slate-900 transition-colors">Plans</Link>
            <Link to="/contact" className="hover:text-slate-900 transition-colors">Contact</Link>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/contact"
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition-colors shadow-sm">
              Book Demo
            </Link>
          </div>
        </div>
      </motion.nav>

      <div className="h-16" />

      {/* ══════════════════════════════════════════
          HERO — Three.js network + headline + dashboard
      ══════════════════════════════════════════ */}
      <section className="relative max-w-7xl mx-auto px-6 lg:px-8 pt-20 pb-16 overflow-hidden">

        {/* Three.js background — constrained to hero height */}
        <div className="absolute inset-0 -z-10 pointer-events-none" style={{ height: '110%' }}>
          <ThreeHeroBG />
          {/* Gradient overlay to keep text readable */}
          <div className="absolute inset-0 bg-gradient-to-b from-white/70 via-white/50 to-white/90" />
        </div>

        {/* Badge */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}
          className="flex justify-center mb-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 backdrop-blur-sm px-3.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
            Operational infrastructure for modern institutions
          </div>
        </motion.div>

        {/* Headline */}
        <motion.div initial="hidden" animate="visible" variants={stagger(0.07)} className="text-center max-w-4xl mx-auto">
          <motion.h1 variants={fadeUp}
            className="text-5xl sm:text-6xl lg:text-[72px] font-bold tracking-tighter text-slate-900 leading-[1.04] mb-6">
            The Operating System<br />
            <span className="text-indigo-600">for Modern Schools.</span>
          </motion.h1>

          <motion.p variants={fadeUp} className="text-lg sm:text-xl text-slate-500 max-w-2xl mx-auto leading-relaxed mb-3">
            Admissions, academics, attendance, behaviour, finance, timetabling, reports, HR,
            and communications — connected in one operational platform so institutions run
            with clarity, accountability, and operational calm.
          </motion.p>

          <motion.p variants={fadeUp} className="text-base text-slate-400 italic mb-10">
            Most school systems digitize tasks. Msingi structures institutions.
          </motion.p>

          <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link to="/contact"
              className="group inline-flex items-center gap-2 rounded-xl bg-slate-900 px-7 py-3.5 text-sm font-semibold text-white hover:bg-slate-700 transition-all shadow-lg shadow-slate-900/20">
              Book a Demo
              <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
            </Link>
            {/* Explore Platform — opens in new tab per spec */}
            <button onClick={() => goToSchool('demo')}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white/80 backdrop-blur-sm px-7 py-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-all">
              Explore the Platform
              <ChevronRight size={15} className="text-slate-400" />
            </button>
          </motion.div>
        </motion.div>

        {/* Dashboard mockup */}
        <motion.div initial={{ opacity: 0, y: 48, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.9, delay: 0.25, ease: EASE }} className="mt-16 relative">
          <div className="absolute -inset-x-4 top-0 h-40 bg-gradient-to-b from-indigo-50/40 via-transparent to-transparent -z-10" />
          <DashboardMockup />
        </motion.div>
      </section>

      {/* ══════════════════════════════════════════
          PROBLEM → TRANSFORMATION
      ══════════════════════════════════════════ */}
      <section className="py-24 sm:py-32 bg-slate-50 border-y border-slate-100">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">

          <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={fadeUp} className="text-center mb-16">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">The Operational Reality</p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 leading-tight">
              Schools are running on<br />
              <span className="text-slate-400">disconnected infrastructure.</span>
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-10 lg:gap-20 items-start">
            {/* Problems */}
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-7">Today's operational reality</p>
              {[
                { label: 'Fragmented systems everywhere', desc: 'Fee software, attendance registers, grade spreadsheets, and report tools — all disconnected, all requiring manual reconciliation.' },
                { label: 'Everything assembled by hand', desc: 'Report cards compiled manually. Attendance from paper registers. Fees tracked in Excel. Admissions managed via WhatsApp.' },
                { label: 'Zero institutional visibility', desc: 'No real-time view of student progress, financial health, or operational performance. Decisions made on outdated information.' },
                { label: 'Workflow chaos', desc: 'Approval chains, admission pipelines, and staff workflows routed through email and messaging apps — with no accountability trail.' },
                { label: 'No audit infrastructure', desc: 'No version control on grades. No governance on report changes. No log of who did what, when — just institutional trust with no verification.' },
              ].map(({ label, desc }, i) => (
                <motion.div key={i} variants={fadeUp} className="flex gap-4 mb-7">
                  <div className="w-5 h-5 rounded-full border-2 border-slate-300 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-slate-800 mb-1">{label}</p>
                    <p className="text-sm text-slate-500 leading-relaxed">{desc}</p>
                  </div>
                </motion.div>
              ))}
            </motion.div>

            {/* Resolution */}
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <p className="text-xs font-semibold text-indigo-600 uppercase tracking-widest mb-7">With Msingi</p>
              {[
                { label: 'One unified operational platform', desc: 'Academics, finance, communication, HR, and reporting all connected — one data layer, one login, one source of institutional truth.' },
                { label: 'Automated institutional workflows', desc: 'Report generation, fee invoicing, admissions tracking, and timetabling run with precision — no manual assembly required.' },
                { label: 'Real-time operational visibility', desc: 'Directors see attendance, finances, and academic performance in a live dashboard. Decisions made on current data.' },
                { label: 'Structured process architecture', desc: 'Role-based workflows, approval chains, and escalation paths are built into the platform — not bolted on via email.' },
                { label: 'Immutable audit infrastructure', desc: 'Every action logged. Every record versioned. Every grade traceable. Built for institutional accountability from the ground up.' },
              ].map(({ label, desc }, i) => (
                <motion.div key={i} variants={fadeUp} className="flex gap-4 mb-7">
                  <div className="w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm shadow-indigo-300">
                    <CheckCircle size={10} className="text-white" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800 mb-1">{label}</p>
                    <p className="text-sm text-slate-500 leading-relaxed">{desc}</p>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          LIVING WORKFLOW STORY  (Three-dark section)
      ══════════════════════════════════════════ */}
      <WorkflowStorySection />

      {/* ══════════════════════════════════════════
          ECOSYSTEM FLOW
      ══════════════════════════════════════════ */}
      <EcosystemFlowSection />

      {/* ══════════════════════════════════════════
          TRUST BAND
      ══════════════════════════════════════════ */}
      <section className="py-14 bg-white border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 text-center">
          <p className="text-xs font-medium uppercase tracking-widest text-slate-400 mb-8">
            Built for modern institutions that require operational clarity and academic accountability
          </p>
          <div className="flex flex-wrap items-center justify-center gap-8 lg:gap-14">
            {['Greenwood Academy', 'Sunrise School', 'TestSync Academy', 'MLA', 'Westbrook College', 'Horizon Institute'].map((name) => (
              <span key={name} className="text-slate-300 font-bold text-sm tracking-widest uppercase select-none">{name}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          OPERATIONAL MODULE STORIES
      ══════════════════════════════════════════ */}
      <section id="modules" className="py-24 sm:py-32 bg-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
            <motion.div variants={fadeUp}>
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">Platform — 12 Modules</p>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 max-w-xl mb-4 leading-tight">
                Every operational dimension<br />of a modern school.
              </h2>
              <p className="text-sm text-slate-500 mb-12 max-w-xl leading-relaxed">
                Each module solves a specific institutional problem. Together they eliminate the operational chaos that comes from running a school on disconnected systems.
                <span className="text-slate-400 italic ml-1">Click any module to see the transformation.</span>
              </p>
            </motion.div>

            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger(0.05)}
              className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {MODULE_STORIES.map((story, i) => <ModuleStoryCard key={i} story={story} index={i} />)}
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          ACADEMIC INTEGRITY
      ══════════════════════════════════════════ */}
      <section className="py-24 sm:py-32 bg-slate-50 border-y border-slate-100">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 xl:gap-24 items-center">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">Academic Integrity</motion.p>
              <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 mb-6 leading-tight">
                Academic records that<br />institutions can trust.
              </motion.h2>
              <motion.p variants={fadeUp} className="text-base text-slate-500 leading-relaxed mb-10">
                Msingi treats academic records as legally sensitive institutional data. Every grade entry, report card publication, and mark modification is logged, versioned, and attributable — building the audit infrastructure modern schools require.
              </motion.p>
              {[
                { Icon: ShieldCheck, title: 'Immutable grade records',     desc: 'Marks can be corrected with full audit trail — no silent overwrites, no data loss.' },
                { Icon: FileText,    title: 'Structured report workflows', desc: 'Teacher entry → HOD review → moderation → principal approval → publication. Enforced.' },
                { Icon: Lock,        title: 'Role-based academic access',  desc: 'Teachers see their classes. Heads see their departments. Principals see everything. Server-side.' },
                { Icon: Award,       title: 'Historical transcript safety',desc: 'Academic records archived per term — never modified after publication. Transcripts stay true.' },
              ].map(({ Icon, title, desc }, i) => (
                <motion.div key={i} variants={fadeUp} className="flex gap-4 mb-6">
                  <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center flex-shrink-0 shadow-sm">
                    <Icon size={14} className="text-slate-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800 mb-1">{title}</p>
                    <p className="text-sm text-slate-500 leading-relaxed">{desc}</p>
                  </div>
                </motion.div>
              ))}
            </motion.div>
            <motion.div initial={{ opacity: 0, x: 32 }} whileInView={{ opacity: 1, x: 0 }} viewport={VP} transition={{ duration: 0.7, ease: EASE }}>
              <ReportCardMockup />
            </motion.div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          INFRASTRUCTURE  (dark)
      ══════════════════════════════════════════ */}
      <section className="py-24 sm:py-32 bg-slate-950">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
            <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">Trust Architecture</motion.p>
            <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-4 leading-tight">
              Built for institutional trust.<br /><span className="text-slate-500">Not a startup experiment.</span>
            </motion.h2>
            <motion.p variants={fadeUp} className="text-base text-slate-400 max-w-2xl mb-4 leading-relaxed">
              School directors and owners are asked to trust a platform with their most sensitive operational and academic data. Msingi is engineered specifically for that responsibility — with the governance, isolation, and auditability that institutional trust requires.
            </motion.p>
            <motion.div variants={fadeUp} className="flex flex-wrap gap-3 mb-14">
              {['99.9% uptime SLA', 'Automated daily backups', 'Full audit log on all actions', 'Tenant data isolation', 'RBAC at API layer', 'Immutable academic records'].map(t => (
                <span key={t} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-700 text-xs text-slate-400 font-medium">
                  <CheckCircle2 size={10} className="text-emerald-500" />{t}
                </span>
              ))}
            </motion.div>
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger(0.07)} className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { Icon: Layers,      title: 'Complete tenant isolation',        desc: "Every school's data is architecturally isolated. No cross-tenant reads, no data bleed — guaranteed at the database layer." },
                { Icon: ShieldCheck, title: 'Role-based governance',            desc: 'Granular, per-module permissions enforced server-side. Teachers see their classes. Parents see their children. No exceptions.' },
                { Icon: Lock,        title: 'Permanent audit trail',            desc: 'Every login, grade entry, payment, approval, and deletion is permanently logged with attribution, timestamp, and context.' },
                { Icon: RefreshCcw,  title: 'Automated backups',               desc: 'Daily automated backups with point-in-time recovery. Your institutional data is never at risk from a single failure.' },
                { Icon: Zap,         title: 'Institutional scale',              desc: 'From 100 to 5,000+ students — Msingi scales without reconfiguration, database migration, or data restructuring.' },
                { Icon: Globe,       title: 'Multi-curriculum natively',        desc: 'CBC, Cambridge, IB, British, American, and fully custom frameworks. Not bolted on — built into the academic engine from day one.' },
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
          FINAL CTA
      ══════════════════════════════════════════ */}
      <section className="py-24 sm:py-32 bg-white">
        <div className="max-w-3xl mx-auto px-6 lg:px-8 text-center">
          <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
            <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-6">The next step</motion.p>
            <motion.h2 variants={fadeUp}
              className="text-4xl sm:text-5xl lg:text-[56px] font-bold tracking-tighter text-slate-900 leading-[1.05] mb-6">
              Replace the chaos with<br />operational calm.
            </motion.h2>
            <motion.p variants={fadeUp} className="text-lg text-slate-500 max-w-xl mx-auto mb-4 leading-relaxed">
              Principals who adopt Msingi describe the same shift: they stop managing information and start leading institutions. The scattered spreadsheets, the manual reconciliation, the approval chains via WhatsApp — they disappear.
            </motion.p>
            <motion.p variants={fadeUp} className="text-base text-slate-400 italic max-w-md mx-auto mb-10">
              "This platform finally understands how modern schools actually operate."
            </motion.p>
            <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link to="/contact"
                className="group inline-flex items-center gap-2 rounded-xl bg-slate-900 px-8 py-4 text-sm font-semibold text-white hover:bg-slate-700 transition-all shadow-xl shadow-slate-900/15">
                Book a Demo
                <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
              </Link>
              {/* Explore Platform — new tab */}
              <button onClick={() => goToSchool('demo')}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-8 py-4 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-all">
                Explore the platform
                <ChevronRight size={15} className="text-slate-400" />
              </button>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          FIND SCHOOL
      ══════════════════════════════════════════ */}
      <section id="find-school" className="bg-slate-50 border-t border-slate-100 py-14">
        <div className="max-w-md mx-auto px-6 text-center">
          <p className="text-sm font-semibold text-slate-800 mb-1">Already have a school account?</p>
          <p className="text-xs text-slate-400 mb-5">Enter your school name to go to your dedicated portal.</p>
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
          {findError && <p className="mt-3 text-xs text-red-500">{findError}</p>}
        </div>
      </section>

      {/* ══════════════════════════════════════════
          FOOTER
      ══════════════════════════════════════════ */}
      <footer className="border-t border-slate-100 py-10 bg-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-5">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-[10px] font-bold">M</div>
              <span className="text-sm font-bold text-slate-900">Msingi</span>
              <span className="text-xs text-slate-400 ml-1">· The School Operating System</span>
            </div>
            <SocialLinks links={socialLinks} />
            <div className="flex gap-5 text-xs text-slate-400">
              <a href="mailto:hello@msingi.io" className="hover:text-slate-700 transition-colors">hello@msingi.io</a>
              <Link to="/contact" className="hover:text-slate-700 transition-colors">Contact</Link>
              <a href="/platform" className="hover:text-slate-700 transition-colors opacity-40 hover:opacity-70">⚙</a>
            </div>
          </div>
          <p className="text-xs text-slate-400 text-center mt-6">© {new Date().getFullYear()} Msingi. All rights reserved.</p>
        </div>
      </footer>

      <FloatingActions />
    </div>
  );
}
