/* ============================================================
   SchoolSync — Login FX (Canvas Animations for Login Page)
   ============================================================ */

const LoginFX = (() => {
  let _raf = null, _effect = 'none', _color = '#2563EB';
  let _canvas = null, _ctx = null;

  function _rgb(hex) {
    hex = hex.replace('#','');
    if (hex.length === 3) hex = hex.split('').map(c=>c+c).join('');
    const n = parseInt(hex, 16);
    return [(n>>16)&255, (n>>8)&255, n&255];
  }
  function _rgba(hex, a) { const [r,g,b]=_rgb(hex); return `rgba(${r},${g},${b},${a})`; }

  function start(effect, color) {
    stop();
    _canvas = document.getElementById('login-canvas');
    if (!_canvas) return;
    _effect = effect || 'none';
    _color  = (color && /^#[0-9a-fA-F]{3,6}$/.test(color)) ? color : '#2563EB';
    if (_effect === 'none') return;
    _resize();
    _ctx = _canvas.getContext('2d');
    _canvas.style.opacity = '1';
    window.addEventListener('resize', _onResize);
    const fx = { particles:_fxParticles, aurora:_fxAurora, water:_fxWater, clouds:_fxClouds, fire:_fxFire };
    if (fx[_effect]) fx[_effect]();
  }

  function stop() {
    if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
    window.removeEventListener('resize', _onResize);
    const cv = document.getElementById('login-canvas');
    if (cv) {
      cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
      cv.style.opacity = '0';
    }
    _canvas = null; _ctx = null;
  }

  function _onResize() { _resize(); }
  function _resize() {
    if (!_canvas) return;
    _canvas.width  = _canvas.offsetWidth  || 640;
    _canvas.height = _canvas.offsetHeight || 900;
  }

  /* ── Particles ── */
  function _fxParticles() {
    const W=()=>_canvas.width, H=()=>_canvas.height;
    const dots = Array.from({length:65}, ()=>({
      x:Math.random()*W(), y:Math.random()*H(),
      r:Math.random()*2.5+0.5,
      vx:(Math.random()-.5)*.45, vy:-(Math.random()*.65+.15),
      o:Math.random()*.5+.1
    }));
    const loop=()=>{
      if(!_canvas||!_ctx) return;
      _ctx.clearRect(0,0,W(),H());
      dots.forEach(d=>{
        d.x+=d.vx; d.y+=d.vy;
        if(d.y<-6){d.y=H()+6;d.x=Math.random()*W();}
        if(d.x<-6) d.x=W()+6; if(d.x>W()+6) d.x=-6;
        _ctx.beginPath(); _ctx.arc(d.x,d.y,d.r,0,Math.PI*2);
        _ctx.fillStyle=_rgba(_color,d.o); _ctx.fill();
      });
      _raf=requestAnimationFrame(loop);
    };
    loop();
  }

  /* ── Aurora ── */
  function _fxAurora() {
    let t=0;
    const loop=()=>{
      if(!_canvas||!_ctx) return;
      const w=_canvas.width, h=_canvas.height;
      _ctx.clearRect(0,0,w,h);
      const [r,g,b]=_rgb(_color);
      for(let i=0;i<5;i++){
        const y0=h*(0.12+i*0.18)+Math.sin(t*0.4+i*1.3)*28;
        const gr=_ctx.createLinearGradient(0,y0-70,0,y0+70);
        const a=(0.08-i*0.012)*Math.max(0.3,Math.sin(t*.25+i)*.5+.5);
        gr.addColorStop(0,`rgba(${r},${g},${b},0)`);
        gr.addColorStop(.5,`rgba(${r},${g},${b},${a})`);
        gr.addColorStop(1,`rgba(${r},${g},${b},0)`);
        _ctx.fillStyle=gr;
        _ctx.beginPath(); _ctx.moveTo(0,y0);
        for(let x=0;x<=w;x+=8){
          _ctx.lineTo(x, y0+Math.sin(x/130+t+i)*22+Math.sin(x/55+t*.8+i)*10);
        }
        _ctx.lineTo(w,h); _ctx.lineTo(0,h); _ctx.closePath(); _ctx.fill();
      }
      t+=0.009; _raf=requestAnimationFrame(loop);
    };
    loop();
  }

  /* ── Water ── */
  function _fxWater() {
    let t=0;
    const loop=()=>{
      if(!_canvas||!_ctx) return;
      const w=_canvas.width, h=_canvas.height;
      _ctx.clearRect(0,0,w,h);
      const [r,g,b]=_rgb(_color);
      for(let i=0;i<6;i++){
        const baseY=h*(0.32+i*0.12);
        _ctx.fillStyle=`rgba(${r},${g},${b},${0.028+i*0.018})`;
        _ctx.beginPath(); _ctx.moveTo(0,h); _ctx.lineTo(0,baseY);
        for(let x=0;x<=w;x+=6){
          _ctx.lineTo(x, baseY+Math.sin(x/95+t+i*.75)*18+Math.sin(x/48+t*1.5+i)*7);
        }
        _ctx.lineTo(w,h); _ctx.closePath(); _ctx.fill();
      }
      t+=0.022; _raf=requestAnimationFrame(loop);
    };
    loop();
  }

  /* ── Clouds ── */
  function _fxClouds() {
    const W=()=>_canvas.width, H=()=>_canvas.height;
    const cls=Array.from({length:7},()=>({
      x:Math.random()*W()*1.4, y:Math.random()*H()*0.55+20,
      r:Math.random()*55+35, v:Math.random()*.22+.07,
      o:Math.random()*.065+.025
    }));
    const draw=(c)=>{
      _ctx.fillStyle=`rgba(255,255,255,${c.o})`;
      [[0,0,1],[.55,-.22,.72],[-.43,-.1,.62],[.9,.08,.5],[-.75,.18,.45]].forEach(([dx,dy,s])=>{
        _ctx.beginPath(); _ctx.arc(c.x+dx*c.r,c.y+dy*c.r,c.r*s,0,Math.PI*2); _ctx.fill();
      });
    };
    const loop=()=>{
      if(!_canvas||!_ctx) return;
      _ctx.clearRect(0,0,W(),H());
      cls.forEach(c=>{ c.x+=c.v; if(c.x-c.r>W()*1.5) c.x=-c.r*2; draw(c); });
      _raf=requestAnimationFrame(loop);
    };
    loop();
  }

  /* ── Fire ── */
  function _fxFire() {
    const W=()=>_canvas.width, H=()=>_canvas.height;
    const mk=()=>({
      x:W()/2+(Math.random()-.5)*W()*.52, y:H()+Math.random()*15,
      vx:(Math.random()-.5)*1.6, vy:-(Math.random()*2.8+.7),
      life:Math.random()*.55+.45, decay:Math.random()*.013+.006,
      r:Math.random()*11+4
    });
    const pts=Array.from({length:90},mk);
    const loop=()=>{
      if(!_canvas||!_ctx) return;
      _ctx.clearRect(0,0,W(),H());
      pts.forEach((p,i)=>{
        p.x+=p.vx+Math.sin(Date.now()/620+i)*.4; p.y+=p.vy;
        p.life-=p.decay; p.r*=.9975;
        if(p.life<=0) Object.assign(p,mk());
        const gr=_ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r);
        gr.addColorStop(0,  `rgba(255,215,55,${p.life*.9})`);
        gr.addColorStop(.38,`rgba(255,65,0,${p.life*.6})`);
        gr.addColorStop(1,  `rgba(80,0,0,0)`);
        _ctx.beginPath(); _ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
        _ctx.fillStyle=gr; _ctx.fill();
      });
      _raf=requestAnimationFrame(loop);
    };
    loop();
  }

  return { start, stop };
})();

