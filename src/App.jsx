import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { db } from "./firebase";
import { collection, onSnapshot, addDoc, updateDoc, doc, query, orderBy } from "firebase/firestore";
import emailjs from "@emailjs/browser";

/* ─── ENV ─────────────────────────────────────────────────────────────── */
const EJS_SVC = import.meta.env.VITE_EMAILJS_SERVICE_ID || "";
const EJS_VERIFY = import.meta.env.VITE_EMAILJS_TEMPLATE_VERIFY || "";
const EJS_STATUS = import.meta.env.VITE_EMAILJS_TEMPLATE_STATUS || "";
const EJS_CONFIRM = import.meta.env.VITE_EMAILJS_TEMPLATE_CONFIRM || "";
const EJS_KEY = import.meta.env.VITE_EMAILJS_PUBLIC_KEY || "";
const MGR_PASS = import.meta.env.VITE_MANAGER_PASSWORD || "Hire4Hope26";
const ADMIN_SET = new Set(
  (import.meta.env.VITE_ADMIN_EMAILS || "melissa@hopecoffee.com")
    .split(",")
    .map((s) => s.trim().toLowerCase())
);

/* ─── STYLES ───────────────────────────────────────────────────────────── */
const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800&family=DM+Sans:wght@300;400;500;600;700&display=swap');

  :root {
    --green-950: #022c22;
    --green-900: #064e3b;
    --green-800: #065f46;
    --green-700: #047857;
    --green-600: #059669;
    --green-500: #10b981;
    --green-400: #34d399;
    --green-100: #d1fae5;
    --green-50:  #ecfdf5;

    --amber-700: #b45309;
    --amber-500: #f59e0b;
    --amber-100: #fef3c7;
    --amber-50:  #fffbeb;

    --red-700:   #b91c1c;
    --red-500:   #ef4444;
    --red-100:   #fecdd3;
    --red-50:    #fff1f2;

    --blue-700:  #1e40af;
    --blue-500:  #3b82f6;
    --blue-100:  #dbeafe;
    --blue-50:   #eff6ff;

    --ink:       #1a1a2e;
    --ink-muted: #6b7280;
    --ink-faint: #9ca3af;
    --border:    #e5e7eb;
    --border-soft:#f3f4f6;
    --surface:   #ffffff;
    --bg:        #f7f8f6;

    --hero: linear-gradient(155deg, #022c22 0%, #065f46 40%, #047857 70%, #059669 100%);
    --btn:  linear-gradient(155deg, #059669, #065f46);
    --radius-sm: 10px;
    --radius-md: 14px;
    --radius-lg: 20px;
    --radius-xl: 24px;

    --shadow-sm:  0 1px 3px rgba(0,0,0,.07), 0 1px 2px rgba(0,0,0,.05);
    --shadow-md:  0 4px 16px rgba(0,0,0,.08);
    --shadow-lg:  0 12px 40px rgba(0,0,0,.1);
    --shadow-green: 0 8px 28px rgba(5,150,105,.3);
  }

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'DM Sans', sans-serif;
    background: var(--bg);
    color: var(--ink);
    -webkit-font-smoothing: antialiased;
  }

  /* ── Animations ── */
  @keyframes fadeUp   { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:none; } }
  @keyframes scaleIn  { from { opacity:0; transform:scale(.97); } to { opacity:1; transform:scale(1); } }
  @keyframes chatPop  { from { opacity:0; transform:scale(.9) translateY(12px); } to { opacity:1; transform:none; } }
  @keyframes wiggle   { 0%,100%{transform:rotate(0)} 25%{transform:rotate(-8deg)} 75%{transform:rotate(8deg)} }
  @keyframes spinAnim { to { transform:rotate(360deg); } }
  @keyframes dotBounce{ 0%,80%,100%{transform:scale(0)} 40%{transform:scale(1)} }
  @keyframes confetti { to { transform:translateY(110vh) rotate(720deg); opacity:0; } }
  @keyframes ovIn     { from{opacity:0} to{opacity:1} }
  @keyframes popIn    { from{transform:scale(0)} to{transform:scale(1)} }
  @keyframes checkDraw{ from{stroke-dashoffset:50} to{stroke-dashoffset:0} }
  @keyframes textUp   { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:none} }
  @keyframes slideL   { from{opacity:0;transform:translateX(-8px)} to{opacity:1;transform:none} }
  @keyframes pulseRing{ 0%{box-shadow:0 0 0 0 rgba(16,185,129,.5)} 100%{box-shadow:0 0 0 24px rgba(16,185,129,0)} }
  @keyframes shimmer  { from{background-position:200% center} to{background-position:-200% center} }
  @keyframes float    { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
  @keyframes pulse2   { 0%,100%{box-shadow:0 0 0 0 rgba(5,150,105,.4)} 50%{box-shadow:0 0 0 8px rgba(5,150,105,0)} }

  .anim-fade-up  { animation: fadeUp .45s ease both; }
  .anim-scale-in { animation: scaleIn .4s cubic-bezier(.34,1.56,.64,1) both; }
  .anim-float    { animation: float 3s ease-in-out infinite; }
  .anim-spin     { animation: spinAnim .7s linear infinite; }

  /* ── Layout ── */
  .app-shell { display:flex; flex-direction:column; height:100vh; }

  /* ── Navbar ── */
  .navbar {
    flex-shrink:0;
    display:flex;
    align-items:center;
    height:58px;
    padding:0 20px;
    background:var(--surface);
    border-bottom:1px solid var(--border);
    box-shadow:var(--shadow-sm);
    gap:4px;
  }
  .nav-brand {
    display:flex; align-items:center; gap:10px;
    margin-right:16px; padding:4px 8px; border-radius:10px;
    background:none; border:none; cursor:pointer;
    text-decoration:none;
  }
  .nav-brand:hover { background:var(--green-50); }
  .nav-brand-name {
    font-family:'Playfair Display',serif;
    font-size:16px; font-weight:700; line-height:1;
    background:var(--btn);
    -webkit-background-clip:text; -webkit-text-fill-color:transparent;
  }
  .nav-brand-sub { font-size:10px; color:var(--ink-faint); margin-top:2px; line-height:1; }
  .nav-divider { width:1px; height:20px; background:var(--green-100); margin-right:8px; }
  .nav-btn {
    display:flex; align-items:center; gap:6px; padding:7px 14px;
    border-radius:var(--radius-sm); border:none; font-size:13px;
    cursor:pointer; font-family:'DM Sans',sans-serif;
    transition:all .18s;
  }
  .nav-btn:not(.active) { background:transparent; color:var(--ink-faint); font-weight:500; }
  .nav-btn:not(.active):hover { background:var(--green-50); color:var(--green-600); }
  .nav-btn.active { background:var(--green-50); color:var(--green-600); font-weight:700; border-bottom:2px solid var(--green-600); }
  .nav-mgr-btn {
    margin-left:auto; display:flex; align-items:center; gap:5px;
    padding:5px 10px; border-radius:var(--radius-sm); font-size:11px; font-weight:500;
    cursor:pointer; transition:all .18s; font-family:'DM Sans',sans-serif;
  }
  .nav-mgr-btn:not(.active) { border:1px solid var(--border-soft); background:transparent; color:var(--border); }
  .nav-mgr-btn.active { border:1px solid var(--green-100); background:var(--green-50); color:var(--green-600); }

  /* ── Page scroll ── */
  .page-scroll { flex:1; overflow:auto; }
  .page-hidden  { flex:1; overflow:hidden; }

  /* ── Hero ── */
  .hero {
    position:relative; overflow:hidden;
    background:var(--hero);
    padding:52px 24px 68px;
  }
  .hero::before {
    content:''; position:absolute; top:-80px; right:-80px;
    width:320px; height:320px; border-radius:50%;
    background:radial-gradient(circle, rgba(52,211,153,.15), transparent 65%);
    pointer-events:none;
  }
  .hero-inner { position:relative; z-index:2; max-width:580px; margin:0 auto; }
  .hero-tag {
    display:inline-flex; align-items:center; gap:10px;
    margin-bottom:22px;
  }
  .hero-tag-icon {
    border-radius:14px; padding:10px 12px;
    background:rgba(255,255,255,.1);
    border:1px solid rgba(255,255,255,.15);
  }
  .hero-eyebrow { font-size:12px; font-weight:600; color:#6ee7b7; letter-spacing:.04em; text-transform:uppercase; }
  .hero-shop    { font-size:15px; font-weight:600; color:#ecfdf5; margin-top:2px; }
  .hero-h1 {
    font-family:'Playfair Display',serif;
    font-size:clamp(34px,5vw,48px);
    font-weight:800; color:#fff;
    line-height:1.1; letter-spacing:-.5px;
    margin-bottom:14px;
  }
  .hero-sub { font-size:15px; line-height:1.75; color:rgba(255,255,255,.82); font-weight:300; max-width:460px; margin-bottom:22px; }
  .hero-pills { display:flex; gap:8px; flex-wrap:wrap; }
  .hero-pill {
    font-size:12px; font-weight:600; padding:5px 12px; border-radius:20px;
    background:rgba(255,255,255,.09); color:rgba(255,255,255,.82);
    border:1px solid rgba(255,255,255,.13);
  }

  /* ── Card wrapper ── */
  .card-wrap { max-width:580px; margin:0 auto; padding:0 16px 80px; }
  .card {
    background:var(--surface); border-radius:var(--radius-xl);
    border:1px solid var(--border);
    box-shadow:var(--shadow-lg);
  }
  .card-pull { margin-top:-36px; }
  .card-pull-sm { margin-top:-24px; }
  .card-body { padding:32px 28px; }

  /* ── Form elements ── */
  .field-label {
    display:block; font-size:13px; font-weight:600;
    color:var(--green-600); margin-bottom:7px; letter-spacing:.01em;
  }
  .field-opt { font-weight:400; color:var(--ink-faint); margin-left:4px; }
  .field-err { display:block; font-size:12px; color:var(--red-500); margin-top:5px; }
  .field-hint { display:block; font-size:11px; color:var(--ink-faint); margin-top:5px; }

  .input {
    width:100%; border-radius:var(--radius-sm); padding:12px 16px;
    font-size:14px; font-family:'DM Sans',sans-serif;
    background:var(--surface); color:var(--ink);
    border:1.5px solid var(--border); outline:none;
    transition:border-color .18s, box-shadow .18s;
  }
  .input:focus { border-color:var(--green-600); box-shadow:0 0 0 3px rgba(5,150,105,.08); }
  .input.err    { border-color:var(--red-500); }
  .input.textarea { resize:vertical; min-height:80px; }

  .divider {
    display:flex; align-items:center; gap:12px; margin:4px 0;
  }
  .divider-line { flex:1; height:1px; }
  .divider-left  { background:linear-gradient(90deg, var(--green-100), transparent); }
  .divider-right { background:linear-gradient(90deg, transparent, var(--green-100)); }
  .divider-label {
    font-size:12px; font-weight:700; color:var(--green-600);
    background:var(--green-50); border:1px solid var(--green-100);
    padding:4px 14px; border-radius:20px; white-space:nowrap;
  }

  /* ── Buttons ── */
  .btn-primary {
    display:inline-flex; align-items:center; justify-content:center; gap:8px;
    background:var(--btn); color:#fff;
    border:none; border-radius:var(--radius-sm);
    padding:13px 22px; font-size:14px; font-weight:700;
    font-family:'DM Sans',sans-serif; cursor:pointer;
    box-shadow:var(--shadow-green);
    transition:opacity .18s, transform .18s, box-shadow .18s;
  }
  .btn-primary:hover:not(:disabled) { opacity:.92; transform:translateY(-1px); box-shadow:0 12px 32px rgba(5,150,105,.4); }
  .btn-primary:active:not(:disabled){ transform:translateY(0); }
  .btn-primary:disabled { background:#e5e7eb; color:var(--ink-faint); box-shadow:none; cursor:not-allowed; }
  .btn-primary.full { width:100%; padding:14px 24px; font-size:15px; border-radius:var(--radius-md); }

  .btn-outline {
    display:inline-flex; align-items:center; gap:6px;
    border:1px solid var(--border); background:transparent; color:var(--ink-faint);
    border-radius:var(--radius-sm); padding:8px 16px; font-size:13px; font-weight:500;
    font-family:'DM Sans',sans-serif; cursor:pointer; transition:all .18s;
  }
  .btn-outline:hover { border-color:var(--green-100); color:var(--green-600); background:var(--green-50); }

  .btn-ghost {
    background:none; border:none; cursor:pointer; font-family:'DM Sans',sans-serif;
    color:var(--ink-faint); font-size:13px; padding:4px 0;
    transition:color .18s;
  }
  .btn-ghost:hover { color:var(--green-600); }

  /* ── Privacy notice ── */
  .privacy-box {
    background:var(--green-50); border:1px solid var(--green-100);
    border-radius:var(--radius-sm); padding:14px 16px; margin-bottom:22px;
    font-size:13px; color:var(--ink-muted); line-height:1.55;
  }

  /* ── Position cards ── */
  .pos-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  @media(max-width:480px){ .pos-grid { grid-template-columns:1fr; } }
  .pos-card {
    border:2px solid var(--border); border-radius:var(--radius-md);
    padding:16px; cursor:pointer; transition:all .2s; position:relative;
    background:var(--surface);
  }
  .pos-card:hover { border-color:var(--green-100); }
  .pos-card.selected { border-color:var(--green-600); background:var(--green-50); }
  .pos-card-check {
    position:absolute; top:10px; right:12px;
    width:18px; height:18px; border-radius:50%;
    background:var(--btn);
    display:flex; align-items:center; justify-content:center;
  }
  .pos-card-top { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
  .pos-card-icon { font-size:18px; }
  .pos-card-title { font-size:14px; font-weight:700; color:var(--ink); }
  .pos-card-badges { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px; }
  .badge {
    font-size:11px; font-weight:600; padding:3px 9px; border-radius:20px;
  }
  .badge-green { background:var(--green-50); color:var(--green-600); border:1px solid var(--green-100); }
  .badge-gray  { background:var(--border-soft); color:var(--ink-faint); }
  .badge-blue  { background:var(--blue-50); color:var(--blue-700); border:1px solid var(--blue-100); }
  .badge-amber { background:var(--amber-50); color:var(--amber-700); border:1px solid var(--amber-100); }
  .pos-card-desc { font-size:12px; color:var(--ink-muted); line-height:1.5; }

  /* ── Resume tabs ── */
  .tab-pill-wrap {
    display:flex; gap:3px; padding:3px;
    background:var(--border-soft); border:1px solid var(--border);
    border-radius:24px; width:fit-content;
  }
  .tab-pill {
    padding:5px 14px; border-radius:20px; border:none; font-size:12px; cursor:pointer;
    font-family:'DM Sans',sans-serif; font-weight:500; transition:all .18s;
    background:transparent; color:var(--ink-faint);
  }
  .tab-pill.active { background:var(--btn); color:#fff; font-weight:700; }

  /* ── Drop zone ── */
  .dropzone {
    border-radius:var(--radius-md); border:2px dashed var(--border);
    background:var(--bg); min-height:128px;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    gap:8px; cursor:pointer; padding:20px;
    transition:all .2s;
  }
  .dropzone:hover, .dropzone.drag { border-color:var(--green-600); background:var(--green-50); }
  .dropzone.has-file { border-color:var(--green-500); background:var(--green-50); }
  .dropzone-icon {
    width:44px; height:44px; border-radius:50%;
    display:flex; align-items:center; justify-content:center;
  }
  .dropzone-icon.empty { background:var(--green-50); }
  .dropzone-icon.filled { background:var(--btn); }

  /* ── Info rows ── */
  .info-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  @media(max-width:480px){ .info-grid { grid-template-columns:1fr; } }
  .info-cell {
    background:var(--bg); border:1px solid var(--border-soft);
    border-radius:var(--radius-sm); padding:11px 14px;
  }
  .info-label { font-size:11px; font-weight:600; color:var(--ink-faint); text-transform:uppercase; letter-spacing:.04em; margin-bottom:3px; }
  .info-value { font-size:13px; font-weight:600; color:var(--ink); }

  /* ── Section heading ── */
  .sec-head { font-size:13px; font-weight:700; color:var(--green-600); margin-bottom:14px; display:flex; align-items:center; gap:6px; }

  /* ── Chip list ── */
  .chip-row { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:20px; }

  /* ── Status page ── */
  .status-card {
    border-radius:var(--radius-xl); padding:22px 24px; margin-bottom:12px;
  }
  .progress-bar { display:flex; align-items:center; }
  .progress-step { display:flex; flex-direction:column; align-items:center; gap:6px; }
  .progress-dot {
    width:36px; height:36px; border-radius:50%;
    display:flex; align-items:center; justify-content:center;
    transition:all .3s;
  }
  .progress-connector { flex:1; height:3px; border-radius:2px; margin:0 4px; margin-bottom:20px; }
  .progress-label { font-size:11px; font-weight:600; }

  /* ── About cards ── */
  .mission-box {
    border-radius:var(--radius-md); padding:20px 22px; margin-bottom:24px;
    background:var(--btn); color:#fff;
  }
  .mission-title { font-family:'Playfair Display',serif; font-size:16px; font-weight:700; color:#ecfdf5; margin-bottom:8px; }
  .mission-text  { font-size:13px; color:rgba(255,255,255,.88); line-height:1.65; }
  .value-card { border-radius:var(--radius-md); padding:16px; border:1px solid var(--border); background:var(--surface); margin-bottom:10px; }
  .value-top { display:flex; align-items:center; gap:10px; margin-bottom:6px; }
  .value-icon { font-size:18px; }
  .value-title { font-size:13px; font-weight:700; color:var(--ink); }
  .value-desc  { font-size:12px; color:var(--ink-muted); line-height:1.55; }

  /* ── Manager sidebar ── */
  .dash-layout { display:flex; height:100%; overflow:hidden; background:var(--bg); }
  .dash-sidebar {
    flex-shrink:0; width:290px; display:flex; flex-direction:column;
    border-right:1px solid var(--border); overflow:hidden;
    background:var(--surface);
  }
  @media(max-width:640px){ .dash-sidebar { width:100%; } }
  .dash-sidebar-header {
    background:var(--hero); padding:16px;
    border-bottom:1px solid rgba(255,255,255,.08);
  }
  .dash-sidebar-brand { display:flex; align-items:center; gap:10px; margin-bottom:12px; }
  .dash-sidebar-greeting {
    border-radius:var(--radius-sm); padding:10px 12px;
    background:rgba(0,0,0,.15); border:1px solid rgba(255,255,255,.08);
  }
  .dash-stats-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; padding:12px; border-bottom:1px solid var(--border); }
  .stat-card {
    border-radius:var(--radius-sm); padding:12px 14px;
    box-shadow:0 4px 12px rgba(0,0,0,.12);
  }
  .stat-number { font-size:26px; font-weight:800; color:#fff; line-height:1; }
  .stat-label  { font-size:11px; font-weight:600; color:rgba(255,255,255,.7); margin-top:2px; }
  .dash-search { padding:10px 12px; border-bottom:1px solid var(--border); }
  .dash-search input {
    width:100%; border-radius:var(--radius-sm); padding:8px 12px;
    font-size:13px; border:1px solid var(--border); background:var(--bg);
    color:var(--ink); outline:none; font-family:'DM Sans',sans-serif;
  }
  .dash-search input:focus { border-color:var(--green-600); }
  .dash-filters { padding:8px 12px; display:flex; flex-wrap:wrap; gap:5px; border-bottom:1px solid var(--border); }
  .filter-chip {
    padding:4px 12px; border-radius:20px; font-size:11px; border:1px solid transparent;
    cursor:pointer; font-family:'DM Sans',sans-serif; transition:all .15s;
    background:transparent; color:var(--ink-faint); font-weight:500;
  }
  .filter-chip.active { background:var(--green-50); color:var(--green-600); font-weight:700; border-color:var(--green-100); }
  .filter-chip:not(.active):hover { background:var(--border-soft); }
  .dash-list { flex:1; overflow-y:auto; padding:8px; }
  .app-row {
    display:block; width:100%; text-align:left; border-radius:var(--radius-sm);
    padding:11px 12px; margin-bottom:4px; cursor:pointer; border:1px solid transparent;
    background:transparent; transition:all .15s; font-family:'DM Sans',sans-serif;
  }
  .app-row:hover { background:var(--bg); }
  .app-row.active { background:var(--green-50); border-color:var(--green-100); }
  .app-row-top { display:flex; justify-content:space-between; margin-bottom:4px; align-items:flex-start; }
  .app-row-name { font-size:13px; font-weight:600; color:var(--ink); }
  .app-row-bottom { display:flex; justify-content:space-between; align-items:center; }
  .app-row-pos { font-size:11px; color:var(--ink-faint); }

  /* ── Detail panel ── */
  .dash-detail { flex:1; overflow-y:auto; padding:24px; }
  .detail-card { background:var(--surface); border-radius:var(--radius-lg); border:1px solid var(--border); padding:24px; box-shadow:var(--shadow-md); animation:fadeUp .3s ease both; }
  .detail-header { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; margin-bottom:18px; }
  .detail-avatar {
    width:52px; height:52px; border-radius:50%; flex-shrink:0;
    display:flex; align-items:center; justify-content:center;
    font-size:20px; font-weight:800; color:#fff;
    background:var(--btn);
  }
  .detail-name { font-family:'Playfair Display',serif; font-size:20px; font-weight:700; color:var(--ink); }
  .detail-meta { font-size:12px; color:var(--ink-faint); margin-top:6px; }

  /* Score ring */
  .score-ring { position:relative; width:76px; height:76px; flex-shrink:0; }
  .score-ring-label { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }
  .score-num { font-size:20px; font-weight:800; }
  .score-denom { font-size:10px; color:var(--ink-faint); }
  .score-tag { font-size:11px; font-weight:600; color:var(--ink-muted); margin-top:4px; text-align:center; }

  /* AI / breakdown boxes */
  .ai-box { border-radius:var(--radius-sm); padding:14px 16px; margin-bottom:12px; background:var(--blue-50); border:1px solid var(--blue-100); }
  .ai-box-title { font-size:11px; font-weight:700; color:var(--blue-700); text-transform:uppercase; letter-spacing:.04em; margin-bottom:6px; }
  .ai-box-text { font-size:13px; color:var(--blue-700); line-height:1.6; }
  .breakdown-box { border-radius:var(--radius-sm); padding:14px 16px; margin-bottom:12px; background:var(--surface); border:1px solid var(--green-100); }
  .breakdown-item { background:var(--bg); border:1px solid var(--border-soft); border-radius:var(--radius-sm); padding:10px 12px; }
  .breakdown-bar-track { height:4px; border-radius:2px; overflow:hidden; background:var(--green-50); margin-top:6px; margin-bottom:4px; }
  .breakdown-bar-fill  { height:100%; border-radius:2px; transition:width 1s ease; }

  /* Resume box */
  .resume-box { border-radius:var(--radius-sm); padding:14px 16px; margin-bottom:12px; background:var(--green-50); border:1px solid var(--green-100); }

  /* Status buttons */
  .status-btns { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
  .status-btn {
    padding:9px 16px; border-radius:var(--radius-sm); font-size:12px; font-weight:700;
    border:none; cursor:pointer; transition:all .18s; font-family:'DM Sans',sans-serif;
  }

  /* Delete confirm */
  .delete-zone { border-top:1px solid var(--green-50); padding-top:12px; }

  /* ── Manager auth ── */
  .auth-wrap {
    display:flex; align-items:center; justify-content:center;
    min-height:100%; padding:24px;
    background:radial-gradient(ellipse at center, rgba(5,150,105,.06), transparent 70%);
  }
  .auth-card {
    background:var(--surface); border-radius:var(--radius-xl);
    padding:44px 38px; width:min(400px, calc(100vw - 32px));
    border:1px solid var(--border); box-shadow:var(--shadow-lg);
    text-align:center;
  }
  .auth-logo-wrap {
    width:72px; height:72px; border-radius:50%;
    display:flex; align-items:center; justify-content:center;
    margin:0 auto 22px;
    background:var(--btn); box-shadow:var(--shadow-green);
  }
  .auth-title { font-family:'Playfair Display',serif; font-size:22px; font-weight:700; color:var(--ink); margin-bottom:6px; }
  .auth-sub   { font-size:13px; color:var(--ink-muted); margin-bottom:22px; line-height:1.55; }
  .auth-input-wrap { display:flex; flex-direction:column; gap:12px; margin-bottom:14px; }
  .auth-input {
    width:100%; border-radius:var(--radius-sm); padding:13px 16px;
    font-size:14px; font-family:'DM Sans',sans-serif;
    background:var(--surface); color:var(--ink);
    border:1.5px solid var(--border); outline:none; text-align:center;
    transition:border-color .18s;
  }
  .auth-input.err { border-color:var(--red-500); }
  .auth-input:focus { border-color:var(--green-600); }
  .pass-wrap { position:relative; }
  .show-toggle {
    position:absolute; right:14px; top:50%; transform:translateY(-50%);
    background:none; border:none; cursor:pointer; font-size:12px; font-weight:600;
    color:var(--ink-faint);
  }
  .auth-err { font-size:12px; color:var(--red-500); margin-bottom:10px; }
  .auth-warn{ font-size:12px; color:var(--amber-700); margin-bottom:10px; }

  /* ── Chatbot ── */
  .chat-fab {
    position:fixed; bottom:24px; right:24px; z-index:1000;
    width:56px; height:56px; border-radius:50%;
    background:linear-gradient(155deg, #065f46, #059669);
    border:none; cursor:pointer;
    display:flex; align-items:center; justify-content:center;
    box-shadow:0 8px 28px rgba(5,150,105,.4);
    transition:transform .18s, box-shadow .18s;
  }
  .chat-fab:hover { transform:scale(1.05); box-shadow:0 12px 36px rgba(5,150,105,.5); }
  .chat-badge {
    position:absolute; top:0; right:0;
    width:16px; height:16px; border-radius:50%;
    background:var(--btn); border:2px solid var(--green-950);
    display:flex; align-items:center; justify-content:center;
    font-size:7px; font-weight:800; color:#fff;
  }
  .chat-window {
    position:fixed; bottom:96px; right:24px; z-index:999;
    width:min(380px, calc(100vw - 32px)); max-height:500px;
    display:flex; flex-direction:column;
    background:#fefefe; border-radius:var(--radius-xl);
    overflow:hidden; animation:chatPop .38s cubic-bezier(.34,1.56,.64,1) both;
    box-shadow:0 24px 64px rgba(0,0,0,.15), 0 4px 16px rgba(0,0,0,.08);
    border:1px solid var(--green-100);
  }
  .chat-header {
    display:flex; align-items:center; gap:12px; padding:14px 18px;
    background:linear-gradient(155deg, #065f46, #059669);
  }
  .chat-header-avatar {
    width:36px; height:36px; border-radius:50%;
    display:flex; align-items:center; justify-content:center; flex-shrink:0;
    background:rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.2);
  }
  .chat-name { font-size:14px; font-weight:700; color:#fff; }
  .chat-status { font-size:11px; color:#6ee7b7; display:flex; align-items:center; gap:6px; margin-top:2px; }
  .chat-status-dot { width:6px; height:6px; border-radius:50%; background:#34d399; box-shadow:0 0 6px #34d399; display:inline-block; }
  .chat-msgs { flex:1; overflow-y:auto; padding:12px 12px 6px; display:flex; flex-direction:column; gap:10px; min-height:0; }
  .chat-msg { display:flex; }
  .chat-msg.user   { justify-content:flex-end; }
  .chat-msg.bot    { justify-content:flex-start; }
  .chat-msg-avatar {
    width:24px; height:24px; border-radius:50%; flex-shrink:0; margin-right:8px; margin-top:2px;
    display:flex; align-items:center; justify-content:center;
    background:var(--btn);
  }
  .chat-bubble {
    max-width:78%; padding:9px 13px; font-size:13px; line-height:1.65;
  }
  .chat-bubble.user { border-radius:16px 16px 4px 16px; background:var(--btn); color:#fff; }
  .chat-bubble.bot  { border-radius:16px 16px 16px 4px; background:#f0fdf4; color:var(--ink); border:1px solid var(--green-100); }
  .chat-dots { display:flex; gap:4px; align-items:center; }
  .chat-dot { width:6px; height:6px; border-radius:50%; background:var(--green-600); animation:dotBounce 1.2s ease infinite; }
  .chat-quick { padding:0 12px 8px; display:flex; gap:6px; flex-wrap:wrap; }
  .chat-quick-btn {
    padding:5px 12px; border-radius:18px; font-size:11px; font-weight:600; cursor:pointer;
    border:1px solid var(--green-100); background:#f0fdf4; color:var(--green-600);
    font-family:'DM Sans',sans-serif; transition:all .15s;
  }
  .chat-quick-btn:hover { background:var(--green-100); }
  .chat-input-wrap { padding:8px 12px 12px; border-top:1px solid var(--green-50); background:#fafffe; }
  .chat-input-row { display:flex; gap:8px; align-items:flex-end; }
  .chat-input {
    flex:1; resize:none; border-radius:var(--radius-sm); padding:9px 12px; font-size:13px;
    outline:none; max-height:80px; overflow-y:auto; border:1px solid var(--green-100);
    background:#f0fdf4; color:var(--ink); font-family:'DM Sans',sans-serif;
  }
  .chat-send {
    width:36px; height:36px; border-radius:50%; flex-shrink:0;
    display:flex; align-items:center; justify-content:center;
    border:none; cursor:pointer; transition:all .18s;
  }
  .chat-send.active   { background:var(--btn); }
  .chat-send.inactive { background:var(--border-soft); cursor:not-allowed; }

  /* ── Success overlay ── */
  .success-overlay {
    position:fixed; inset:0; z-index:9998;
    display:flex; align-items:center; justify-content:center;
    cursor:pointer; animation:ovIn .4s ease both;
    background:linear-gradient(135deg, rgba(2,44,34,.97), rgba(6,95,70,.96));
  }
  .success-inner { text-align:center; padding:0 32px; max-width:520px; }
  .success-check {
    margin:0 auto 28px; width:110px; height:110px; border-radius:50%;
    display:flex; align-items:center; justify-content:center;
    background:linear-gradient(135deg, #065f46, #10b981, #34d399);
    animation:popIn .7s cubic-bezier(.34,1.56,.64,1) both;
    box-shadow:0 0 0 20px rgba(16,185,129,.1), 0 20px 60px rgba(16,185,129,.4);
  }
  .success-h1 {
    font-family:'Playfair Display',serif;
    font-size:clamp(32px,6vw,44px); font-weight:800; color:#fff;
    line-height:1.1; letter-spacing:-.5px; margin-bottom:14px;
    animation:textUp .5s ease .45s both;
  }
  .success-sub { font-size:15px; line-height:1.8; color:#6ee7b7; font-weight:300; margin-bottom:16px; animation:textUp .5s ease .6s both; }
  .success-hint { font-size:12px; color:rgba(255,255,255,.4); animation:textUp .5s ease .9s both; }

  /* ── Loading ── */
  .load-screen { height:100vh; display:flex; align-items:center; justify-content:center; background:var(--bg); }
  .load-inner  { text-align:center; display:flex; flex-direction:column; align-items:center; gap:16px; }
  .load-text   { font-size:14px; font-weight:600; color:var(--green-600); }
  .load-track  { width:48px; height:3px; border-radius:2px; overflow:hidden; background:rgba(5,150,105,.12); }
  .load-bar {
    height:100%; background:linear-gradient(90deg, transparent, var(--green-500), transparent);
    background-size:200% 100%; animation:shimmer 1.5s linear infinite;
  }

  /* ── About CTA ── */
  .about-cta {
    text-align:center; border-radius:var(--radius-lg); padding:24px;
    background:var(--green-50); border:1px solid var(--green-100);
  }

  /* ── Scrollbar ── */
  ::-webkit-scrollbar { width:5px; }
  ::-webkit-scrollbar-track { background:transparent; }
  ::-webkit-scrollbar-thumb { background:var(--border); border-radius:4px; }
`;

/* ─── RATE LIMITER ────────────────────────────────────────────────────── */
const RL = {
  aiCalls: JSON.parse(sessionStorage.getItem("h4h_ai") || "[]"),
  chatCalls: JSON.parse(sessionStorage.getItem("h4h_chat") || "[]"),
  save() {
    sessionStorage.setItem("h4h_ai", JSON.stringify(this.aiCalls));
    sessionStorage.setItem("h4h_chat", JSON.stringify(this.chatCalls));
  },
  checkAI() {
    const now = Date.now();
    this.aiCalls = this.aiCalls.filter((t) => now - t < 60000);
    if (this.aiCalls.length >= 5) return false;
    this.aiCalls.push(now);
    this.save();
    return true;
  },
  checkChat() {
    const now = Date.now();
    this.chatCalls = this.chatCalls.filter((t) => now - t < 60000);
    if (this.chatCalls.length >= 15) return false;
    this.chatCalls.push(now);
    this.save();
    return true;
  },
};

/* ─── HELPERS ─────────────────────────────────────────────────────────── */
const san = (s, max = 500) =>
  typeof s !== "string"
    ? ""
    : s
        .slice(0, max)
        .replace(/[<>]/g, (c) => (c === "<" ? "＜" : "＞"))
        .replace(/javascript:/gi, "")
        .replace(/on\w+\s*=/gi, "")
        .trim();

const clamp = (v, lo = 0, hi = 60) => {
  const n = parseInt(String(v), 10);
  return isNaN(n) ? lo : Math.min(hi, Math.max(lo, n));
};

const code6 = () => String(Math.floor(100000 + Math.random() * 900000));
const MAX_FILE = 800 * 1024;

function toB64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      const result = r.result;
      res({ b64: result.split(",")[1], mime: file.type || "application/octet-stream" });
    };
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

/* ─── EMAILS ──────────────────────────────────────────────────────────── */
async function mailConfirm(email, name, pos) {
  if (!EJS_SVC || !EJS_KEY) return false;
  const tid = EJS_CONFIRM || EJS_STATUS;
  if (!tid) return false;
  try {
    await emailjs.send(EJS_SVC, tid, {
      to_email: email, to_name: name || "Applicant", full_name: name, position: pos,
      new_status: "Received",
      status_message: `Thank you for applying for the ${pos} position at Hope Coffee Melissa! We received your application and will review it carefully. You'll get an email update when your status changes. Track your status anytime using the "My Status" tab on our website. ☕`,
    }, EJS_KEY);
    return true;
  } catch (e) { console.warn("Confirm email skipped:", e.text || e); return false; }
}

async function mailVerify(email, name, code) {
  if (!EJS_SVC || !EJS_VERIFY || !EJS_KEY) return false;
  try {
    await emailjs.send(EJS_SVC, EJS_VERIFY, { to_email: email, to_name: name || "Applicant", verification_code: code }, EJS_KEY);
    return true;
  } catch (e) { console.warn("Verify email skipped:", e.text || e); return false; }
}

async function mailStatus(app, status) {
  if (!EJS_SVC || !EJS_STATUS || !EJS_KEY) return;
  const M = {
    Interview: `Great news! Your application for the ${app.position} position at Hope Coffee Melissa has been reviewed and we'd love to set up an interview. Watch your email and phone for next steps. We look forward to meeting you! ☕`,
    Hired: `Congratulations! We are thrilled to welcome you to the Hope Coffee Melissa family. You've been selected for the ${app.position} position. Watch your email for onboarding details. We can't wait to have you on the team! ☕`,
    Rejected: `Thank you for your interest in joining Hope Coffee Melissa. After careful consideration, we've decided to move forward with other candidates for the ${app.position} role. We appreciate your interest and encourage you to apply again in the future. God bless! ☕`,
  };
  if (!M[status]) return;
  try {
    await emailjs.send(EJS_SVC, EJS_STATUS, {
      to_email: app.email, to_name: app.full_name.split(" ")[0],
      full_name: app.full_name, position: app.position,
      new_status: status, status_message: M[status],
    }, EJS_KEY);
  } catch (e) { console.warn("Status email skipped:", e.text || e); }
}

/* ─── AI SCORING ──────────────────────────────────────────────────────── */
async function scoreAI(entry) {
  if (!RL.checkAI()) { console.warn("AI rate limit hit, using fallback"); return scoreFallback(entry); }
  const hasFile = !!(entry.b64 && entry.mime);
  const hasText = !!(entry.resume_text?.trim().length > 10);
  const prompt = `You are a hiring assistant for Hope Coffee Melissa, a faith-based community coffee shop in Melissa TX.
Score this applicant for the ${entry.position} role. Be honest.
APPLICANT: Position=${entry.position}, Experience=${entry.experience_years}yrs, Availability=${entry.availability || "N/A"}, Resume=${hasText ? entry.resume_text : "Not provided"}, Background=${entry.background_notes || "N/A"}, Online=${entry.digital_footprint || "N/A"}
CRITERIA (score each 0-10):
- Experience (30%): 0yrs=1,1=3,2=5,3=7,4=8,5+=10. Boost for coffee/food service.
- Availability (20%): flexible/open=10, wkday+wkend=8, mornings=7, wkdays=6, wknds=5, vague=3.
- Role Fit (15%): match to barista/shift lead keywords.
- Resume Quality (20%): none=1, file uploaded or text present scored on relevance and quality.
- Background (10%): volunteer/community/awards boost score.
- Online Presence (5%): only real verifiable URLs count.
Return ONLY valid JSON, no markdown, no extra text:
{"score":<1-10>,"breakdown":[{"label":"Experience","raw":<0-10>,"weight":30,"reason":"<one sentence>"},{"label":"Availability","raw":<0-10>,"weight":20,"reason":"<one sentence>"},{"label":"Role Fit","raw":<0-10>,"weight":15,"reason":"<one sentence>"},{"label":"Resume Quality","raw":<0-10>,"weight":20,"reason":"<one sentence>"},{"label":"Background","raw":<0-10>,"weight":10,"reason":"<one sentence>"},{"label":"Online Presence","raw":<0-10>,"weight":5,"reason":"<one sentence>"}],"summary":"<2 sentence overall assessment>"}`;

  try {
    const msgs = hasFile
      ? [{ role: "user", content: [{ type: "document", source: { type: "base64", media_type: entry.mime, data: entry.b64 } }, { type: "text", text: prompt + "\n\nApplicant uploaded a resume file above — read it thoroughly and use its contents for Resume Quality and Role Fit scoring." }] }]
      : [{ role: "user", content: prompt }];

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 700, messages: msgs }),
    });
    if (!res.ok) throw new Error("API " + res.status);
    const data = await res.json();
    const raw = data?.content?.find((b) => b.type === "text")?.text || "";
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    if (typeof parsed.score === "number" && Array.isArray(parsed.breakdown))
      return { score: Math.max(1, Math.min(10, Math.round(parsed.score))), breakdown: parsed.breakdown, ai_summary: parsed.summary || "", ai_scored: true };
    throw new Error("bad shape");
  } catch (e) { console.warn("AI scoring error, using fallback:", e.message); return scoreFallback(entry); }
}

function scoreFallback(entry) {
  const yrs = Number(entry.experience_years || 0);
  const av = (entry.availability || "").toLowerCase();
  const rs = entry.resume_text || "";
  const bg = (entry.background_notes || "").toLowerCase();
  const fp = entry.digital_footprint || "";
  const pos = (entry.position || "").toLowerCase();
  const hasFile = !!entry.b64;
  const hasText = rs.trim().length > 10;

  const exp = yrs === 0 ? 1 : yrs === 1 ? 3 : yrs === 2 ? 5 : yrs === 3 ? 7 : yrs === 4 ? 8 : 10;
  const av2 = /flexible|open|any.?time/i.test(av) ? 10 : /weekday/i.test(av) && /weekend/i.test(av) ? 8 : /morning|6.?am/i.test(av) ? 7 : /weekday/i.test(av) ? 6 : /weekend/i.test(av) ? 5 : av.trim().length > 15 ? 4 : 2;
  let role = 2;
  if (pos === "shift lead") role += 2;
  const all = (rs + " " + bg).toLowerCase();
  if (/barista|espresso|coffee/i.test(all)) role += 4;
  else if (/food service|restaurant/i.test(all)) role += 2;
  else if (/customer service/i.test(all)) role += 1;
  if (/lead|supervis|manag/i.test(all)) role += 1;
  role = Math.min(10, role);
  const res2 = hasFile ? 6 : hasText ? Math.min(10, 3 + (rs.length > 200 ? 2 : 0) + (/experience|skill|work/i.test(rs) ? 2 : 0)) : 0;
  const bgs = bg.trim().length > 10 ? Math.min(10, 3 + (/volunteer|community/i.test(bg) ? 3 : 0) + (/award|recogni/i.test(bg) ? 2 : 0) + (bg.length > 80 ? 1 : 0)) : 0;
  const fps = /linkedin\.com\//i.test(fp) ? 8 : /github\.com\/|portfolio\./i.test(fp) ? 7 : 0;
  const w = exp * 0.3 + av2 * 0.2 + role * 0.15 + res2 * 0.2 + bgs * 0.1 + fps * 0.05;
  return {
    score: Math.max(1, Math.min(10, Math.round(w))),
    breakdown: [
      { label: "Experience", raw: exp, weight: 30, reason: `${yrs} year(s) of experience.` },
      { label: "Availability", raw: av2, weight: 20, reason: "Based on stated availability." },
      { label: "Role Fit", raw: role, weight: 15, reason: "Based on resume and background keywords." },
      { label: "Resume Quality", raw: res2, weight: 20, reason: hasFile ? "Resume file uploaded." : hasText ? "Text resume provided." : "No resume provided." },
      { label: "Background", raw: bgs, weight: 10, reason: bg.trim().length > 10 ? "Background info provided." : "No background info." },
      { label: "Online Presence", raw: fps, weight: 5, reason: fps > 0 ? "Verified link provided." : "No verifiable link." },
    ],
    ai_summary: "", ai_scored: false,
  };
}

/* ─── BREW KB ─────────────────────────────────────────────────────────── */
const KB = [
  { q: /how.*(apply|submit)/i, a: "Head to the **Apply** tab! Fill out the form and hit Submit. ☕" },
  { q: /position|job|role|open/i, a: "We're hiring **Barista** and **Shift Lead** — full or part-time!" },
  { q: /pay|wage|salary/i, a: "Barista pay is **$11–$13/hr**. Email melissa@hopecoffee.com for Shift Lead details!" },
  { q: /status.*mean|what.*interview|what.*hired|what.*reject/i, a: '**New**=received. **Interview**=we want to meet you! **Hired**=offer extended. **Rejected**=not this time, apply again!' },
  { q: /how long|when.*hear/i, a: "Most hear back within 1–2 weeks. You'll get an email when your status changes!" },
  { q: /hours|shift|schedule/i, a: "Open **Mon–Sat, 6AM–6PM**. Barista is 10–36 hrs/week, flexible scheduling!" },
  { q: /address|location|where/i, a: "**2907 McKinney St, STE 100, Melissa TX 75454** ☕" },
  { q: /phone|call|contact|email/i, a: "**(469) 518-1994** or **melissa@hopecoffee.com** ☕" },
  { q: /experience|no experience/i, a: "No experience? No problem! A servant heart matters most. Apply anyway!" },
  { q: /hope coffee|about|mission/i, a: "Hope Coffee serves the community with hospitality, excellence, and intentionality. Faith-driven, community-rooted. ☕" },
  { q: /hello|hi|hey/i, a: "Hey! ☕ I'm Brew. Ask me anything about applying to Hope Coffee!" },
  { q: /thank/i, a: "Of course! That's what I'm here for. ☕" },
];
const brewAns = (t) => { for (const e of KB) { if (e.q.test(t.trim())) return e.a; } return null; };

/* ─── COLOR HELPERS ───────────────────────────────────────────────────── */
const scoreBg = (s) => s >= 8 ? "linear-gradient(135deg,#d1fae5,#ecfdf5)" : s >= 6 ? "linear-gradient(135deg,#fef3c7,#fffbeb)" : s >= 4 ? "linear-gradient(135deg,#ffedd5,#fff7ed)" : "linear-gradient(135deg,#fecdd3,#fff1f2)";
const scoreTxt = (s) => s >= 8 ? "#065f46" : s >= 6 ? "#92400e" : s >= 4 ? "#9a3412" : "#9f1239";
const scoreLabel = (s) => s >= 8 ? "Strong Match ✓" : s >= 6 ? "Good Match" : s >= 4 ? "Developing" : "Needs Review";
const scoreColor = (s) => s >= 8 ? "#059669" : s >= 6 ? "#d97706" : s >= 4 ? "#f97316" : "#ef4444";

const statusGradient = (st) => ({
  New:      { g: "linear-gradient(135deg,#1e40af,#3b82f6)", l: "linear-gradient(135deg,#dbeafe,#eff6ff)", c: "#1e3a8a", d: "#3b82f6" },
  Interview:{ g: "linear-gradient(135deg,#b45309,#d97706)", l: "linear-gradient(135deg,#fef3c7,#fffbeb)", c: "#78350f", d: "#d97706" },
  Hired:    { g: "linear-gradient(135deg,#065f46,#10b981)", l: "linear-gradient(135deg,#d1fae5,#ecfdf5)", c: "#065f46", d: "#10b981" },
  Rejected: { g: "linear-gradient(135deg,#991b1b,#ef4444)", l: "linear-gradient(135deg,#fecdd3,#fff1f2)", c: "#9f1239", d: "#ef4444" },
}[st] || { g: "linear-gradient(135deg,#475569,#94a3b8)", l: "linear-gradient(135deg,#e2e8f0,#f8fafc)", c: "#475569", d: "#94a3b8" });

/* ─── LOGO ────────────────────────────────────────────────────────────── */
const Logo = ({ s = 48 }) => (
  <svg width={s} height={s} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="hcA" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#c8e090" /><stop offset="100%" stopColor="#059669" />
      </linearGradient>
      <linearGradient id="hcB" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#7aab3a" /><stop offset="100%" stopColor="#047857" />
      </linearGradient>
      <linearGradient id="hcC" x1="100%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#86efac" /><stop offset="100%" stopColor="#16a34a" />
      </linearGradient>
    </defs>
    <ellipse cx="20" cy="40" rx="11" ry="19" fill="url(#hcB)" transform="rotate(-28 20 40)" />
    <path d="M13 26 Q20 40 17 54" stroke="#022c22" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    <ellipse cx="32" cy="34" rx="11" ry="21" fill="url(#hcA)" transform="rotate(0 32 34)" />
    <path d="M32 13 Q32 34 32 55" stroke="#022c22" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    <ellipse cx="44" cy="39" rx="11" ry="19" fill="url(#hcC)" transform="rotate(26 44 39)" />
    <path d="M51 25 Q44 39 47 53" stroke="#022c22" strokeWidth="1.6" fill="none" strokeLinecap="round" />
  </svg>
);

/* ─── CONFETTI ────────────────────────────────────────────────────────── */
const CONFETTI_COLORS = ["#059669","#10b981","#34d399","#fbbf24","#f97316","#86efac","#fb7185","#60a5fa"];
const CONFETTI_SHAPES = ["●","■","▲","◆","✦","★"];
function Confetti() {
  const particles = useMemo(() => Array.from({ length: 60 }, (_, i) => ({
    id: i, color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    shape: CONFETTI_SHAPES[i % CONFETTI_SHAPES.length],
    left: `${(i * 1.7) % 100}%`, size: `${7 + (i % 8)}px`,
    delay: `${(i * 0.025) % 1.5}s`, duration: `${2.4 + (i % 7) * 0.22}s`,
    rotation: `${(i * 43) % 360}deg`,
  })), []);

  return (
    <div style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:9999, overflow:"hidden" }}>
      {particles.map((p) => (
        <div key={p.id} style={{
          position:"absolute", top:0, left:p.left, color:p.color, fontSize:p.size,
          animation:`confetti ${p.duration} ${p.delay} ease-in both`,
          transform:`rotate(${p.rotation})`,
        }}>{p.shape}</div>
      ))}
    </div>
  );
}

/* ─── SUCCESS OVERLAY ─────────────────────────────────────────────────── */
function SuccessOverlay({ name, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 5500); return () => clearTimeout(t); }, [onDone]);
  const first = name ? name.split(" ")[0] : "";
  return (
    <>
      <Confetti />
      <div className="success-overlay" onClick={onDone}>
        <div className="success-inner">
          <div className="success-check" style={{ animation:"popIn .7s cubic-bezier(.34,1.56,.64,1) both, pulseRing 2.5s ease-out .9s" }}>
            <svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              style={{ strokeDasharray:50, animation:"checkDraw .55s ease .75s both" }}>
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h1 className="success-h1">{first ? `You're in, ${first}!` : "Submitted!"}</h1>
          <p className="success-sub">We received your application and a confirmation email is on its way. Track your status anytime in "My Status". ☕</p>
          <p className="success-hint">Tap anywhere to close</p>
        </div>
      </div>
    </>
  );
}

/* ─── CHATBOT ─────────────────────────────────────────────────────────── */
function Chatbot({ ctx = "apply" }) {
  const init = ctx === "status"
    ? "Hi! ☕ I'm Brew. I can explain your status or anything about the process."
    : "Hey! ☕ I'm Brew. Ask me anything about applying to Hope Coffee!";

  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([{ role: "assistant", text: init }]);
  const [inp, setInp] = useState("");
  const [busy, setBusy] = useState(false);
  const [wig, setWig] = useState(false);
  const endR = useRef(null);

  useEffect(() => { endR.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);
  useEffect(() => {
    if (!open) {
      const t = setInterval(() => { setWig(true); setTimeout(() => setWig(false), 700); }, 5500);
      return () => clearInterval(t);
    }
  }, [open]);

  async function send() {
    const t = san(inp, 800).trim();
    if (!t || busy) return;
    setInp("");
    const hist = [...msgs, { role: "user", text: t }];
    setMsgs(hist);
    setBusy(true);
    const kb = brewAns(t);
    if (kb) { setTimeout(() => { setMsgs((p) => [...p, { role: "assistant", text: kb }]); setBusy(false); }, 380); return; }
    if (!RL.checkChat()) {
      setMsgs((p) => [...p, { role: "assistant", text: "You're sending messages really fast! Take a breath and try again in a moment. ☕" }]);
      setBusy(false); return;
    }
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 320,
          system: "You are Brew, a warm assistant for Hire4Hope — Hope Coffee Melissa TX (2907 McKinney St, (469)518-1994, melissa@hopecoffee.com, Mon-Sat 6AM-6PM). Barista $11-13/hr, 10-36hrs/wk, must be 18+. Be brief (2-3 sentences max), warm, faith-aligned.",
          messages: hist.map((m) => ({ role: m.role, content: m.text })),
        }),
      });
      if (!res.ok) throw new Error("API");
      const d = await res.json();
      const reply = d?.content?.find((b) => b.type === "text")?.text;
      if (!reply) throw new Error("empty");
      setMsgs((p) => [...p, { role: "assistant", text: san(reply, 1200) }]);
    } catch { setMsgs((p) => [...p, { role: "assistant", text: "Not sure about that, but I can help with applying or checking your status! ☕" }]); }
    setBusy(false);
  }

  const quickQuestions = ctx === "status"
    ? ["What does my status mean?", "When will I hear back?"]
    : ["How do I apply?", "What positions are open?", "What's the pay?"];

  const renderText = (text) => text.split(/(\*\*[^*]+\*\*)/).map((p, j) =>
    p.startsWith("**") && p.endsWith("**") ? <strong key={j}>{p.slice(2,-2)}</strong> : <React.Fragment key={j}>{p}</React.Fragment>
  );

  return (
    <>
      <div style={{ position:"fixed", bottom:24, right:24, zIndex:1000 }}>
        <button type="button" onClick={() => setOpen((o) => !o)} className="chat-fab"
          style={{ animation: wig && !open ? "wiggle .5s ease" : "none" }}>
          {open
            ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            : <Logo s={26} />}
        </button>
        {!open && <div className="chat-badge">AI</div>}
      </div>

      {open && (
        <div className="chat-window">
          <div className="chat-header">
            <div className="chat-header-avatar anim-float"><Logo s={20} /></div>
            <div>
              <div className="chat-name">Brew</div>
              <div className="chat-status"><span className="chat-status-dot" />AI · Hope Coffee</div>
            </div>
          </div>

          <div className="chat-msgs">
            {msgs.map((m, i) => (
              <div key={i} className={`chat-msg ${m.role === "user" ? "user" : "bot"}`}>
                {m.role === "assistant" && (
                  <div className="chat-msg-avatar"><Logo s={12} /></div>
                )}
                <div className={`chat-bubble ${m.role === "user" ? "user" : "bot"}`}>
                  {renderText(m.text)}
                </div>
              </div>
            ))}
            {busy && (
              <div className="chat-msg bot">
                <div className="chat-msg-avatar"><Logo s={12} /></div>
                <div className="chat-bubble bot" style={{ padding:"12px 14px" }}>
                  <div className="chat-dots">
                    {[0,1,2].map((d) => <span key={d} className="chat-dot" style={{ animationDelay:`${d*0.22}s` }} />)}
                  </div>
                </div>
              </div>
            )}
            <div ref={endR} />
          </div>

          {msgs.length <= 1 && (
            <div className="chat-quick">
              {quickQuestions.map((q) => (
                <button key={q} type="button" onClick={() => setInp(q)} className="chat-quick-btn">{q}</button>
              ))}
            </div>
          )}

          <div className="chat-input-wrap">
            <div className="chat-input-row">
              <textarea
                value={inp} onChange={(e) => setInp(e.target.value.slice(0, 800))}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Ask Brew anything…" rows={1} className="chat-input"
              />
              <button type="button" onClick={send} disabled={!inp.trim() || busy}
                className={`chat-send ${inp.trim() && !busy ? "active" : "inactive"}`}>
                {busy
                  ? <div className="anim-spin" style={{ width:13, height:13, borderRadius:"50%", border:"2px solid rgba(255,255,255,.3)", borderTopColor:"#059669" }} />
                  : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={inp.trim() ? "#fff" : "#9ca3af"} strokeWidth="2.5" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ─── APPLY PAGE ──────────────────────────────────────────────────────── */
function ApplyPage({ onSubmit }) {
  const [f, setF] = useState({ fn:"", em:"", ph:"", pos:"", yr:"", av:"", bg:"", fp:"", rt:"" });
  const up = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const [rTab, setRTab] = useState("text");
  const [rFile, setRFile] = useState(null);
  const [rName, setRName] = useState("");
  const [fErr, setFErr] = useState("");
  const [foc, setFoc] = useState(null);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bMsg, setBMsg] = useState("Submitting…");
  const [win, setWin] = useState(false);
  const [winN, setWinN] = useState("");
  const [errs, setErrs] = useState({});
  const [last, setLast] = useState(0);
  const [drag, setDrag] = useState(false);
  const fRef = useRef(null);

  useEffect(() => { setTimeout(() => setMounted(true), 80); }, []);

  function pickFile(file) {
    if (!file) return;
    if (!/\.(pdf|doc|docx|txt)$/i.test(file.name)) { setFErr("Please upload PDF, Word, or .txt"); return; }
    if (file.size > MAX_FILE) { setFErr(`File too large (${(file.size/1024).toFixed(0)}KB). Max 800KB — compress or paste as text instead.`); return; }
    setFErr(""); setRFile(file); setRName(san(file.name, 100));
  }

  async function submit() {
    if (busy) return;
    const now = Date.now();
    if (last && now - last < 20000) { alert("Please wait a moment before resubmitting."); return; }
    const e = {};
    if (!f.fn.trim()) e.fn = "Required";
    if (!f.em.trim() || !/\S+@\S+\.\S+/.test(f.em)) e.em = "Valid email required";
    if (!f.ph.trim()) e.ph = "Required";
    if (!f.pos) e.pos = "Required";
    if (!f.av.trim()) e.av = "Required";
    if (Object.keys(e).length) { setErrs(e); return; }
    setErrs({}); setBusy(true); setLast(now);
    const pos = ["Barista","Shift Lead"].includes(f.pos) ? f.pos : "Barista";
    let b64 = "", mime = "", fname = "";
    if (rTab === "upload" && rFile) {
      setBMsg("Processing resume…");
      try { const r = await toB64(rFile); b64 = r.b64; mime = r.mime; fname = rName; } catch (x) { console.error("File read:", x); }
    }
    const entry = {
      created_at: new Date().toISOString(), full_name: san(f.fn,100),
      email: san(f.em,200).toLowerCase(), phone: san(f.ph,30), position: pos,
      experience_years: clamp(f.yr,0,60), availability: san(f.av,300),
      digital_footprint: san(f.fp,300), background_notes: san(f.bg,500),
      resume_text: rTab === "text" ? san(f.rt,2000) : "",
      b64, mime, resume_file_name: fname, status: "New", deleted_by_manager: false,
    };
    setBMsg("AI is analyzing your application…");
    const { score, breakdown, ai_summary, ai_scored } = await scoreAI(entry);
    entry.risk_score = score; entry.score_breakdown = breakdown;
    entry.ai_summary = ai_summary || ""; entry.ai_scored = ai_scored;
    entry.resume_base64 = b64; entry.resume_media_type = mime;
    delete entry.b64; delete entry.mime;
    setBMsg("Saving to database…");
    await onSubmit(entry);
    setBMsg("Sending confirmation email…");
    await mailConfirm(entry.email, entry.full_name, entry.position);
    setBusy(false); setWinN(entry.full_name); setWin(true);
    setF({ fn:"", em:"", ph:"", pos:"", yr:"", av:"", bg:"", fp:"", rt:"" });
    setRFile(null); setRName(""); setRTab("text"); setFErr("");
  }

  const ic = (n) => ({
    width:"100%", background:"#fff", borderRadius:"var(--radius-sm)", padding:"12px 16px",
    color:"var(--ink)", fontSize:14, outline:"none", fontFamily:"'DM Sans',sans-serif",
    transition:"all 0.2s",
    border: `1.5px solid ${errs[n] ? "var(--red-500)" : foc === n ? "var(--green-600)" : "var(--border)"}`,
    boxShadow: foc === n ? "0 0 0 3px rgba(5,150,105,.08)" : "none",
  });

  return (
    <>
      {win && <SuccessOverlay name={winN} onDone={() => setWin(false)} />}
      <div style={{ background:"var(--bg)", minHeight:"100%" }}>
        {/* Hero */}
        <div className="hero">
          <div className="hero-inner">
            <div className={`hero-tag ${mounted ? "anim-fade-up" : ""}`}>
              <div className="hero-tag-icon"><Logo s={50} /></div>
              <div>
                <div className="hero-eyebrow">Now Hiring at</div>
                <div className="hero-shop">Hope Coffee Melissa</div>
              </div>
            </div>
            <h1 className={`hero-h1 ${mounted ? "anim-fade-up" : ""}`} style={{ animationDelay:"70ms" }}>Join Our Team ☕</h1>
            <p className={`hero-sub ${mounted ? "anim-fade-up" : ""}`} style={{ animationDelay:"130ms" }}>
              Melissa's gathering place — craft coffee, good people, second chances. Every application is read by a real human.
            </p>
            <div className={`hero-pills ${mounted ? "anim-fade-up" : ""}`} style={{ animationDelay:"190ms" }}>
              {["Welcoming team","$11–13/hr","Flexible hours","Community-driven"].map((t) => (
                <span key={t} className="hero-pill">✓ {t}</span>
              ))}
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="card-wrap">
          <div className={`card card-pull ${mounted ? "anim-scale-in" : ""}`}>
            <div className="card-body">
              <div className="privacy-box">
                🔒 <strong>Your privacy matters.</strong> Job-related info only. You'll receive a confirmation email and notifications when your status changes.
              </div>

              <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
                {/* Contact */}
                <div className="divider">
                  <div className="divider-line divider-left" />
                  <span className="divider-label">Contact Info</span>
                  <div className="divider-line divider-right" />
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                  <div>
                    <label className="field-label">Full Name *</label>
                    <input type="text" value={f.fn} onChange={(e) => up("fn", e.target.value.slice(0,100))}
                      placeholder="Jane Smith" style={ic("fn")}
                      onFocus={() => setFoc("fn")} onBlur={() => setFoc(null)} autoComplete="name" />
                    {errs.fn && <span className="field-err">{errs.fn}</span>}
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                    <div>
                      <label className="field-label">Email *</label>
                      <input type="email" value={f.em} onChange={(e) => up("em", e.target.value.slice(0,200))}
                        placeholder="jane@email.com" style={ic("em")}
                        onFocus={() => setFoc("em")} onBlur={() => setFoc(null)} autoComplete="email" />
                      {errs.em && <span className="field-err">{errs.em}</span>}
                    </div>
                    <div>
                      <label className="field-label">Phone *</label>
                      <input type="tel" value={f.ph} onChange={(e) => up("ph", e.target.value.slice(0,30))}
                        placeholder="(214) 555-0000" style={ic("ph")}
                        onFocus={() => setFoc("ph")} onBlur={() => setFoc(null)} autoComplete="tel" />
                      {errs.ph && <span className="field-err">{errs.ph}</span>}
                    </div>
                  </div>
                </div>

                {/* Role */}
                <div className="divider">
                  <div className="divider-line divider-left" />
                  <span className="divider-label">Role & Experience</span>
                  <div className="divider-line divider-right" />
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                  <div>
                    <label className="field-label">Position *</label>
                    <div className="pos-grid">
                      {[
                        { v:"Barista", icon:"☕", pay:"$11–$13/hr", hrs:"10–36 hrs/wk", desc:"Craft drinks, serve guests with warmth, and be the face of Hope Coffee. No experience needed — we train you!" },
                        { v:"Shift Lead", icon:"⭐", pay:"Competitive", hrs:"Full or Part Time", desc:"Run shifts, guide the team, and uphold our values on the floor. Ideal for someone with service experience." },
                      ].map((opt) => (
                        <div key={opt.v} className={`pos-card ${f.pos === opt.v ? "selected" : ""}`} onClick={() => up("pos", opt.v)}>
                          {f.pos === opt.v && (
                            <div className="pos-card-check">
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                            </div>
                          )}
                          <div className="pos-card-top">
                            <span className="pos-card-icon">{opt.icon}</span>
                            <span className="pos-card-title">{opt.v}</span>
                          </div>
                          <div className="pos-card-badges">
                            <span className="badge badge-green">{opt.pay}</span>
                            <span className="badge badge-gray">{opt.hrs}</span>
                          </div>
                          <p className="pos-card-desc">{opt.desc}</p>
                        </div>
                      ))}
                    </div>
                    {errs.pos && <span className="field-err">{errs.pos}</span>}
                  </div>
                  <div>
                    <label className="field-label">Years of Experience</label>
                    <input type="number" min="0" max="60" value={f.yr}
                      onChange={(e) => up("yr", e.target.value)} placeholder="0" style={ic("yr")}
                      onFocus={() => setFoc("yr")} onBlur={() => setFoc(null)} />
                  </div>
                  <div>
                    <label className="field-label">Availability *</label>
                    <textarea value={f.av} onChange={(e) => up("av", e.target.value.slice(0,300))} rows={2}
                      placeholder="e.g. Flexible, weekdays open, weekends after noon"
                      style={{ ...ic("av"), resize:"vertical", minHeight:70 }}
                      onFocus={() => setFoc("av")} onBlur={() => setFoc(null)} />
                    {errs.av && <span className="field-err">{errs.av}</span>}
                  </div>
                </div>

                {/* About You */}
                <div className="divider">
                  <div className="divider-line divider-left" />
                  <span className="divider-label">About You</span>
                  <div className="divider-line divider-right" />
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                  <div>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                      <label className="field-label" style={{ marginBottom:0 }}>Resume</label>
                      <div className="tab-pill-wrap">
                        {["text","upload"].map((tab) => (
                          <button key={tab} type="button" onClick={() => setRTab(tab)} className={`tab-pill ${rTab === tab ? "active" : ""}`}>
                            {tab === "text" ? "✏️ Write" : "📎 Upload"}
                          </button>
                        ))}
                      </div>
                    </div>
                    {rTab === "text" ? (
                      <textarea value={f.rt} onChange={(e) => up("rt", e.target.value.slice(0,2000))} rows={4}
                        placeholder="Your most relevant experience — barista, customer service, food service, leadership roles…"
                        style={{ ...ic("rt"), resize:"vertical", minHeight:100 }}
                        onFocus={() => setFoc("rt")} onBlur={() => setFoc(null)} />
                    ) : (
                      <div
                        className={`dropzone ${drag ? "drag" : ""} ${rName ? "has-file" : ""}`}
                        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                        onDragLeave={() => setDrag(false)}
                        onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) pickFile(e.dataTransfer.files[0]); }}
                        onClick={() => fRef.current?.click()}
                      >
                        <input ref={fRef} type="file" accept=".pdf,.doc,.docx,.txt" style={{ display:"none" }}
                          onChange={(e) => { if (e.target.files?.[0]) pickFile(e.target.files[0]); }} />
                        {rName ? (
                          <>
                            <div className="dropzone-icon filled">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                            </div>
                            <p style={{ fontSize:13, fontWeight:600, color:"var(--green-600)" }}>{rName}</p>
                            <p style={{ fontSize:11, color:"var(--ink-faint)" }}>Click to replace · AI will read this file</p>
                          </>
                        ) : (
                          <>
                            <div className="dropzone-icon empty">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                              </svg>
                            </div>
                            <p style={{ fontSize:13, fontWeight:500, color:"var(--ink)" }}>Drag & drop or click to upload</p>
                            <p style={{ fontSize:11, color:"var(--ink-faint)" }}>PDF, Word, or .txt · max 800KB</p>
                          </>
                        )}
                        {fErr && <p style={{ fontSize:12, color:"var(--red-500)" }}>{fErr}</p>}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="field-label">Anything we should know <span className="field-opt">(optional)</span></label>
                    <textarea value={f.bg} onChange={(e) => up("bg", e.target.value.slice(0,500))} rows={2}
                      placeholder="Volunteer work, community involvement, anything you'd like to share…"
                      style={{ ...ic("bg"), resize:"vertical", minHeight:70 }}
                      onFocus={() => setFoc("bg")} onBlur={() => setFoc(null)} />
                  </div>
                  <div>
                    <label className="field-label">Online Presence <span className="field-opt">(optional)</span></label>
                    <input type="text" value={f.fp} onChange={(e) => up("fp", e.target.value.slice(0,300))}
                      placeholder="LinkedIn URL or portfolio link" style={ic("fp")}
                      onFocus={() => setFoc("fp")} onBlur={() => setFoc(null)} />
                    <span className="field-hint">Tip: a real link improves your fit score.</span>
                  </div>
                </div>

                <button type="button" onClick={submit} disabled={busy} className="btn-primary full">
                  {busy
                    ? <><div className="anim-spin" style={{ width:16, height:16, borderRadius:"50%", border:"2px solid rgba(255,255,255,.3)", borderTopColor:"#fff" }} />{bMsg}</>
                    : "Submit My Application →"
                  }
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <Chatbot ctx="apply" />
    </>
  );
}

/* ─── STATUS PAGE ─────────────────────────────────────────────────────── */
const STATUS_INFO = {
  New:      { icon:"📬", label:"Application Received", desc:"We've got your application and it's in our review queue. Brian personally reviews every application.", color:"#3b82f6", bg:"rgba(59,130,246,.06)", bd:"rgba(59,130,246,.15)" },
  Interview:{ icon:"📅", label:"Interview Stage!", desc:"Your application stood out! We sent you interview details — check your email!", color:"#d97706", bg:"rgba(245,158,11,.06)", bd:"rgba(245,158,11,.15)" },
  Hired:    { icon:"🎉", label:"Offer Extended!", desc:"Congratulations! Welcome to the Hope Coffee family. Check your email for onboarding details.", color:"#059669", bg:"rgba(5,150,105,.06)", bd:"rgba(5,150,105,.15)" },
  Rejected: { icon:"💌", label:"Application Closed", desc:"Thank you for your interest. We went with other candidates this time. Please apply again in the future!", color:"#ef4444", bg:"rgba(239,68,68,.06)", bd:"rgba(239,68,68,.15)" },
};

function StatusPage({ applicants }) {
  const [emailIn, setEmailIn] = useState("");
  const [stage, setStage] = useState("email");
  const [found, setFound] = useState(null);
  const [code, setCode] = useState("");
  const [codeIn, setCodeIn] = useState("");
  const [codeErr, setCodeErr] = useState("");
  const [sending, setSending] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setTimeout(() => setMounted(true), 80); }, []);

  async function lookup() {
    const q = emailIn.trim().toLowerCase();
    if (!q) return;
    const match = applicants.find((a) => a.email.toLowerCase() === q);
    if (!match) { setStage("notfound"); return; }
    setSending(true);
    const c = code6(); setCode(c);
    const sent = await mailVerify(q, match.full_name, c);
    setSending(false); setFound(match);
    sent ? setStage("verify") : setStage("found");
  }

  function verify() {
    codeIn.trim() === code ? (setStage("found"), setCodeErr("")) : setCodeErr("Incorrect code. Try again.");
  }

  function reset() {
    setStage("email"); setEmailIn(""); setFound(null); setCode(""); setCodeIn(""); setCodeErr("");
  }

  const steps = ["New","Interview","Hired"];
  const idx = found ? steps.indexOf(found.status) : -1;
  const first = found ? found.full_name.split(" ")[0] : "";

  return (
    <div style={{ minHeight:"100%", background:"var(--bg)" }}>
      <div className="hero" style={{ padding:"44px 24px 56px" }}>
        <div className="hero-inner">
          <div className={`hero-tag ${mounted ? "anim-fade-up" : ""}`}>
            <div className="hero-tag-icon anim-float"><Logo s={38} /></div>
            <div>
              <div className="hero-eyebrow">My Application</div>
              <div className="hero-shop">Hope Coffee Melissa</div>
            </div>
          </div>
          <h1 className="hero-h1" style={{ color:"#fff" }}>
            {stage === "found" ? `Welcome back, ${first}! ☕` : "Check Your Status"}
          </h1>
          <p className="hero-sub">
            {stage === "found" ? "Here's everything about your application." : stage === "verify" ? "We sent a 6-digit code to your email." : "Enter the email you used when applying."}
          </p>
        </div>
      </div>

      <div className="card-wrap">
        {stage === "email" && (
          <div className={`card card-pull-sm ${mounted ? "anim-scale-in" : ""}`}>
            <div className="card-body">
              <div className="sec-head">🔍 Look up your application</div>
              <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                <input type="email" value={emailIn} onChange={(e) => setEmailIn(e.target.value.slice(0,200))}
                  onKeyDown={(e) => { if (e.key === "Enter") lookup(); }}
                  placeholder="your@email.com"
                  style={{ flex:1, minWidth:200, borderRadius:"var(--radius-sm)", padding:"12px 16px", fontSize:14, border:"1.5px solid var(--border)", background:"var(--surface)", color:"var(--ink)", outline:"none", fontFamily:"'DM Sans',sans-serif" }} />
                <button type="button" onClick={lookup} disabled={sending} className="btn-primary">
                  {sending ? <><div className="anim-spin" style={{ width:12, height:12, borderRadius:"50%", border:"2px solid rgba(255,255,255,.3)", borderTopColor:"#fff" }} />Sending…</> : "Look Up →"}
                </button>
              </div>
            </div>
          </div>
        )}

        {stage === "verify" && (
          <div className="card card-pull-sm">
            <div className="card-body" style={{ textAlign:"center" }}>
              <div style={{ fontSize:40, marginBottom:12 }}>📧</div>
              <h3 style={{ fontFamily:"'Playfair Display',serif", fontSize:20, fontWeight:700, color:"var(--ink)", marginBottom:8 }}>Check your email</h3>
              <p style={{ fontSize:13, color:"var(--ink-muted)", marginBottom:20 }}>We sent a 6-digit code to <strong>{emailIn}</strong></p>
              <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:12 }}>
                <input type="text" value={codeIn} onChange={(e) => setCodeIn(e.target.value.replace(/\D/g,"").slice(0,6))}
                  onKeyDown={(e) => { if (e.key === "Enter") verify(); }}
                  placeholder="000000" maxLength={6}
                  style={{ flex:1, minWidth:160, borderRadius:"var(--radius-sm)", padding:"12px 16px", fontSize:22, fontWeight:800, textAlign:"center", letterSpacing:"0.3em", border:`1.5px solid ${codeErr ? "var(--red-500)" : "var(--border)"}`, background:"var(--surface)", color:"var(--ink)", outline:"none", fontFamily:"'DM Sans',sans-serif" }} />
                <button type="button" onClick={verify} className="btn-primary">Verify →</button>
              </div>
              {codeErr && <p style={{ fontSize:12, color:"var(--red-500)", marginBottom:10 }}>{codeErr}</p>}
              <button type="button" onClick={reset} className="btn-ghost">Use a different email</button>
            </div>
          </div>
        )}

        {stage === "notfound" && (
          <div className="card card-pull-sm" style={{ textAlign:"center" }}>
            <div className="card-body">
              <div style={{ fontSize:40, marginBottom:12 }}>🤔</div>
              <p style={{ fontSize:15, fontWeight:700, color:"var(--red-500)", marginBottom:8 }}>No application found</p>
              <p style={{ fontSize:13, color:"var(--ink-muted)", marginBottom:16, lineHeight:1.6 }}>We couldn't find an application with that email. Double-check it or head to Apply to submit one.</p>
              <button type="button" onClick={reset} className="btn-outline">Try again</button>
            </div>
          </div>
        )}

        {stage === "found" && found && (() => {
          const info = STATUS_INFO[found.status] || STATUS_INFO.New;
          return (
            <div className="anim-fade-up" style={{ display:"flex", flexDirection:"column", gap:12, marginTop:-24 }}>
              {/* Status card */}
              <div className="status-card" style={{ background:info.bg, border:`1px solid ${info.bd}` }}>
                <div style={{ display:"flex", alignItems:"flex-start", gap:16 }}>
                  <div style={{ fontSize:42, lineHeight:1, flexShrink:0 }}>{info.icon}</div>
                  <div>
                    <div style={{ fontSize:11, fontWeight:700, color:info.color, textTransform:"uppercase", letterSpacing:".04em", marginBottom:4 }}>Current Status</div>
                    <h2 style={{ fontFamily:"'Playfair Display',serif", fontSize:20, fontWeight:700, color:"var(--ink)", marginBottom:6 }}>{info.label}</h2>
                    <p style={{ fontSize:13, color:"var(--ink-muted)", lineHeight:1.6 }}>{info.desc}</p>
                  </div>
                </div>
              </div>

              {/* Progress */}
              {found.status !== "Rejected" && (
                <div className="card">
                  <div className="card-body" style={{ padding:"20px 24px" }}>
                    <div className="sec-head">Application Progress</div>
                    <div className="progress-bar">
                      {steps.map((step, i) => {
                        const act = idx >= i; const cur = idx === i;
                        const sg = statusGradient(step);
                        return (
                          <React.Fragment key={step}>
                            <div className="progress-step">
                              <div className="progress-dot" style={{
                                background: act ? sg.g : "#f3f4f6",
                                border: `2px solid ${cur ? sg.d : "#e5e7eb"}`,
                                animation: cur ? "pulse2 2s ease infinite" : "none",
                              }}>
                                {act
                                  ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                                  : <div style={{ width:8, height:8, borderRadius:"50%", background:"#d1d5db" }} />}
                              </div>
                              <div className="progress-label" style={{ fontWeight:cur ? 800 : 500, color:act ? sg.d : "#d1d5db" }}>{step}</div>
                            </div>
                            {i < steps.length - 1 && (
                              <div className="progress-connector" style={{ background: idx > i ? "linear-gradient(90deg,#059669,#10b981)" : "#f3f4f6" }} />
                            )}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Details */}
              <div className="card">
                <div className="card-body" style={{ padding:"20px 24px" }}>
                  <div className="sec-head">👤 Your Details</div>
                  <div className="info-grid">
                    {[
                      { l:"Name", v:found.full_name }, { l:"Email", v:found.email },
                      { l:"Phone", v:found.phone }, { l:"Position", v:found.position },
                      { l:"Applied", v:new Date(found.created_at).toLocaleDateString("en-US",{ month:"short", day:"numeric", year:"numeric" }) },
                      { l:"Experience", v:`${found.experience_years} yr${found.experience_years !== 1 ? "s" : ""}` },
                    ].map((x) => (
                      <div key={x.l} className="info-cell">
                        <div className="info-label">{x.l}</div>
                        <div className="info-value">{x.v || "—"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <button type="button" onClick={reset} className="btn-outline" style={{ width:"100%", justifyContent:"center" }}>
                ← Search a different email
              </button>
            </div>
          );
        })()}
      </div>
      <Chatbot ctx="status" />
    </div>
  );
}

/* ─── ABOUT PAGE ──────────────────────────────────────────────────────── */
function AboutPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setTimeout(() => setMounted(true), 80); }, []);

  const vals = [
    { i:"⚖️", t:"Act Justly — Work with Purpose", d:"We pour intentionality into everything we do, seeking to honor God and people through excellent work." },
    { i:"💚", t:"Love Mercy — Welcome with Generosity", d:"We extend the heart of Christ through genuine hospitality — creating spaces of warmth and belonging." },
    { i:"🙏", t:"Walk Humbly — Lead with Grace", d:"We walk alongside others with humility and gratitude, trusting God to use our efforts to build community." },
  ];

  const info = [
    { i:"💰", l:"Pay", v:"$11–13/hr Barista · Competitive for Shift Lead" },
    { i:"📅", l:"Hours", v:"10–36 hrs/week · Mon–Sat 6 AM–6 PM" },
    { i:"📍", l:"Location", v:"2907 McKinney St, STE 100, Melissa TX" },
    { i:"📞", l:"Contact", v:"(469) 518-1994 · melissa@hopecoffee.com" },
    { i:"🎂", l:"Requirement", v:"Must be 18 or older" },
    { i:"☕", l:"Culture", v:"Faith-driven, community-rooted, servant-hearted" },
  ];

  return (
    <div style={{ minHeight:"100%", background:"var(--bg)" }}>
      <div className="hero" style={{ padding:"52px 24px 68px" }}>
        <div className="hero-inner">
          <div className={`hero-tag ${mounted ? "anim-fade-up" : ""}`}>
            <div className="hero-tag-icon"><Logo s={50} /></div>
            <div>
              <div className="hero-eyebrow">About</div>
              <div className="hero-shop">Hope Coffee Melissa</div>
            </div>
          </div>
          <h1 className={`hero-h1 ${mounted ? "anim-fade-up" : ""}`} style={{ animationDelay:"60ms" }}>Drink Coffee. Change Lives. ☕</h1>
          <p className={`hero-sub ${mounted ? "anim-fade-up" : ""}`} style={{ animationDelay:"120ms" }}>
            Our mission is to bring value and purpose through every cup — serving with hospitality, excellence, and intentionality.
          </p>
        </div>
      </div>

      <div className="card-wrap" style={{ maxWidth:640 }}>
        <div className={`card card-pull ${mounted ? "anim-scale-in" : ""}`}>
          <div className="card-body">
            {/* Quick Info */}
            <div className="sec-head">📋 Quick Info</div>
            <div className="info-grid" style={{ marginBottom:28 }}>
              {info.map((x) => (
                <div key={x.l} className="info-cell">
                  <div style={{ fontSize:20, marginBottom:6 }}>{x.i}</div>
                  <div className="info-label">{x.l}</div>
                  <div className="info-value" style={{ fontSize:12, fontWeight:500, lineHeight:1.45 }}>{x.v}</div>
                </div>
              ))}
            </div>

            {/* Mission */}
            <div className="mission-box">
              <div className="mission-title">Our Mission</div>
              <p className="mission-text">
                The culture of Hope Coffee is one of serving. We exist to serve great coffee, our community, our customers, coffee farmers, the church, one another, those in need, and ultimately, Jesus Christ.
              </p>
            </div>

            {/* Values */}
            <div className="sec-head">🌿 Team Values</div>
            <div style={{ marginBottom:28 }}>
              {vals.map((v) => (
                <div key={v.t} className="value-card">
                  <div className="value-top">
                    <span className="value-icon">{v.i}</span>
                    <div className="value-title">{v.t}</div>
                  </div>
                  <p className="value-desc">{v.d}</p>
                </div>
              ))}
            </div>

            {/* Open Roles */}
            <div className="sec-head">🎯 Open Roles</div>
            <div className="pos-grid" style={{ marginBottom:28 }}>
              {[
                { r:"Barista", p:"$11–13/hr", h:"10–36 hrs/wk", d:"Craft drinks, connect with guests, share the Hope Coffee story." },
                { r:"Shift Lead", p:"Competitive", h:"Full or Part Time", d:"Run shifts, support the team, uphold our values and standards." },
              ].map((x) => (
                <div key={x.r} style={{ borderRadius:"var(--radius-md)", padding:16, background:"var(--btn)" }}>
                  <div style={{ fontFamily:"'Playfair Display',serif", fontSize:16, fontWeight:700, color:"#ecfdf5", marginBottom:4 }}>{x.r}</div>
                  <div style={{ fontSize:12, color:"rgba(255,255,255,.7)", marginBottom:8 }}>{x.p} · {x.h}</div>
                  <p style={{ fontSize:12, color:"rgba(255,255,255,.6)", lineHeight:1.5 }}>{x.d}</p>
                </div>
              ))}
            </div>

            {/* CTA */}
            <div className="about-cta">
              <div style={{ fontSize:32, marginBottom:10 }}>🙌</div>
              <h3 style={{ fontFamily:"'Playfair Display',serif", fontSize:18, fontWeight:700, color:"var(--ink)", marginBottom:8 }}>Ready to join the family?</h3>
              <p style={{ fontSize:13, color:"var(--ink-muted)", marginBottom:10 }}>If you're passionate about making a difference with every cup — we'd love to hear from you.</p>
              <div style={{ fontSize:12, color:"var(--ink-faint)" }}>(469) 518-1994 · melissa@hopecoffee.com</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── MANAGER AUTH ────────────────────────────────────────────────────── */
function ManagerAuth({ onAuth }) {
  const [email, setEmail] = useState(""); const [pass, setPass] = useState("");
  const [show, setShow] = useState(false); const [err, setErr] = useState("");
  const [tries, setTries] = useState(0); const [locked, setLocked] = useState(false);
  const [timer, setTimer] = useState(0);

  useEffect(() => {
    if (locked && timer > 0) {
      const t = setInterval(() => setTimer((s) => { if (s <= 1) { setLocked(false); setTries(0); return 0; } return s - 1; }), 1000);
      return () => clearInterval(t);
    }
  }, [locked, timer]);

  function tryLogin() {
    if (locked) return;
    const cleanEmail = email.trim().toLowerCase(); const cleanPass = pass.trim();
    if (ADMIN_SET.has(cleanEmail) && cleanPass === MGR_PASS) {
      onAuth(cleanEmail);
    } else {
      const n = tries + 1; setTries(n); setEmail(""); setPass("");
      if (!ADMIN_SET.has(cleanEmail)) setErr("That email is not authorized.");
      else setErr("Incorrect password. Please try again.");
      if (n >= 4) { setLocked(true); setTimer(30); setErr("Too many failed attempts. Locked for 30 seconds."); }
    }
  }

  const disabled = locked || !email.trim() || !pass.trim();

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo-wrap anim-float"><Logo s={38} /></div>
        <h2 className="auth-title">Manager Access</h2>
        <p className="auth-sub">Enter your authorized email and password to access the hiring dashboard.</p>
        <div className="auth-input-wrap">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value.slice(0,200))}
            onKeyDown={(e) => { if (e.key === "Enter") tryLogin(); }}
            placeholder="manager@hopecoffee.com" disabled={locked}
            className={`auth-input ${err && !locked ? "err" : ""}`} />
          <div className="pass-wrap">
            <input type={show ? "text" : "password"} value={pass}
              onChange={(e) => setPass(e.target.value.slice(0,100))}
              onKeyDown={(e) => { if (e.key === "Enter") tryLogin(); }}
              placeholder="Password" disabled={locked}
              className={`auth-input ${err && !locked ? "err" : ""}`}
              style={{ paddingRight:48 }} />
            <button type="button" onClick={() => setShow(!show)} className="show-toggle">{show ? "Hide" : "Show"}</button>
          </div>
        </div>
        {err && <p className="auth-err">{err}</p>}
        {locked && <p className="auth-warn">🔒 Try again in {timer}s</p>}
        <button type="button" onClick={tryLogin} disabled={disabled} className="btn-primary full"
          style={{ opacity:disabled ? .6 : 1, boxShadow:disabled ? "none" : undefined }}>
          {locked ? `Locked (${timer}s)` : "Sign In →"}
        </button>
      </div>
    </div>
  );
}

/* ─── MANAGER DASHBOARD ───────────────────────────────────────────────── */
function ManagerDashboard({ applicants, onStatusChange, onDelete, mgrEmail }) {
  const [sel, setSel] = useState(null); const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All"); const [statusMsg, setStatusMsg] = useState("");
  const [confirmDel, setConfirmDel] = useState(false); const [modal, setModal] = useState(false);

  const vis = useMemo(() => applicants.filter((a) => !a.deleted_by_manager), [applicants]);
  const cnts = useMemo(() => { const c = {}; vis.forEach((a) => { c[a.status] = (c[a.status] || 0) + 1; }); return c; }, [vis]);
  const filtered = useMemo(() => {
    let list = filter === "All" ? vis : vis.filter((a) => a.status === filter);
    if (search.trim()) { const q = search.toLowerCase(); list = list.filter((a) => a.full_name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q)); }
    return list;
  }, [vis, filter, search]);

  const entry = useMemo(() => vis.find((a) => a.id === sel) || null, [vis, sel]);
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  async function changeStatus(id, ns) {
    const app = vis.find((a) => a.id === id);
    setStatusMsg("Updating…");
    await onStatusChange(id, ns);
    if (app && ["Interview","Hired","Rejected"].includes(ns)) { setStatusMsg("Sending email…"); await mailStatus(app, ns); }
    setStatusMsg(`✓ Moved to ${ns}`);
    setTimeout(() => setStatusMsg(""), 3000);
  }

  function downloadResume(e) {
    if (!e.resume_base64) return;
    const ext = (e.resume_file_name || "resume.pdf").split(".").pop() || "pdf";
    const mimes = { pdf:"application/pdf", doc:"application/msword", docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document", txt:"text/plain" };
    const mime = mimes[ext] || e.resume_media_type || "application/octet-stream";
    const bytes = atob(e.resume_base64); const ab = new ArrayBuffer(bytes.length); const ia = new Uint8Array(ab);
    for (let i = 0; i < bytes.length; i++) ia[i] = bytes.charCodeAt(i);
    const blob = new Blob([ab], { type:mime }); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = e.resume_file_name || `resume_${e.full_name.replace(/\s/g,"_")}.${ext}`;
    a.click(); URL.revokeObjectURL(url);
  }

  const stats = [
    { l:"Total",     v:vis.length,         g:"linear-gradient(155deg,#059669,#065f46)" },
    { l:"New",       v:cnts.New || 0,      g:"linear-gradient(155deg,#1e40af,#1e3a8a)" },
    { l:"Interview", v:cnts.Interview || 0,g:"linear-gradient(155deg,#b45309,#78350f)" },
    { l:"Hired",     v:cnts.Hired || 0,    g:"linear-gradient(155deg,#047857,#022c22)" },
  ];

  return (
    <div className="dash-layout">
      {/* PDF Modal */}
      {modal && entry?.resume_base64 && (
        <div onClick={() => setModal(false)} style={{ position:"fixed", inset:0, zIndex:9000, display:"flex", alignItems:"center", justifyContent:"center", padding:24, background:"rgba(0,0,0,.6)", animation:"ovIn .3s ease both" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background:"var(--surface)", borderRadius:"var(--radius-xl)", overflow:"hidden", display:"flex", flexDirection:"column", width:"min(800px,100%)", maxHeight:"90vh", border:"1px solid var(--border)", animation:"scaleIn .3s ease both" }}>
            <div style={{ padding:"16px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", borderBottom:"1px solid var(--border)" }}>
              <div>
                <div style={{ fontSize:14, fontWeight:700, color:"var(--ink)" }}>Resume — {entry.full_name}</div>
                <div style={{ fontSize:11, color:"var(--ink-faint)", marginTop:2 }}>{entry.resume_file_name}</div>
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <button type="button" onClick={() => downloadResume(entry)} className="btn-primary" style={{ padding:"7px 14px", fontSize:12 }}>⬇ Download</button>
                <button type="button" onClick={() => setModal(false)} className="btn-outline" style={{ padding:"7px 14px", fontSize:12 }}>✕ Close</button>
              </div>
            </div>
            <div style={{ flex:1, overflow:"auto", padding:20 }}>
              {entry.resume_media_type === "application/pdf"
                ? <iframe src={`data:application/pdf;base64,${entry.resume_base64}`} style={{ width:"100%", height:"70vh", border:0, borderRadius:"var(--radius-sm)" }} title="Resume" />
                : <div style={{ textAlign:"center", padding:24 }}>
                    <p style={{ fontSize:13, color:"var(--ink-muted)", marginBottom:16 }}>This file type can't be previewed inline. Download to view.</p>
                    <button type="button" onClick={() => downloadResume(entry)} className="btn-primary">⬇ Download Resume</button>
                  </div>}
            </div>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <div className="dash-sidebar">
        <div className="dash-sidebar-header">
          <div className="dash-sidebar-brand">
            <div style={{ borderRadius:12, padding:"8px 10px", background:"rgba(255,255,255,.1)", border:"1px solid rgba(255,255,255,.15)" }}><Logo s={26} /></div>
            <div>
              <div style={{ fontSize:14, fontWeight:700, color:"#ecfdf5", fontFamily:"'Playfair Display',serif" }}>Hire4Hope</div>
              <div style={{ fontSize:11, color:"#6ee7b7" }}>Manager Dashboard</div>
            </div>
          </div>
          <div className="dash-sidebar-greeting">
            <div style={{ fontSize:13, fontWeight:600, color:"rgba(255,255,255,.85)" }}>{greet}! ☕</div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,.5)", marginTop:2 }}>{vis.length} applicant{vis.length !== 1 ? "s" : ""}{cnts.New ? ` · ${cnts.New} new` : ""}</div>
          </div>
        </div>

        <div className="dash-stats-grid">
          {stats.map((c, i) => (
            <div key={c.l} className="stat-card" style={{ background:c.g, animationDelay:`${i*55}ms` }}>
              <div className="stat-number">{c.v}</div>
              <div className="stat-label">{c.l}</div>
            </div>
          ))}
        </div>

        <div className="dash-search">
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or email…" />
        </div>

        <div className="dash-filters">
          {["All","New","Interview","Hired","Rejected"].map((s) => (
            <button key={s} type="button" onClick={() => setFilter(s)} className={`filter-chip ${filter === s ? "active" : ""}`}>
              {s}{s !== "All" && cnts[s] ? ` (${cnts[s]})` : ""}
            </button>
          ))}
        </div>

        <div className="dash-list">
          {filtered.length === 0 ? (
            <p style={{ fontSize:12, color:"var(--ink-faint)", padding:"20px 8px", textAlign:"center" }}>
              {vis.length === 0 ? "No applications yet." : "No matches found."}
            </p>
          ) : filtered.map((a, i) => {
            const sg = statusGradient(a.status);
            return (
              <button key={a.id} type="button" onClick={() => setSel(a.id)}
                className={`app-row ${sel === a.id ? "active" : ""}`}
                style={{ animation:`slideL .28s ease ${i*28}ms both` }}>
                <div className="app-row-top">
                  <span className="app-row-name">{a.full_name}</span>
                  <span className="badge" style={{ background:sg.l, color:sg.c, fontSize:9 }}>{a.status}</span>
                </div>
                <div className="app-row-bottom">
                  <span className="app-row-pos">{a.position}</span>
                  {a.risk_score && (
                    <span className="badge" style={{ background:scoreBg(a.risk_score), color:scoreTxt(a.risk_score), fontSize:10 }}>★ {a.risk_score}/10</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Detail Panel */}
      <div className="dash-detail">
        {!entry ? (
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100%", gap:12 }}>
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1" strokeLinecap="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
            <p style={{ fontSize:13, color:"var(--ink-faint)" }}>{vis.length === 0 ? "No applications yet." : "Select an applicant to review their details."}</p>
          </div>
        ) : (
          <div key={entry.id} className="detail-card">
            {/* Header */}
            <div className="detail-header">
              <div style={{ display:"flex", gap:14, alignItems:"flex-start", flex:1 }}>
                <div className="detail-avatar">{entry.full_name.charAt(0)}</div>
                <div>
                  <div className="detail-name">{entry.full_name}</div>
                  <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", margin:"6px 0" }}>
                    {(() => { const sg = statusGradient(entry.status); return <span className="badge" style={{ background:sg.g, color:"#fff", padding:"4px 10px" }}>{entry.status}</span>; })()}
                    <span className="badge badge-green">{entry.position}</span>
                    {entry.ai_scored && <span className="badge badge-blue">🤖 AI Scored</span>}
                  </div>
                  <div className="detail-meta">{entry.email} · {entry.phone}</div>
                  <div style={{ fontSize:11, color:"#d1d5db", marginTop:3 }}>Applied {new Date(entry.created_at).toLocaleDateString("en-US",{ month:"long", day:"numeric", year:"numeric" })}</div>
                </div>
              </div>
              {entry.risk_score && (
                <div style={{ textAlign:"center", flexShrink:0 }}>
                  <div className="score-ring">
                    <svg width="76" height="76" viewBox="0 0 76 76" style={{ transform:"rotate(-90deg)" }}>
                      <circle cx="38" cy="38" r="30" fill="none" stroke="#f3f4f6" strokeWidth="8" />
                      <circle cx="38" cy="38" r="30" fill="none" stroke={scoreColor(entry.risk_score)} strokeWidth="8"
                        strokeDasharray={`${(entry.risk_score/10)*188.5} 188.5`} strokeLinecap="round" />
                    </svg>
                    <div className="score-ring-label">
                      <span className="score-num" style={{ color:scoreTxt(entry.risk_score) }}>{entry.risk_score}</span>
                      <span className="score-denom">/10</span>
                    </div>
                  </div>
                  <p className="score-tag">{scoreLabel(entry.risk_score)}</p>
                </div>
              )}
            </div>

            {/* AI Summary */}
            {entry.ai_summary && (
              <div className="ai-box">
                <div className="ai-box-title">🤖 AI Assessment</div>
                <p className="ai-box-text">{entry.ai_summary}</p>
              </div>
            )}

            {/* Score breakdown */}
            {entry.score_breakdown?.length > 0 && (
              <div className="breakdown-box">
                <div className="sec-head">📊 Score Breakdown</div>
                <div className="info-grid">
                  {entry.score_breakdown.map((b) => (
                    <div key={b.label} className="breakdown-item">
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                        <span style={{ fontSize:12, fontWeight:600, color:"var(--ink)" }}>{b.label}</span>
                        <span style={{ fontSize:12, fontWeight:700, color:"var(--green-600)" }}>{b.raw}/10 <span style={{ color:"var(--ink-faint)", fontWeight:400 }}>({b.weight}%)</span></span>
                      </div>
                      <div className="breakdown-bar-track">
                        <div className="breakdown-bar-fill" style={{
                          width:`${b.raw*10}%`,
                          background: b.raw >= 7 ? "linear-gradient(90deg,#059669,#10b981)" : b.raw >= 5 ? "linear-gradient(90deg,#d97706,#fbbf24)" : "linear-gradient(90deg,#dc2626,#f87171)"
                        }} />
                      </div>
                      {b.reason && <p style={{ fontSize:11, color:"var(--ink-faint)", marginTop:2 }}>{b.reason}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Resume */}
            {entry.resume_base64 ? (
              <div className="resume-box">
                <div className="sec-head">📎 Resume File Uploaded</div>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, flexWrap:"wrap" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <div style={{ width:36, height:36, borderRadius:"50%", background:"var(--btn)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    </div>
                    <div>
                      <p style={{ fontSize:13, fontWeight:600, color:"var(--ink)" }}>{entry.resume_file_name || "Resume"}</p>
                      <p style={{ fontSize:11, color:"var(--ink-faint)" }}>AI read this file for scoring</p>
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:8 }}>
                    {entry.resume_media_type === "application/pdf" && (
                      <button type="button" onClick={() => setModal(true)} className="btn-outline" style={{ fontSize:12, padding:"6px 12px" }}>👁 View</button>
                    )}
                    <button type="button" onClick={() => downloadResume(entry)} className="btn-primary" style={{ fontSize:12, padding:"6px 12px" }}>⬇ Download</button>
                  </div>
                </div>
              </div>
            ) : entry.resume_text ? (
              <div className="resume-box">
                <div className="sec-head">📋 Resume Summary</div>
                <p style={{ fontSize:13, color:"var(--ink)", lineHeight:1.6 }}>{entry.resume_text}</p>
              </div>
            ) : null}

            {/* Details */}
            <div className="info-grid" style={{ marginBottom:12 }}>
              {[
                { l:"Experience", v:`${entry.experience_years} yr${entry.experience_years !== 1 ? "s" : ""}` },
                { l:"Availability", v:entry.availability },
              ].map((x) => (
                <div key={x.l} className="info-cell">
                  <div className="info-label">{x.l}</div>
                  <div className="info-value">{x.v || "—"}</div>
                </div>
              ))}
            </div>

            {[{ l:"Background Notes", v:entry.background_notes, e:"📝" }, { l:"Online Presence", v:entry.digital_footprint, e:"🔗" }].filter((x) => x.v).map((x) => (
              <div key={x.l} className="info-cell" style={{ marginBottom:10 }}>
                <div className="sec-head" style={{ marginBottom:6 }}>{x.e} {x.l}</div>
                <p style={{ fontSize:13, color:"var(--ink)", lineHeight:1.6 }}>{x.v}</p>
              </div>
            ))}

            {/* Status update */}
            <div style={{ background:"var(--surface)", border:"1px solid var(--green-100)", borderRadius:"var(--radius-md)", padding:16, marginTop:4 }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
                <div className="sec-head" style={{ marginBottom:0 }}>Update Status</div>
                {statusMsg && <div style={{ fontSize:11, fontWeight:600, color:"var(--ink-faint)" }}>{statusMsg}</div>}
              </div>
              <div style={{ borderRadius:"var(--radius-sm)", padding:"10px 13px", marginBottom:12, background:"var(--blue-50)", border:"1px solid var(--blue-100)" }}>
                <p style={{ fontSize:12, color:"var(--blue-700)" }}>📧 <strong>Auto-email:</strong> Moving to Interview, Hired, or Rejected automatically emails the applicant.</p>
              </div>
              <div className="status-btns">
                {[
                  { l:"Interview", s:"Interview", bg:"linear-gradient(155deg,#b45309,#78350f)", sh:"rgba(180,83,9,.25)" },
                  { l:"Hired",     s:"Hired",     bg:"linear-gradient(155deg,#047857,#022c22)", sh:"rgba(5,150,105,.25)" },
                  { l:"Reject",   s:"Rejected",  bg:"linear-gradient(155deg,#b91c1c,#7f1d1d)", sh:"rgba(185,28,28,.25)" },
                  { l:"Reset",    s:"New",        bg:"linear-gradient(155deg,#1e40af,#1e3a8a)", sh:"rgba(30,64,175,.25)" },
                ].map((b) => {
                  const act = entry.status === b.s;
                  return (
                    <button key={b.s} type="button" onClick={() => changeStatus(entry.id, b.s)} disabled={act}
                      className="status-btn"
                      style={{
                        background: act ? "#f3f4f6" : b.bg,
                        color: act ? "#d1d5db" : "#fff",
                        boxShadow: act ? "none" : `0 4px 14px ${b.sh}`,
                        cursor: act ? "default" : "pointer",
                      }}>
                      {act ? "✓ " : ""}{b.l}
                    </button>
                  );
                })}
              </div>
              <div className="delete-zone">
                {!confirmDel ? (
                  <button type="button" onClick={() => setConfirmDel(true)}
                    style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"7px 13px", borderRadius:"var(--radius-sm)", fontSize:12, fontWeight:600, cursor:"pointer", border:"1px solid var(--red-100)", background:"#fff1f2", color:"var(--red-500)", fontFamily:"'DM Sans',sans-serif" }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                    Delete from View
                  </button>
                ) : (
                  <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
                    <p style={{ fontSize:12, color:"var(--red-500)", fontWeight:600 }}>Remove from your dashboard?</p>
                    <div style={{ display:"flex", gap:8 }}>
                      <button type="button" onClick={() => { onDelete(entry.id); setSel(null); setConfirmDel(false); }}
                        style={{ padding:"7px 14px", borderRadius:"var(--radius-sm)", fontSize:12, fontWeight:700, border:"none", cursor:"pointer", background:"linear-gradient(155deg,#b91c1c,#7f1d1d)", color:"#fff", fontFamily:"'DM Sans',sans-serif" }}>
                        Yes, Delete
                      </button>
                      <button type="button" onClick={() => setConfirmDel(false)} className="btn-ghost">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── NAV ITEMS ───────────────────────────────────────────────────────── */
const navItems = [
  { id:"apply",  l:"Apply",    ic:<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-2"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg> },
  { id:"status", l:"My Status",ic:<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> },
  { id:"about",  l:"About",    ic:<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> },
];

/* ─── APP ROOT ────────────────────────────────────────────────────────── */
export default function App() {
  const [page, setPage] = useState("apply");
  const [applicants, setApplicants] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [mgrEmail, setMgrEmail] = useState(null);

  useEffect(() => {
    if (EJS_KEY) emailjs.init(EJS_KEY);
    const q = query(collection(db, "applicants"), orderBy("created_at", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setApplicants(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoaded(true);
    }, (err) => { console.error("Firestore:", err); setLoaded(true); });
    return () => unsub();
  }, []);

  const addApp    = useCallback(async (e) => { await addDoc(collection(db, "applicants"), e); }, []);
  const changeSt  = useCallback(async (id, ns) => { await updateDoc(doc(db, "applicants", id), { status: ns }); }, []);
  const delApp    = useCallback(async (id) => { await updateDoc(doc(db, "applicants", id), { deleted_by_manager: true }); }, []);

  if (!loaded) {
    return (
      <>
        <style>{STYLES}</style>
        <div className="load-screen">
          <div className="load-inner">
            <Logo s={50} />
            <p className="load-text">Loading Hire4Hope…</p>
            <div className="load-track"><div className="load-bar" /></div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{STYLES}</style>
      <div className="app-shell">
        {/* Navbar */}
        <nav className="navbar">
          <button type="button" onClick={() => setPage("apply")} className="nav-brand">
            <Logo s={26} />
            <div>
              <div className="nav-brand-name">Hire4Hope</div>
              <div className="nav-brand-sub">by Hope Coffee Melissa</div>
            </div>
          </button>
          <div className="nav-divider" />
          {navItems.map((p) => (
            <button key={p.id} type="button" onClick={() => setPage(p.id)}
              className={`nav-btn ${page === p.id ? "active" : ""}`}>
              {p.ic}
              <span>{p.l}</span>
            </button>
          ))}
          <button type="button" onClick={() => setPage("manager")}
            className={`nav-mgr-btn ${page === "manager" ? "active" : ""}`}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            {page === "manager" && mgrEmail && <span style={{ fontSize:11 }}>Dashboard</span>}
          </button>
        </nav>

        {/* Content */}
        <div className={page === "manager" ? "page-hidden" : "page-scroll"}>
          {page === "apply"   && <ApplyPage onSubmit={addApp} />}
          {page === "status"  && <StatusPage applicants={applicants.filter((a) => !a.deleted_by_manager)} />}
          {page === "about"   && <AboutPage />}
          {page === "manager" && (mgrEmail
            ? <ManagerDashboard applicants={applicants} onStatusChange={changeSt} onDelete={delApp} mgrEmail={mgrEmail} />
            : <ManagerAuth onAuth={(e) => setMgrEmail(e)} />
          )}
        </div>
      </div>
    </>
  );
}