/* ============================================================
   SchoolSync — App Core (Router, Utilities, Navigation)
   ============================================================ */

const App = (() => {
  const ROUTES = {
    dashboard:     () => Dashboard.render(),
    admissions:    (p) => Admissions.render(p),
    apply:         (p) => Admissions.renderPublicForm(p),
    students:      (p) => Students.render(p),
    'students/new':(p) => Students.renderNew(p),
    teachers:      (p) => HR.render(p),   // redirected — Teachers merged into HR
    classes:       (p) => Classes.render(p),
    subjects:      (p) => Subjects.render(p),
    timetable:     (p) => Timetable.render(p),
    attendance:    (p) => Attendance.render(p),
    academics:     (p) => Academics.render(p),
    finance:       (p) => Finance.render(p),
    communication: (p) => Communication.render(p),
    events:        (p) => Events.render(p),
    reports:       (p) => Reports.render(p),
    settings:      (p) => Settings.render(p),
    exams:         (p) => (typeof Exams !== 'undefined' ? Exams.render(p) : _moduleComingSoon('Exams')),
    hr:            (p) => (typeof HR        !== 'undefined' ? HR.render(p)        : _moduleComingSoon('HR & Staff')),
    behaviour:     (p) => (typeof Behaviour  !== 'undefined' ? Behaviour.render(p)  : _moduleComingSoon('Behaviour & Pastoral')),
    changelog:     ()  => (typeof Changelog  !== 'undefined' ? Changelog.render()   : _moduleComingSoon('Changelog')),
    help:          ()  => (typeof Help       !== 'undefined' ? Help.render()        : _moduleComingSoon('Help Centre')),
  };

  /* ── Master list of all modules with their nav metadata ── */
  const NAV_ITEMS = {
    dashboard:          { icon:'fas fa-th-large',           label:'Dashboard',           route:'dashboard' },
    admissions:         { icon:'fas fa-file-import',        label:'Admissions',          route:'admissions' },
    students:           { icon:'fas fa-user-graduate',      label:'Students',            route:'students' },
    // teachers removed from nav — merged into HR & Staff module
    classes:            { icon:'fas fa-door-open',          label:'Classes',             route:'classes' },
    subjects:           { icon:'fas fa-book',               label:'Subjects',            route:'subjects' },
    timetable:          { icon:'fas fa-calendar-alt',       label:'Timetable',           route:'timetable' },
    attendance:         { icon:'fas fa-clipboard-check',    label:'Attendance',          route:'attendance' },
    academics:          { icon:'fas fa-graduation-cap',     label:'Academics',           route:'academics' },
    exams:              { icon:'fas fa-file-alt',           label:'Exams',               route:'exams' },
    finance:            { icon:'fas fa-coins',              label:'Finance',             route:'finance' },
    communication:      { icon:'fas fa-comment-dots',       label:'Communication',       route:'communication' },
    events:             { icon:'fas fa-calendar',           label:'Events & Calendar',   route:'events' },
    reports:            { icon:'fas fa-chart-bar',          label:'Reports & Analytics', route:'reports' },
    hr:                 { icon:'fas fa-id-card',            label:'HR & Staff',          route:'hr' },
    behaviour:          { icon:'fas fa-shield-alt',         label:'Behaviour & Pastoral',route:'behaviour' },
    settings:           { icon:'fas fa-cog',                label:'Settings',            route:'settings' },
    changelog:          { icon:'fas fa-history',            label:'Changelog',           route:'changelog' },
    help:               { icon:'fas fa-question-circle',    label:'Help Centre',         route:'help' },
  };

  /* NAV is now built dynamically from role_permissions — kept for legacy fallback only */
  const NAV = {};

  let _currentRoute = 'dashboard';
  let _sidebarOpen = true;

  function init() {
    window.addEventListener('hashchange', _handleHash);
    document.addEventListener('click', _globalClick);
    // Public admission form route — accessible without login
    const initRoute = location.hash.replace('#','').split('/')[0];
    if (initRoute === 'apply') {
      _showPublicForm();
      return;
    }
    if (Auth.isLoggedIn()) {
      _showApp();
    } else {
      _showLogin();
    }
  }

  function _handleHash() {
    const route = location.hash.replace('#', '').split('/')[0];
    // Allow public admission form without login
    if (route === 'apply') { _showPublicForm(); return; }
    if (!Auth.isLoggedIn()) return;
    const hash  = location.hash.replace('#', '').split('/');
    const param = hash[1] || null;
    _render(route, param);
  }

  function _showPublicForm() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-shell').classList.add('hidden');
    // Render the public form into body directly
    let pf = document.getElementById('public-form-screen');
    if (!pf) {
      pf = document.createElement('div');
      pf.id = 'public-form-screen';
      document.body.appendChild(pf);
    }
    pf.style.display = 'block';
    const token = location.hash.replace('#','').split('/')[1] || '';
    Admissions.renderPublicForm(token, pf);
  }

  function navigate(route, param) {
    location.hash = param ? `${route}/${param}` : route;
  }

  function _render(route, param) {
    _currentRoute = route;
    const fn = ROUTES[param ? `${route}/${param}` : route] || ROUTES[route];
    const content = document.getElementById('page-content');
    if (fn && content) {
      content.innerHTML = '<div class="page-loading"><div class="page-loading-spinner"></div><span style="font-size:13px;color:var(--gray-400)">Loading…</span></div>';
      setTimeout(() => { fn(param); }, 60);
    }
    _updateActiveNav(route);
  }

  function renderPage(html) {
    const el = document.getElementById('page-content');
    if (el) el.innerHTML = html;
  }

  function _moduleComingSoon(name) {
    renderPage(`<div class="empty-state" style="padding:60px 0"><i class="fas fa-tools" style="font-size:48px;color:var(--gray-300);margin-bottom:16px"></i><h3 style="color:var(--gray-500)">${name}</h3><p style="color:var(--gray-400)">This module is coming soon.</p></div>`);
  }

  function setBreadcrumb(text) {
    const el = document.getElementById('breadcrumb');
    if (el) el.innerHTML = text;
  }

  function _showApp() {
    LoginFX.stop();
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
    _buildSidebar();
    _buildNotifications();
    _applyBranding();
    const user = Auth.currentUser;
    document.getElementById('sidebar-user-name').textContent = user.name;
    document.getElementById('sidebar-user-role').textContent = Auth.primaryRoleLabel();
    document.getElementById('sidebar-avatar').textContent = user.name.charAt(0);
    document.getElementById('topbar-avatar').textContent = user.name.charAt(0);
    const topbarName = document.getElementById('topbar-name');
    if (topbarName) topbarName.textContent = user.name.split(' ')[0];
    const umHeader = document.getElementById('um-header-name');
    if (umHeader) umHeader.textContent = user.name;
    const school = Auth.currentSchool;
    document.getElementById('sidebar-school-name').textContent = school ? school.shortName : 'SchoolSync';
    // Navigate: if no hash set, go to dashboard; otherwise render current hash
    const hash = location.hash.replace('#', '').split('/')[0];
    if (!hash) {
      navigate('dashboard');
    } else {
      _handleHash();
    }
  }

  /* ── Branding helpers ────────────────────────────────────── */

  function _hexToRgb(hex) {
    const n = parseInt(hex.replace('#',''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function _shadeColor(hex, amount) {
    const [r, g, b] = _hexToRgb(hex);
    return '#' + [r, g, b].map(c => Math.min(255, Math.max(0, c + amount)).toString(16).padStart(2,'0')).join('');
  }
  function _mixWithWhite(hex, ratio) {
    const [r, g, b] = _hexToRgb(hex);
    return '#' + [r, g, b].map(c => Math.round(c * (1 - ratio) + 255 * ratio).toString(16).padStart(2,'0')).join('');
  }

  function _applyBranding() {
    const school = DB.get('schools')[0];
    if (!school) return;

    // 1. Sidebar logo — show uploaded image or fallback to icon
    const logoImg  = document.getElementById('sidebar-logo-img');
    const logoIcon = document.getElementById('sidebar-logo-icon');
    if (logoImg && logoIcon) {
      if (school.logo) {
        logoImg.src = school.logo;
        logoImg.style.display = 'block';
        logoIcon.style.display = 'none';
      } else {
        logoImg.style.display = 'none';
        logoIcon.style.display = '';
      }
    }

    // 2. App name in sidebar + browser title
    const appName = school.appName || 'SchoolSync';
    const appNameEl = document.getElementById('sidebar-app-name');
    if (appNameEl) appNameEl.textContent = appName;
    document.title = appName + ' — School Management System';

    // 3. Favicon
    if (school.favicon) {
      let link = document.querySelector("link[rel~='icon']");
      if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
      link.href = school.favicon;
    }

    // 4. Theme CSS variables
    if (school.theme) {
      const primary   = school.theme.primary   || '#2563EB';
      const sidebarBg = school.theme.sidebarBg || '#0F172A';
      const [r, g, b] = _hexToRgb(primary);
      let style = document.getElementById('ss-theme');
      if (!style) { style = document.createElement('style'); style.id = 'ss-theme'; document.head.appendChild(style); }
      style.textContent = `:root {
        --primary:        ${primary};
        --primary-dark:   ${_shadeColor(primary, -25)};
        --primary-darker: ${_shadeColor(primary, -45)};
        --primary-light:  ${_mixWithWhite(primary, 0.88)};
        --primary-glass:  rgba(${r},${g},${b},0.12);
        --sidebar-bg:     ${sidebarBg};
        --sidebar-active: ${primary};
      }`;
    } else {
      const existing = document.getElementById('ss-theme');
      if (existing) existing.remove();
    }
  }

  function _showLogin() {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('app-shell').classList.add('hidden');
    const school = DB.get('schools')[0];
    _applyLoginPage(school);
  }

  /* ── Login Page personalisation ────────────────────────────── */
  const _LP_DEFAULT_FEATURES = [
    { icon:'fas fa-users',        color:'blue',   title:'Student Information System', desc:'Full profiles, enrollment, and academic history' },
    { icon:'fas fa-chart-line',   color:'purple', title:'Gradebook & Academics',      desc:'Cambridge, IB, and custom curriculum support' },
    { icon:'fas fa-coins',        color:'green',  title:'Financial Management',       desc:'Fee structures, invoicing, and payment tracking' },
    { icon:'fas fa-comment-dots', color:'amber',  title:'Communication Hub',          desc:'Messaging between staff, parents, and students' },
  ];

  function _applyLoginPage(school) {
    if (!school) return;
    const lp      = school.loginPage || {};
    const appName = school.appName || 'SchoolSync';

    // Brand h1 — split at last space or midpoint
    const brandH1 = document.getElementById('login-brand-h1');
    if (brandH1) {
      const name = lp.brandTitle || appName;
      const sp   = name.lastIndexOf(' ');
      if (sp > 0) {
        brandH1.innerHTML = name.slice(0,sp+1) + `<span>${name.slice(sp+1)}</span>`;
      } else {
        const mid = Math.ceil(name.length / 2);
        brandH1.innerHTML = name.slice(0,mid) + `<span>${name.slice(mid)}</span>`;
      }
    }

    // Tagline
    const taglineEl = document.getElementById('login-tagline');
    if (taglineEl) taglineEl.textContent = lp.tagline || 'A complete school management platform for modern international schools — from admissions to graduation.';

    // Welcome panel
    const wtEl = document.getElementById('login-welcome-title');
    if (wtEl) wtEl.textContent = lp.welcomeTitle || 'Welcome back 👋';
    const wsEl = document.getElementById('login-welcome-sub');
    if (wsEl) wsEl.textContent = lp.welcomeSub || 'Sign in to your SchoolSync portal';

    // Footer
    const ftEl = document.getElementById('login-footer-text');
    if (ftEl) ftEl.textContent = lp.footerText || '© 2025 SchoolSync · Meridian International School, Nairobi';

    // Feature list
    const featEl = document.getElementById('login-features-list');
    if (featEl && lp.features && lp.features.length) {
      featEl.innerHTML = lp.features.map(f=>`
        <div class="login-feature">
          <div class="login-feature-icon ${f.color}"><i class="${f.icon}"></i></div>
          <div><h4>${f.title}</h4><p>${f.desc}</p></div>
        </div>`).join('');
    }

    // Social links
    const socialEl = document.getElementById('login-social-links');
    if (socialEl) {
      const soc = lp.social || {};
      const defs = [
        { key:'facebook',  icon:'fab fa-facebook-f',  sc:'#1877F2' },
        { key:'twitter',   icon:'fab fa-x-twitter',   sc:'#000000' },
        { key:'instagram', icon:'fab fa-instagram',   sc:'#E1306C' },
        { key:'linkedin',  icon:'fab fa-linkedin-in', sc:'#0077B5' },
        { key:'whatsapp',  icon:'fab fa-whatsapp',    sc:'#25D366' },
        { key:'youtube',   icon:'fab fa-youtube',     sc:'#FF0000' },
      ].filter(d => soc[d.key]);
      socialEl.innerHTML = defs.length
        ? `<div class="login-social-bar">${defs.map(d=>`<a href="${soc[d.key]}" target="_blank" class="login-social-btn" style="--sc:${d.sc}" title="${d.key}"><i class="${d.icon}"></i></a>`).join('')}</div>`
        : '';
    }

    // Canvas animation
    LoginFX.start(lp.effect || 'none', lp.effectColor || school.theme?.primary || '#2563EB');
  }

  function _buildSidebar() {
    const mods = Auth.visibleModules();
    const nav  = document.getElementById('sidebar-nav');
    const role = Auth.currentUser ? Auth.currentUser.role : '';

    let html = mods.map(mod => {
      const item = NAV_ITEMS[mod];
      if (!item) return '';
      return `<a class="nav-item" href="#${item.route}" data-route="${item.route}">
      <i class="${item.icon}"></i><span>${item.label}</span>
    </a>`;
    }).join('');

    /* ── Always-visible bottom links (not gated by role_permissions) ── */
    html += `<div class="nav-divider" style="margin:8px 12px;border-top:1px solid rgba(255,255,255,.1)"></div>`;

    /* Changelog — admin/superadmin only */
    if (['superadmin','admin'].includes(role)) {
      const cl = NAV_ITEMS.changelog;
      html += `<a class="nav-item" href="#${cl.route}" data-route="${cl.route}">
        <i class="${cl.icon}"></i><span>${cl.label}</span>
      </a>`;
    }

    /* Help Centre — all logged-in roles */
    const hlp = NAV_ITEMS.help;
    html += `<a class="nav-item" href="#${hlp.route}" data-route="${hlp.route}">
      <i class="${hlp.icon}"></i><span>${hlp.label}</span>
    </a>`;

    nav.innerHTML = html;
  }

  function _updateActiveNav(route) {
    // teachers route is merged into hr — highlight hr nav item for both
    const activeRoute = route === 'teachers' ? 'hr' : route;
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.route === activeRoute);
    });
  }

  function _buildNotifications() {
    const msgs = DB.get('messages').filter(m =>
      m.recipients.includes('all') ||
      m.recipients.includes(Auth.currentUser.role + 's') ||
      m.recipients.includes(Auth.currentUser.id)
    ).slice(0, 5);

    const list = document.getElementById('notifications-list');
    const badge = document.getElementById('notif-badge');
    if (!list) return;

    list.innerHTML = msgs.length ? msgs.map(m => `
      <div class="notif-item" onclick="App.navigate('communication')">
        <div class="notif-icon"><i class="fas fa-bell"></i></div>
        <div class="notif-body">
          <p>${m.subject}</p>
          <span>${_timeAgo(m.createdAt)}</span>
        </div>
      </div>
    `).join('') : '<div class="notif-empty">No new notifications</div>';

    badge.textContent = msgs.length;
    badge.style.display = msgs.length ? 'flex' : 'none';
  }

  function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      const isOpen = sidebar.classList.contains('mobile-open');
      sidebar.classList.toggle('mobile-open', !isOpen);
      if (overlay) overlay.classList.toggle('show', !isOpen);
    } else {
      _sidebarOpen = !_sidebarOpen;
      sidebar.classList.toggle('collapsed', !_sidebarOpen);
      document.querySelector('.main-content').classList.toggle('sidebar-collapsed', !_sidebarOpen);
    }
  }

  function _globalClick(e) {
    if (!e.target.closest('.notif-wrap')) {
      const dd = document.getElementById('notification-dropdown');
      if (dd) dd.classList.remove('open');
    }
    if (!e.target.closest('.topbar-profile')) {
      const um = document.getElementById('user-menu');
      if (um) um.classList.remove('open');
    }
  }

  function globalSearch(val) {
    if (!val || val.length < 2) return;
    const q = val.toLowerCase();
    const students = DB.get('students').filter(s =>
      `${s.firstName} ${s.lastName}`.toLowerCase().includes(q) || s.admissionNo.toLowerCase().includes(q)
    );
    if (students.length === 1) navigate('students', students[0].id);
  }

  /* ─── Utilities ─── */
  function _capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

  function _timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff/60000);
    if (m < 1) return 'Just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m/60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h/24)}d ago`;
  }

  return { init, navigate, renderPage, setBreadcrumb, toggleSidebar, globalSearch, applyBranding: _applyBranding, applyLoginPage: _applyLoginPage, LP_DEFAULT_FEATURES: _LP_DEFAULT_FEATURES, _showApp, _showLogin };
})();

/* ─── Global Utilities ─── */
function showToast(msg, type = 'success') {
  const tc = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  const icons = { success:'check-circle', error:'exclamation-circle', warning:'exclamation-triangle', info:'info-circle' };
  t.innerHTML = `<i class="fas fa-${icons[type]||'info-circle'}"></i><span>${msg}</span>`;
  tc.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3500);
}

function openModal(html, size = '') {
  const overlay = document.getElementById('modal-overlay');
  const container = document.getElementById('modal-container');
  const content = document.getElementById('modal-content');
  content.innerHTML = html;
  container.className = `modal-container ${size}`;
  overlay.classList.remove('hidden');
  requestAnimationFrame(() => overlay.classList.add('open'));
}

function closeModal(e) {
  if (e && e.target !== document.getElementById('modal-overlay')) return;
  _closeModal();
}

function _closeModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.remove('open');
  setTimeout(() => overlay.classList.add('hidden'), 250);
}

function togglePassword() {
  const inp = document.getElementById('login-password');
  const icon = document.getElementById('eye-icon');
  if (inp.type === 'password') { inp.type = 'text'; icon.className = 'fas fa-eye-slash'; }
  else { inp.type = 'password'; icon.className = 'fas fa-eye'; }
}

function fillDemo(role) {
  const creds = {
    superadmin:  { email:'superadmin@meridian.edu.ke',      pass:'super123' },
    admin:       { email:'admin@meridian.edu.ke',           pass:'admin123' },
    teacher:     { email:'sarah.smith@meridian.edu.ke',     pass:'teacher123' },
    admissions:  { email:'admissions@meridian.edu.ke',      pass:'admissions123' },
    finance:     { email:'finance@meridian.edu.ke',         pass:'finance123' },
    parent:      { email:'parent1@meridian.edu.ke',         pass:'parent123' },
    student:     { email:'student1@meridian.edu.ke',        pass:'student123' },
    hr:          { email:'hr@meridian.edu.ke',              pass:'hr123' },
    section_sec: { email:'head.secondary@meridian.edu.ke',  pass:'section123' },
    deputy:      { email:'deputy@meridian.edu.ke',          pass:'deputy123' },
    discipline:  { email:'discipline@meridian.edu.ke',      pass:'discipline123' }
  };
  const c = creds[role];
  if (c) {
    document.getElementById('login-email').value    = c.email;
    document.getElementById('login-password').value = c.pass;
  }
}

function toggleNotifications() {
  const dd = document.getElementById('notification-dropdown');
  if (dd) dd.classList.toggle('open');
}

function markAllRead() {
  document.getElementById('notif-badge').style.display = 'none';
}

function toggleUserMenu() {
  const um = document.getElementById('user-menu');
  if (um) um.classList.toggle('open');
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-KE', { day:'2-digit', month:'short', year:'numeric' });
}

function fmtMoney(n, sym = 'KSh') {
  if (n == null) return '—';
  return `${sym} ${Number(n).toLocaleString()}`;
}

function fmtPct(n) {
  return n != null ? `${Number(n).toFixed(1)}%` : '—';
}

function gradeColor(pct) {
  if (pct >= 90) return 'success';
  if (pct >= 75) return 'primary';
  if (pct >= 60) return 'warning';
  return 'danger';
}

function statusBadge(status) {
  const map = {
    active:'success', paid:'success', present:'success', good:'success',
    partial:'warning', late:'warning', pending:'warning', overdue:'danger',
    absent:'danger', inactive:'danger',
    graduated:'info', transferred:'secondary', withdrawn:'secondary'
  };
  return map[status] || 'secondary';
}

function avatar(name, role) {
  const colors = { admin:'#2563EB', teacher:'#7C3AED', parent:'#059669', student:'#D97706', finance:'#DC2626' };
  const bg = colors[role] || '#64748B';
  return `<div class="avatar-circle" style="background:${bg}">${name.charAt(0).toUpperCase()}</div>`;
}

function confirmAction(msg, fn) {
  if (confirm(msg)) fn();
}

/* ─────────────────────────────────────────────────────────────
   Global Utility Functions
   ───────────────────────────────────────────────────────────── */

/**
 * _audit(action, details)
 * Appends an immutable audit log entry to the 'audit_log' collection.
 * Called internally — never throws or shows UI feedback.
 *
 * Targeted operations:
 *   STUDENT_UPDATED      · STUDENT_DELETED
 *   PAYMENT_RECORDED
 *   APPEAL_RESOLVED
 *   ACADEMIC_YEAR_CHANGED · TERM_CHANGED
 *   PERMISSION_CHANGED
 *   ACADEMIC_YEAR_DELETED
 *
 * @param {string} action  — one of the constants above
 * @param {object} details — free-form context (IDs, names, amounts, etc.)
 */
function _audit(action, details = {}) {
  try {
    const user = (typeof Auth !== 'undefined' && Auth.currentUser) ? Auth.currentUser : null;
    DB.insert('audit_log', {
      action,
      performedBy:   user ? user.id   : 'system',
      performedByName: user ? user.name : 'System',
      performedAt:   new Date().toISOString(),
      details
    });
  } catch (e) {
    /* Audit must never break the primary action */
    console.warn('[audit] failed to log', action, e);
  }
}

/**
 * assert(condition, message)
 * Throws a descriptive error if `condition` is falsy.
 * Use before DB.insert / DB.update to catch bad data early.
 *
 * @param {*}      condition  — truthy = ok, falsy = throw
 * @param {string} message    — human-readable description of the problem
 */
function assert(condition, message) {
  if (!condition) {
    const err = new Error(`[SchoolSync] Assertion failed: ${message}`);
    console.error(err);
    throw err;
  }
}

/**
 * safe(fn, label)
 * Wraps a UI action handler so that unexpected errors show a toast
 * instead of silently swallowing the exception or crashing the page.
 *
 * Usage: onclick="safe(() => MyModule.doThing(), 'doThing')"
 *
 * @param {Function} fn     — the action to run
 * @param {string}   label  — shown in the error toast (optional)
 */
function safe(fn, label = 'action') {
  try {
    fn();
  } catch (err) {
    console.error(`[SchoolSync] Error in ${label}:`, err);
    showToast(`Something went wrong (${label}). See console for details.`, 'error');
  }
}

/**
 * isOverlapping(aStart, aEnd, bStart, bEnd)
 * Returns true when time range [aStart, aEnd) overlaps [bStart, bEnd).
 * All values are HH:MM strings (24-hour), e.g. '09:00', '10:30'.
 * A range that ends exactly when another starts is NOT an overlap.
 *
 * @param {string} aStart
 * @param {string} aEnd
 * @param {string} bStart
 * @param {string} bEnd
 * @returns {boolean}
 */
function isOverlapping(aStart, aEnd, bStart, bEnd) {
  const toMins = t => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const aS = toMins(aStart), aE = toMins(aEnd);
  const bS = toMins(bStart), bE = toMins(bEnd);
  return aS < bE && bS < aE;
}

/* Boot */
document.addEventListener('DOMContentLoaded', () => App.init());
