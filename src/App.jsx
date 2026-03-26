// CRITICAL: React must be explicitly imported for JSX to work in this environment.
import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { db } from "./firebase";
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  query,
  orderBy,
} from "firebase/firestore";

/* ══ Admin whitelist ═══════════════════════════════════════════════════════ */
// These emails are checked client-side for the manager gate.
// For extra security, also set VITE_ADMIN_EMAILS in your .env file (comma-separated).
const ADMIN_EMAILS = new Set(
  (import.meta.env.VITE_ADMIN_EMAILS || "melissa@hopecoffee.com")
    .split(",")
    .map((e) => e.trim().toLowerCase())
);

/* ══ Security ══════════════════════════════════════════════════════════════ */
const sanitize = (s, max = 500) =>
  typeof s !== "string" ? "" :
  s.slice(0, max)
    .replace(/[<>]/g, c => c === "<" ? "＜" : "＞")
    .replace(/javascript:/gi, "")
    .replace(/on\w+\s*=/gi, "")
    .trim();
const clampNum = (v, lo = 0, hi = 60) => { const n = parseInt(v, 10); return isNaN(n) ? lo : Math.min(hi, Math.max(lo, n)); };

/* ══ Brew Knowledge Base ═══════════════════════════════════════════════════ */
const BREW_KB = [
  { q: /how.*(apply|submit|application)/i, a: "Head to the **Apply** tab at the top! Fill out the form with your contact info, the position you want, your availability, and a quick resume summary. Hit Submit and you're done. ☕" },
  { q: /position|job|role|open/i, a: "We're hiring for two roles: **Barista** and **Shift Lead**. Baristas make the magic happen at the counter. Shift Leads take on extra responsibility running shifts. Both are great fits for coffee lovers!" },
  { q: /fit score|score|rating|grade/i, a: "Your fit score is a **1–10 estimate** calculated by an AI rubric — it weighs Experience (30%), Availability (20%), Role Fit (15%), Resume Content (20%), Background (10%), and Online Presence (5%). It's a guide, not a final decision. Brian reviews every application personally." },
  { q: /status.*mean|what.*new|what.*interview|what.*hired|what.*reject/i, a: "**New** = we received it and it's in queue. **Interview** = you stood out and we'd love to meet! **Hired** = offer extended, check your email. **Rejected** = not selected this time, but please apply again in the future." },
  { q: /how long|when.*hear|timeline|response/i, a: "We review applications on a rolling basis. Most applicants hear back within a week or two. If your status updates in the My Status tab, you'll know we've reviewed yours!" },
  { q: /pay|wage|salary|money|hourly/i, a: "Pay is competitive and based on experience and the role. For specifics, feel free to reach out directly to melissa@hopecoffee.com!" },
  { q: /hours|shift|schedule|part.time|full.time/i, a: "We offer flexible scheduling and both part-time and full-time options. Hope Coffee Melissa is open Monday–Saturday, 6 AM–6 PM." },
  { q: /address|location|where|find/i, a: "We're at **2907 McKinney Street, STE 100, Melissa, TX 75454**. Feel free to stop by — we'd love to see you!" },
  { q: /phone|call|contact|email/i, a: "You can reach us at (469) 518-1994 or melissa@hopecoffee.com. We're always happy to chat!" },
  { q: /experience|years|no experience|beginner/i, a: "Don't worry if you're new to coffee! We value community spirit and a willingness to learn. Your attitude matters as much as your resume. Apply anyway!" },
  { q: /delete|remove|withdraw/i, a: "To update or withdraw your application, email us at melissa@hopecoffee.com with your name and the email you applied with." },
  { q: /hope coffee|about|mission/i, a: "Hope Coffee is a community-focused coffee shop rooted in faith and service. We believe in second chances and the power of a warm cup of coffee. Our Melissa location is at 2907 McKinney Street!" },
  { q: /hello|hi|hey|howdy/i, a: "Hey! ☕ Great to hear from you. I'm Brew, the Hire4Hope assistant. What can I help you with today?" },
  { q: /thank|thanks/i, a: "Of course! That's what I'm here for. ☕ Anything else you'd like to know?" },
];

function brewAnswer(text) {
  const t = text.trim();
  for (const entry of BREW_KB) {
    if (entry.q.test(t)) return entry.a;
  }
  return null;
}

/* ══ Scoring ═══════════════════════════════════════════════════════════════ */
function analyzeResume(text) {
  if (!text || text.trim().length < 5) return 0;
  const t = text.toLowerCase();
  let pts = 1;
  const signals = [
    [/barista|espresso|latte|cappuccino|pour.over|cold.brew|drip/i, 4],
    [/coffee|cafe|café/i, 2],
    [/shift.lead|shift.supervisor|team.lead|supervisor|manager/i, 3],
    [/customer service|customer.facing|front.of.house/i, 2],
    [/food service|restaurant|hospitality|catering/i, 2],
    [/train|onboard|mentor|coach/i, 2],
    [/pos|register|cash.handling|point.of.sale/i, 2],
    [/servsafe|food.handler|food.safe|certif/i, 2],
    [/volunteer|nonprofit|community/i, 1],
    [/award|recogni|promot|excell/i, 1],
  ];
  signals.forEach(([rx, add]) => { if (rx.test(t)) pts += add; });
  if (text.trim().length < 30) pts = Math.max(1, pts - 2);
  return Math.min(10, pts);
}

function calcScore(entry) {
  const yrs = Number(entry.experience_years || 0);
  const pos = (entry.position || "").toLowerCase();
  const av  = (entry.availability || "").toLowerCase();
  const rs  = entry.resume_summary || "";
  const bg  = (entry.background_notes || "").toLowerCase();
  const fp  = entry.digital_footprint || "";

  const expScore = yrs === 0 ? 1 : yrs === 1 ? 3 : yrs === 2 ? 5 : yrs === 3 ? 7 : yrs === 4 ? 8 : 10;
  const avScore =
    /flexible|open availability|any.?time|all.?day/i.test(av) ? 10 :
    /weekday/i.test(av) && /weekend/i.test(av) ? 8 :
    /morning|6.?am|7.?am|8.?am|open/i.test(av) ? 7 :
    /weekday/i.test(av) ? 6 :
    /weekend/i.test(av) ? 5 :
    av.trim().length > 15 ? 4 : 2;

  let roleScore = 2;
  if (pos === "shift lead") roleScore += 2;
  const allText = (rs + " " + bg).toLowerCase();
  if (/barista|espresso|coffee/i.test(allText)) roleScore += 4;
  else if (/food service|restaurant|hospitality/i.test(allText)) roleScore += 2;
  else if (/customer service/i.test(allText)) roleScore += 1;
  if (/lead|supervis|manag/i.test(allText)) roleScore += 1;
  roleScore = Math.min(10, roleScore);

  const resumeScore = analyzeResume(rs);

  let bgScore = 0;
  if (bg.trim().length > 10) {
    bgScore = 3;
    if (/volunteer|community|charity|nonprofit/i.test(bg)) bgScore += 3;
    if (/award|recogni|promot/i.test(bg)) bgScore += 2;
    if (bg.trim().length > 80) bgScore += 1;
    bgScore = Math.min(10, bgScore);
  }

  let fpScore = 0;
  if (fp.trim().length > 3) {
    fpScore = /linkedin\.com/i.test(fp) ? 9 : /linkedin/i.test(fp) ? 7 : /github|portfolio|website/i.test(fp) ? 7 : 4;
  }

  const weighted = expScore*0.30 + avScore*0.20 + roleScore*0.15 + resumeScore*0.20 + bgScore*0.10 + fpScore*0.05;
  const final = Math.max(1, Math.min(10, Math.round(weighted)));

  return {
    score: final,
    breakdown: [
      { label: "Experience",      raw: expScore,    weight: 30 },
      { label: "Availability",    raw: avScore,     weight: 20 },
      { label: "Role Fit",        raw: roleScore,   weight: 15 },
      { label: "Resume Quality",  raw: resumeScore, weight: 20 },
      { label: "Background",      raw: bgScore,     weight: 10 },
      { label: "Online Presence", raw: fpScore,     weight: 5  },
    ],
  };
}

/* ══ Color helpers ══════════════════════════════════════════════════════════ */
const sBg    = s => s>=8?"linear-gradient(135deg,#bbf7d0,#dcfce7)":s>=6?"linear-gradient(135deg,#fde68a,#fef3c7)":s>=4?"linear-gradient(135deg,#fed7aa,#ffedd5)":"linear-gradient(135deg,#fecdd3,#fee2e2)";
const sTxt   = s => s>=8?"#14532d":s>=6?"#78350f":s>=4?"#7c2d12":"#7f1d1d";
const sLabel = s => s>=8?"Strong Match ✓":s>=6?"Good Match":s>=4?"Developing":"Needs Growth";
const stG    = st => ({
  New:       {g:"linear-gradient(135deg,#1d4ed8,#3b82f6)",l:"linear-gradient(135deg,#dbeafe,#eff6ff)",c:"#1e3a8a",d:"#3b82f6"},
  Interview: {g:"linear-gradient(135deg,#b45309,#d97706)",l:"linear-gradient(135deg,#fde68a,#fef9c3)",c:"#713f12",d:"#ca8a04"},
  Hired:     {g:"linear-gradient(135deg,#14532d,#16a34a)",l:"linear-gradient(135deg,#bbf7d0,#dcfce7)",c:"#14532d",d:"#16a34a"},
  Rejected:  {g:"linear-gradient(135deg,#991b1b,#ef4444)",l:"linear-gradient(135deg,#fecdd3,#fee2e2)",c:"#7f1d1d",d:"#ef4444"},
}[st]||{g:"linear-gradient(135deg,#475569,#94a3b8)",l:"linear-gradient(135deg,#e2e8f0,#f1f5f9)",c:"#475569",d:"#94a3b8"});

/* ══ CSS ════════════════════════════════════════════════════════════════════ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=Outfit:wght@300;400;500;600;700;800&family=Caveat:wght@600;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body,input,textarea,select,button{font-family:'Outfit',sans-serif}

@keyframes fadeUp  {from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes scaleIn {from{opacity:0;transform:scale(.91)}to{opacity:1;transform:scale(1)}}
@keyframes floatY  {0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
@keyframes spin    {to{transform:rotate(360deg)}}
@keyframes pring   {0%{box-shadow:0 0 0 0 rgba(74,124,89,.55)}70%{box-shadow:0 0 0 22px rgba(74,124,89,0)}100%{box-shadow:0 0 0 0 rgba(74,124,89,0)}}
@keyframes popIn   {0%{transform:scale(.4);opacity:0}60%{transform:scale(1.1)}100%{transform:scale(1);opacity:1}}
@keyframes slideL  {from{opacity:0;transform:translateX(-12px)}to{opacity:1;transform:translateX(0)}}
@keyframes chatPop {from{opacity:0;transform:scale(.84) translateY(14px)}to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes msgIn   {from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
@keyframes dot     {0%,80%,100%{transform:scale(.4);opacity:.35}40%{transform:scale(1);opacity:1}}
@keyframes chkDraw {from{stroke-dashoffset:50}to{stroke-dashoffset:0}}
@keyframes wiggle  {0%,100%{transform:rotate(0)}25%{transform:rotate(-9deg)}75%{transform:rotate(9deg)}}
@keyframes ovIn    {from{opacity:0}to{opacity:1}}
@keyframes txtUp   {from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
@keyframes gshift  {0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
@keyframes steam   {0%{transform:translateY(0) scaleX(1);opacity:.8}50%{transform:translateY(-22px) scaleX(1.4);opacity:.4}100%{transform:translateY(-42px) scaleX(.7);opacity:0}}
@keyframes bf1     {0%,100%{transform:translate(0,0) rotate(0)}33%{transform:translate(9px,-18px) rotate(30deg)}66%{transform:translate(-6px,-10px) rotate(-20deg)}}
@keyframes bf2     {0%,100%{transform:translate(0,0) rotate(0)}40%{transform:translate(-12px,-22px) rotate(-34deg)}80%{transform:translate(8px,-12px) rotate(24deg)}}
@keyframes bf3     {0%,100%{transform:translate(0,0) rotate(0)}25%{transform:translate(14px,-14px) rotate(44deg)}75%{transform:translate(-10px,-24px) rotate(-30deg)}}
@keyframes leafSway{0%,100%{transform:rotate(-10deg)}50%{transform:rotate(10deg)}}
@keyframes sparkle {0%,100%{opacity:0;transform:scale(0)}50%{opacity:1;transform:scale(1)}}
@keyframes pulse2  {0%,100%{opacity:.4;transform:scale(1)}50%{opacity:.7;transform:scale(1.06)}}
@keyframes statusPulse{0%,100%{opacity:1}50%{opacity:.55}}
@keyframes cfetti  {0%{transform:translateY(-10px) rotate(0);opacity:1}100%{transform:translateY(115vh) rotate(720deg);opacity:0}}
@keyframes cfettiW {0%{transform:translateY(-10px) rotate(0) scaleX(1);opacity:1}30%{transform:translateY(30vh) rotate(180deg) scaleX(.8)}60%{transform:translateY(65vh) rotate(360deg) scaleX(1.1)}100%{transform:translateY(115vh) rotate(720deg) scaleX(.9);opacity:0}}
@keyframes bgScroll{from{background-position:0 0}to{background-position:80px 80px}}
@keyframes tiltF   {0%,100%{transform:rotate(-4deg) translateY(0)}50%{transform:rotate(4deg) translateY(-12px)}}
@keyframes dropF   {0%{transform:translateY(-5px);opacity:0}15%{opacity:.8}100%{transform:translateY(70px);opacity:0}}

.apple-btn {
  position:relative; overflow:hidden; cursor:pointer; border:none; outline:none;
  transition:transform .16s cubic-bezier(.34,1.56,.64,1), box-shadow .16s, filter .16s;
}
.apple-btn::before {
  content:''; position:absolute; top:0; left:0; right:0; height:52%;
  background:linear-gradient(180deg,rgba(255,255,255,.32) 0%,rgba(255,255,255,.08) 100%);
  border-radius:inherit; pointer-events:none; z-index:1;
}
.apple-btn::after {
  content:''; position:absolute; inset:0;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.15),transparent);
  left:-80%; width:60%; transition:left .45s ease; pointer-events:none; z-index:2;
}
.apple-btn:hover::after{left:120%}
.apple-btn:hover:not(:disabled){transform:translateY(-2px) scale(1.025);filter:brightness(1.08)}
.apple-btn:active:not(:disabled){transform:scale(.96);filter:brightness(.97)}

.bh{transition:transform .17s cubic-bezier(.34,1.56,.64,1),box-shadow .17s,filter .17s!important;cursor:pointer}
.bh:hover:not(:disabled){transform:translateY(-2px) scale(1.02);filter:brightness(1.07)}
.bh:active:not(:disabled){transform:scale(.97)}
.ch{transition:transform .2s cubic-bezier(.34,1.56,.64,1),box-shadow .2s!important}
.ch:hover{transform:translateY(-3px)}
.rh{transition:transform .14s,background .14s!important}.rh:hover{transform:translateX(3px)}
.fu{animation:fadeUp .42s cubic-bezier(.25,.46,.45,.94) both}
.si{animation:scaleIn .36s cubic-bezier(.34,1.56,.64,1) both}
.fl{animation:floatY 3.8s ease-in-out infinite}
.gb{background:linear-gradient(270deg,#0c1f12,#173325,#275040,#2e5c3a,#1d4028);background-size:500% 500%;animation:gshift 10s ease infinite}
.gt{background:linear-gradient(135deg,#1a4030,#3d7050,#5aaf7a);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}

@media(max-width:768px){
  .dash-layout{flex-direction:column!important}
  .dash-sidebar{width:100%!important;max-height:340px;border-right:none!important;border-bottom:1.5px solid #d0e8d8}
  .dash-detail{padding:18px 16px!important}
  .form-grid-2{grid-template-columns:1fr!important}
  .hero-h1{font-size:32px!important}
  .hero-sub{font-size:20px!important}
  .now-hiring{font-size:13px!important}
  .form-card{padding:22px 18px!important;margin-top:-20px!important}
  .status-grid{grid-template-columns:1fr!important}
  .score-flex{flex-direction:column!important;align-items:flex-start!important}
  .nav-label{display:none}
  .nav-bar{padding:0 12px!important;gap:2px!important}
  .stat-cards{grid-template-columns:1fr 1fr!important}
}
@media(max-width:480px){
  .hero-h1{font-size:26px!important}
  .dash-detail{padding:12px 10px!important}
}
`;

/* ══ Coffee wallpaper SVG ═══════════════════════════════════════════════════ */
const wallpaperSVG = encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><g fill='none' stroke='rgba(74,124,89,0.1)' stroke-width='1.3' stroke-linecap='round'><path d='M16 42 L20 62 H36 L40 42 Z'/><path d='M16 42 H40'/><path d='M40 50 Q49 50 49 56 Q49 62 40 62' stroke-width='1.5'/><path d='M24 37 Q22 32 24 27'/><path d='M32 37 Q30 32 32 27'/><ellipse cx='62' cy='22' rx='8' ry='12' transform='rotate(-18 62 22)'/><path d='M56 14 Q62 22 58 30' /></g></svg>`);
const wallpaper = `url("data:image/svg+xml,${wallpaperSVG}")`;

/* ══ Coffee Motion BG ═══════════════════════════════════════════════════════ */
function CoffeeBG({ density = 1 }) {
  const items = useMemo(() => {
    const anims = ["bf1","bf2","bf3"];
    const beans = Array.from({length: Math.round(10*density)}, (_,i) => ({
      type:"bean", top:`${5+(i*9.1)%90}%`, left:`${3+(i*11.3)%93}%`,
      size:12+(i%5)*4, anim:`${anims[i%3]} ${7+i%5}s ease-in-out infinite`,
      delay:`${(i*.65)%4}s`, op:0.22+(i%4)*.04,
    }));
    const cups = Array.from({length: Math.round(5*density)}, (_,i) => ({
      type:"cup", top:`${8+(i*19)}%`, left:`${4+(i*21)}%`,
      size:36+(i%3)*14, delay:`${i*.85}s`, op:0.18+(i%3)*.03,
      anim:i%2===0?"tiltF 9s ease-in-out infinite":"tiltF 11s ease-in-out infinite reverse",
    }));
    const drops = Array.from({length: Math.round(7*density)}, (_,i) => ({
      type:"drop", left:`${(i*14+5)%95}%`, size:3+(i%3),
      delay:`${(i*.55)%3}s`, dur:`${2.2+(i%3)}s`, op:0.20,
    }));
    return [...beans, ...cups, ...drops];
  }, [density]);

  return (
    <div style={{position:"absolute",inset:0,overflow:"hidden",pointerEvents:"none"}}>
      {items.map((item,i) => {
        if (item.type === "bean") return (
          <svg key={i} width={item.size} height={item.size*1.45} viewBox="0 0 22 32" fill="none"
            style={{position:"absolute",top:item.top,left:item.left,opacity:item.op,animation:`${item.anim} ${item.delay} both`}}>
            <ellipse cx="11" cy="16" rx="9.5" ry="14" fill="rgba(255,255,255,.92)" stroke="rgba(200,230,210,.4)" strokeWidth=".5"/>
            <path d="M11 4 Q17 12 11 22 Q5 12 11 4Z" fill="rgba(20,50,30,.55)"/>
            <ellipse cx="11" cy="16" rx="9.5" ry="14" fill="none" stroke="rgba(255,255,255,.3)" strokeWidth=".8"/>
          </svg>
        );
        if (item.type === "cup") return (
          <div key={i} style={{position:"absolute",top:item.top,left:item.left,opacity:item.op,animation:item.anim}}>
            <svg width={item.size} height={item.size*1.45} viewBox="0 0 60 87" fill="none">
              <path d="M22 20 Q18 10 22 3" stroke="rgba(255,255,255,.9)" strokeWidth="2.5" fill="none" strokeLinecap="round" style={{animation:`steam 2.6s ease-in-out infinite ${item.delay}`}}/>
              <path d="M30 22 Q26 11 30 4" stroke="rgba(255,255,255,.85)" strokeWidth="2" fill="none" strokeLinecap="round" style={{animation:`steam 2.6s ease-in-out infinite ${parseFloat(item.delay)+.45}s`}}/>
              <path d="M38 20 Q34 10 38 3" stroke="rgba(255,255,255,.9)" strokeWidth="2.5" fill="none" strokeLinecap="round" style={{animation:`steam 2.6s ease-in-out infinite ${parseFloat(item.delay)+.9}s`}}/>
              <ellipse cx="30" cy="80" rx="26" ry="5" fill="rgba(255,255,255,.22)" stroke="rgba(255,255,255,.35)" strokeWidth="1"/>
              <path d="M8 28 L14 72 H46 L52 28 Z" fill="rgba(255,255,255,.25)" stroke="rgba(255,255,255,.55)" strokeWidth="1.8"/>
              <path d="M8 28 H52" stroke="rgba(255,255,255,.7)" strokeWidth="2.5" strokeLinecap="round"/>
              <ellipse cx="30" cy="34" rx="17" ry="4" fill="rgba(20,50,30,.22)"/>
              <path d="M24 34 Q30 30 36 34" stroke="rgba(255,255,255,.2)" strokeWidth="1" fill="none"/>
              <path d="M52 36 Q66 36 66 48 Q66 60 52 60" stroke="rgba(255,255,255,.55)" strokeWidth="3" fill="none" strokeLinecap="round"/>
              <path d="M52 40 Q62 40 62 48 Q62 56 52 56" stroke="rgba(255,255,255,.2)" strokeWidth="2" fill="none" strokeLinecap="round"/>
            </svg>
          </div>
        );
        if (item.type === "drop") return (
          <div key={i} style={{position:"absolute",top:"-3%",left:item.left,width:item.size,height:item.size*1.6,borderRadius:"50% 50% 50% 50%/60% 60% 40% 40%",background:"rgba(255,255,255,.25)",animation:`dropF ${item.dur} ${item.delay} ease-in infinite`,opacity:item.op}}/>
        );
        return null;
      })}
      {[{t:"8%",l:"26%",d:"0s"},{t:"55%",l:"70%",d:".9s"},{t:"30%",l:"82%",d:"1.6s"}].map((l,i)=>(
        <svg key={`leaf${i}`} width="26" height="32" viewBox="0 0 30 36" fill="none"
          style={{position:"absolute",top:l.t,left:l.l,opacity:.16,animation:`leafSway 4.5s ease-in-out infinite ${l.d}`,transformOrigin:"bottom center"}}>
          <path d="M15 34C15 34 4 23 4 13C4 6 9 2 15 2C21 2 26 6 26 13C26 23 15 34 15 34Z" fill="rgba(255,255,255,.85)"/>
          <path d="M15 34Q15 18 15 2" stroke="rgba(20,50,30,.4)" strokeWidth="1.5" fill="none"/>
          <path d="M15 22Q9 17 4 13" stroke="rgba(20,50,30,.25)" strokeWidth="1" fill="none"/>
          <path d="M15 27Q21 22 26 13" stroke="rgba(20,50,30,.25)" strokeWidth="1" fill="none"/>
        </svg>
      ))}
      {[{t:"33%",l:"17%",d:"0s"},{t:"67%",l:"60%",d:"1.1s"},{t:"14%",l:"71%",d:"2.3s"},{t:"81%",l:"13%",d:".55s"},{t:"48%",l:"41%",d:"1.8s"}].map((s,i)=>(
        <div key={`spark${i}`} style={{position:"absolute",top:s.t,left:s.l,width:5,height:5,borderRadius:"50%",background:"rgba(255,255,255,.7)",animation:`sparkle 3s ease-in-out infinite ${s.d}`}}/>
      ))}
      <div style={{position:"absolute",top:"-10%",right:"-8%",width:300,height:300,borderRadius:"50%",background:"radial-gradient(circle,rgba(150,220,170,.1) 0%,transparent 70%)",animation:"pulse2 6s ease-in-out infinite"}}/>
      <div style={{position:"absolute",bottom:"-8%",left:"-6%",width:250,height:250,borderRadius:"50%",background:"radial-gradient(circle,rgba(180,240,190,.08) 0%,transparent 70%)",animation:"pulse2 8s ease-in-out infinite 2s"}}/>
    </div>
  );
}

/* ══ Logo ═══════════════════════════════════════════════════════════════════ */
const Logo = ({size=48}) => (
  <svg width={size} height={size} viewBox="0 0 120 100" fill="none">
    <defs>
      <linearGradient id="lg1" x1="20" y1="20" x2="90" y2="90" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#7abf8a"/><stop offset="100%" stopColor="#3a6648"/></linearGradient>
      <linearGradient id="lg2" x1="70" y1="15" x2="110" y2="70" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#8fcf9f"/><stop offset="100%" stopColor="#4a7c59"/></linearGradient>
    </defs>
    <ellipse cx="52" cy="58" rx="36" ry="46" fill="url(#lg1)" transform="rotate(-18 52 58)"/>
    <path d="M28 28 Q52 58 32 88" stroke="#0f2318" strokeWidth="4.5" fill="none" strokeLinecap="round"/>
    <ellipse cx="86" cy="42" rx="22" ry="32" fill="url(#lg2)" transform="rotate(14 86 42)"/>
    <path d="M72 22 Q86 42 74 64" stroke="#0f2318" strokeWidth="3.5" fill="none" strokeLinecap="round"/>
  </svg>
);

/* ══ Confetti ═══════════════════════════════════════════════════════════════ */
function Confetti() {
  const pieces = useMemo(() => {
    const cols = ["#4ade80","#22c55e","#86efac","#fbbf24","#f97316","#34d399","#a3e635","#fde68a","#fb7185","#60a5fa"];
    const shapes = ["●","■","▲","◆","✦","★","▬","⬟"];
    return Array.from({length:55},(_,i)=>({
      id:i, color:cols[i%cols.length], shape:shapes[i%shapes.length],
      left:`${(i*1.9)%100}%`, size:`${8+(i%9)}px`,
      delay:`${(i*.028)%1.6}s`, dur:`${2.6+(i%8)*.25}s`,
      drift: i%3===0?"cfettiW":"cfetti",
      rotate: `${(i*47)%360}deg`,
    }));
  },[]);
  return (
    <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:9999,overflow:"hidden"}}>
      {pieces.map(p=>(
        <div key={p.id} style={{
          position:"absolute",top:0,left:p.left,color:p.color,fontSize:p.size,
          animation:`${p.drift} ${p.dur} ${p.delay} ease-in both`,
          transform:`rotate(${p.rotate})`,
          filter:"drop-shadow(0 2px 3px rgba(0,0,0,.18))",
        }}>{p.shape}</div>
      ))}
    </div>
  );
}

function SuccessOverlay({name,onDone}) {
  useEffect(()=>{const t=setTimeout(onDone,5000);return()=>clearTimeout(t);},[onDone]);
  const first=name?name.split(" ")[0]:"";
  return (
    <><Confetti/>
    <div onClick={onDone} style={{position:"fixed",inset:0,zIndex:9998,background:"linear-gradient(135deg,rgba(5,18,10,.96),rgba(15,45,25,.93))",display:"flex",alignItems:"center",justifyContent:"center",animation:"ovIn .38s ease both",cursor:"pointer"}}>
      <div style={{textAlign:"center",padding:"0 32px",maxWidth:540}}>
        <div className="fl" style={{width:108,height:108,borderRadius:"50%",background:"linear-gradient(135deg,#0d4020,#14532d,#16a34a,#4ade80)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 28px",animation:"popIn .7s cubic-bezier(.34,1.56,.64,1) both,pring 2.4s ease-out .9s",boxShadow:"0 0 0 20px rgba(74,222,128,.1),0 18px 56px rgba(22,163,74,.65)"}}>
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{strokeDasharray:50,animation:"chkDraw .55s ease .7s both"}}><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <h1 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:46,color:"#fff",fontWeight:700,lineHeight:1.1,marginBottom:14,animation:"txtUp .5s ease .44s both",textShadow:"0 4px 28px rgba(0,0,0,.4)"}}>{first?`You're in, ${first}!`:"Application Submitted!"}</h1>
        <p style={{color:"#a8d5b5",fontSize:17,lineHeight:1.85,marginBottom:28,animation:"txtUp .5s ease .58s both",fontWeight:300}}>We've received your application and will review it carefully. Use the "My Status" tab with your email to track your progress. ☕</p>
        <div style={{display:"flex",gap:10,justifyContent:"center",flexWrap:"wrap",animation:"txtUp .5s ease .72s both"}}>
          {["Application received ✓","Being reviewed","Track with My Status"].map(s=><span key={s} style={{background:"rgba(255,255,255,.12)",border:"1px solid rgba(255,255,255,.2)",borderRadius:22,padding:"7px 18px",color:"rgba(255,255,255,.88)",fontSize:12,fontWeight:500,backdropFilter:"blur(6px)"}}>{s}</span>)}
        </div>
        <p style={{color:"rgba(255,255,255,.3)",fontSize:11,marginTop:28,animation:"txtUp .5s ease .9s both"}}>Tap anywhere to close</p>
      </div>
    </div></>
  );
}

/* ══ Brew Chatbot ════════════════════════════════════════════════════════════ */
function Chatbot({context="apply"}) {
  const initMsg = context==="status"
    ? "Hi! ☕ I'm Brew, your Hope Coffee assistant. I can explain your status, your fit score, or answer any questions about the process."
    : "Hey! ☕ I'm Brew. I know everything about applying to Hope Coffee, our positions, and how the fit score works. What's on your mind?";

  const [open,setOpen]=useState(false);
  const [msgs,setMsgs]=useState([{role:"assistant",text:initMsg}]);
  const [input,setInput]=useState("");
  const [loading,setLoading]=useState(false);
  const [wig,setWig]=useState(false);
  const endRef=useRef(null);
  useEffect(()=>{endRef.current?.scrollIntoView({behavior:"smooth"});},[msgs,loading]);
  useEffect(()=>{
    if(!open){const t=setInterval(()=>{setWig(true);setTimeout(()=>setWig(false),700)},5500);return()=>clearInterval(t);}
  },[open]);

  async function send(){
    const text=sanitize(input,800).trim(); if(!text||loading) return;
    setInput("");
    const history=[...msgs,{role:"user",text}];
    setMsgs(history); setLoading(true);

    const kbAnswer = brewAnswer(text);
    if (kbAnswer) {
      setTimeout(()=>{
        setMsgs(p=>[...p,{role:"assistant",text:kbAnswer}]);
        setLoading(false);
      }, 400);
      return;
    }

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          model:"claude-sonnet-4-20250514",
          max_tokens:350,
          system:`You are Brew, a warm friendly AI for Hire4Hope — Hope Coffee Melissa TX (2907 McKinney St, (469) 518-1994, melissa@hopecoffee.com, Mon-Sat 6AM-6PM). Be brief (2-3 sentences), encouraging, occasionally use a coffee pun. Positions: Barista and Shift Lead. Fit score: 1-10, Experience(30%), Availability(20%), Role Fit(15%), Resume(20%), Background(10%), Online Presence(5%). Status: New=received, Interview=shortlisted, Hired=offer extended, Rejected=not selected but encouraged to reapply. If you truly don't know, say so honestly rather than making something up.`,
          messages:history.map(m=>({role:m.role,content:m.text})),
        }),
      });
      if(!res.ok) throw new Error("API error "+res.status);
      const data=await res.json();
      const reply=data?.content?.find(b=>b.type==="text")?.text;
      if(!reply) throw new Error("No reply");
      setMsgs(p=>[...p,{role:"assistant",text:sanitize(reply,1200)}]);
    } catch {
      const fallback = "I'm not sure about that specific question, but I'm happy to help with anything about applying, positions, the fit score, or your application status! What else can I help with? ☕";
      setMsgs(p=>[...p,{role:"assistant",text:fallback}]);
    }
    setLoading(false);
  }

  const btnStyle = {
    width:38,height:38,borderRadius:"50%",border:"none",flexShrink:0,
    background:input.trim()&&!loading?"linear-gradient(135deg,#1a3d28,#2d5a3d,#4a7c59)":"linear-gradient(135deg,#c8ddd0,#d8e8dc)",
    display:"flex",alignItems:"center",justifyContent:"center",
    boxShadow:input.trim()&&!loading?"0 3px 12px rgba(26,61,40,.4)":"none",
    cursor:input.trim()&&!loading?"pointer":"not-allowed",
  };

  return (
    <>
      <div style={{position:"fixed",bottom:24,right:24,zIndex:1000,width:62,height:62}}>
        <button type="button" onClick={()=>setOpen(o=>!o)} className="apple-btn"
          style={{width:62,height:62,borderRadius:"50%",background:"linear-gradient(165deg,#2d6645 0%,#1a3d28 40%,#0f2318 100%)",boxShadow:"0 6px 28px rgba(15,35,24,.6),0 2px 8px rgba(15,35,24,.3)",display:"flex",alignItems:"center",justifyContent:"center",animation:wig&&!open?"wiggle .55s ease":"none"}}>
          {open?<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>:<Logo size={30}/>}
        </button>
        {!open&&<div style={{position:"absolute",top:0,right:0,width:20,height:20,borderRadius:"50%",background:"linear-gradient(135deg,#16a34a,#22c55e)",border:"2.5px solid #fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"#fff",fontWeight:800,boxShadow:"0 2px 6px rgba(22,163,74,.55)",pointerEvents:"none"}}>AI</div>}
      </div>

      {open&&(
        <div style={{position:"fixed",bottom:100,right:24,zIndex:999,width:"min(360px,calc(100vw - 32px))",maxHeight:520,background:"linear-gradient(160deg,#fff,#f5fbf7)",borderRadius:22,overflow:"hidden",boxShadow:"0 24px 64px rgba(15,35,24,.32),0 0 0 1px rgba(74,124,89,.12)",display:"flex",flexDirection:"column",animation:"chatPop .36s cubic-bezier(.34,1.56,.64,1) both"}}>
          <div style={{background:"linear-gradient(135deg,#0c1f12,#1a3d28,#2d5a3d,#4a7c59)",padding:"15px 18px",display:"flex",alignItems:"center",gap:12}}>
            <div className="fl" style={{width:40,height:40,borderRadius:"50%",flexShrink:0,background:"rgba(255,255,255,.14)",border:"1.5px solid rgba(255,255,255,.22)",display:"flex",alignItems:"center",justifyContent:"center"}}><Logo size={24}/></div>
            <div><div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:"#fff",fontWeight:700,letterSpacing:".01em"}}>Brew</div><div style={{color:"#a8d5b5",fontSize:11,display:"flex",alignItems:"center",gap:5,marginTop:2}}><span style={{width:6,height:6,borderRadius:"50%",background:"#4ade80",boxShadow:"0 0 6px #4ade80",display:"inline-block"}}/>AI · Hope Coffee</div></div>
            <div style={{marginLeft:"auto",color:"rgba(255,255,255,.45)",fontFamily:"'Caveat',cursive",fontSize:12}}>Ask me anything!</div>
          </div>
          <div style={{flex:1,overflowY:"auto",padding:"14px 13px 8px",display:"flex",flexDirection:"column",gap:11,minHeight:0}}>
            {msgs.map((m,i)=>(
              <div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start",animation:"msgIn .26s ease both"}}>
                {m.role==="assistant"&&<div style={{width:27,height:27,borderRadius:"50%",background:"linear-gradient(135deg,#1a3d28,#4a7c59)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginRight:8,marginTop:2}}><Logo size={15}/></div>}
                <div style={{maxWidth:"78%",padding:"10px 13px",borderRadius:m.role==="user"?"18px 18px 4px 18px":"18px 18px 18px 4px",background:m.role==="user"?"linear-gradient(135deg,#1a3d28,#2d5a3d,#4a7c59)":"linear-gradient(135deg,#f0faf3,#e6f5ea)",color:m.role==="user"?"#fff":"#1a2e22",fontSize:13,lineHeight:1.68,boxShadow:m.role==="user"?"0 3px 12px rgba(26,61,40,.32)":"0 2px 8px rgba(26,61,40,.09)",border:m.role==="assistant"?"1px solid rgba(74,124,89,.14)":"none"}}>
                  {m.text.split(/(\*\*[^*]+\*\*)/).map((part,j)=>
                    part.startsWith("**")&&part.endsWith("**")
                      ?<strong key={j}>{part.slice(2,-2)}</strong>
                      :<React.Fragment key={j}>{part}</React.Fragment>
                  )}
                </div>
              </div>
            ))}
            {loading&&<div style={{display:"flex",gap:8}}><div style={{width:27,height:27,borderRadius:"50%",background:"linear-gradient(135deg,#1a3d28,#4a7c59)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Logo size={15}/></div><div style={{background:"linear-gradient(135deg,#f0faf3,#e6f5ea)",borderRadius:"18px 18px 18px 4px",padding:"11px 15px",display:"flex",gap:5,alignItems:"center"}}>{[0,1,2].map(d=><span key={d} style={{width:7,height:7,borderRadius:"50%",background:"#4a7c59",display:"inline-block",animation:`dot 1.2s ease ${d*.22}s infinite`}}/>)}</div></div>}
            <div ref={endRef}/>
          </div>
          {msgs.length<=1&&(
            <div style={{padding:"0 13px 10px",display:"flex",gap:6,flexWrap:"wrap"}}>
              {(context==="status"?["What does my status mean?","How is my score calculated?","When will I hear back?"]:["How do I apply?","What positions are open?","What's a fit score?"]).map(q=>(
                <button key={q} type="button" onClick={()=>setInput(q)} className="bh" style={{padding:"5px 11px",borderRadius:18,border:"1px solid #b8e6c8",background:"linear-gradient(135deg,#eaf7ee,#d8f0e2)",color:"#1a4028",fontSize:11,fontWeight:600,cursor:"pointer"}}>{q}</button>
              ))}
            </div>
          )}
          <div style={{padding:"9px 13px 13px",borderTop:"1px solid #d8ece0",background:"linear-gradient(135deg,#f6fcf8,#fff)"}}>
            <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
              <textarea value={input} onChange={e=>setInput(e.target.value.slice(0,800))} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}} placeholder="Ask Brew anything…" rows={1} style={{flex:1,resize:"none",border:"1.5px solid #c0ddc8",borderRadius:12,padding:"9px 12px",fontSize:13,color:"#1a2e22",outline:"none",background:"linear-gradient(135deg,#fff,#f6fbf8)",maxHeight:90,overflowY:"auto"}}/>
              <button type="button" onClick={send} disabled={!input.trim()||loading} style={btnStyle} className="apple-btn">
                {loading?<div style={{width:14,height:14,borderRadius:"50%",border:"2px solid rgba(255,255,255,.35)",borderTopColor:"#fff",animation:"spin .7s linear infinite"}}/>:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>}
              </button>
            </div>
            <p style={{color:"#7ab895",marginTop:6,textAlign:"center",fontFamily:"'Caveat',cursive",fontSize:12}}>Brew knows Hope Coffee inside out ☕</p>
          </div>
        </div>
      )}
    </>
  );
}

/* ══ Form atoms ══════════════════════════════════════════════════════════════ */
const FL = ({text,optional}) => (
  <div style={{color:"#14402a",fontSize:12,fontWeight:700,marginBottom:7,letterSpacing:".04em",textTransform:"uppercase"}}>
    {text}{optional&&<span style={{textTransform:"none",fontWeight:400,color:"#6a9e7a",marginLeft:5}}>(optional)</span>}
  </div>
);
const FD = ({label}) => (
  <div style={{display:"flex",alignItems:"center",gap:10,margin:"6px 0 18px"}}>
    <div style={{flex:1,height:1.5,background:"linear-gradient(90deg,#a8d8ba,transparent)"}}/>
    <span style={{fontFamily:"'Caveat',cursive",fontSize:16,fontWeight:700,color:"#1a5038",padding:"4px 14px",background:"linear-gradient(135deg,#d8f0e2,#eaf7ee)",borderRadius:24,border:"1px solid #a8d8ba",boxShadow:"0 2px 8px rgba(74,124,89,.14)"}}>{label}</span>
    <div style={{flex:1,height:1.5,background:"linear-gradient(90deg,transparent,#a8d8ba)"}}/>
  </div>
);

/* ══ Apply Page ══════════════════════════════════════════════════════════════ */
function ApplyPage({onSubmit}) {
  const [f,setF]=useState({fn:"",em:"",ph:"",pos:"",yr:"",av:"",bg:"",fp:"",rt:""});
  const up=(k,v)=>setF(p=>({...p,[k]:v}));
  const [rTab,setRTab]=useState("text"); const [rFile,setRFile]=useState(null);
  const [dragOver,setDragOver]=useState(false); const [focused,setFocused]=useState(null);
  const [mounted,setMounted]=useState(false); const [busy,setBusy]=useState(false);
  const [showWin,setShowWin]=useState(false); const [winName,setWinName]=useState("");
  const [errors,setErrors]=useState({}); const [lastSub,setLastSub]=useState(0);
  const fileRef=useRef(null);
  useEffect(()=>{setTimeout(()=>setMounted(true),60);},[]);

  function handleFile(file){
    if(!file) return;
    if(!/\.(pdf|doc|docx|txt)$/i.test(file.name)){alert("PDF, Word, or .txt only");return;}
    if(file.size>5*1024*1024){alert("Max 5 MB");return;}
    setRFile(file);
  }

  async function doSubmit(){
    if(busy) return;
    const now=Date.now();
    if(lastSub&&now-lastSub<20000){alert("Please wait before resubmitting.");return;}
    const errs={};
    if(!f.fn.trim()) errs.fn="Required";
    if(!f.em.trim()||!/\S+@\S+\.\S+/.test(f.em)) errs.em="Valid email required";
    if(!f.ph.trim()) errs.ph="Required";
    if(!f.pos) errs.pos="Required";
    if(!f.av.trim()) errs.av="Required";
    if(Object.keys(errs).length){setErrors(errs);return;}
    setErrors({}); setBusy(true); setLastSub(now);
    const cleanPos=["Barista","Shift Lead"].includes(f.pos)?f.pos:"Barista";
    const yrs=clampNum(f.yr,0,60);
    const entry={
      created_at:new Date().toISOString(),
      full_name:sanitize(f.fn,100), email:sanitize(f.em,200).toLowerCase(), phone:sanitize(f.ph,30),
      position:cleanPos, experience_years:yrs, availability:sanitize(f.av,300),
      digital_footprint:sanitize(f.fp,300), background_notes:sanitize(f.bg,500),
      resume_summary:rTab==="upload"?(rFile?`[Resume file: ${sanitize(rFile.name,100)}]`:""):sanitize(f.rt,2000),
      resume_file_name:rTab==="upload"?(rFile?sanitize(rFile.name,100):null):null,
      status:"New", deleted_by_manager:false,
    };
    const {score,breakdown}=calcScore(entry);
    entry.risk_score=score; entry.score_breakdown=breakdown;
    await onSubmit(entry);
    setBusy(false); setWinName(entry.full_name); setShowWin(true);
    setF({fn:"",em:"",ph:"",pos:"",yr:"",av:"",bg:"",fp:"",rt:""}); setRFile(null); setRTab("text");
  }

  const I=n=>({
    width:"100%",
    background:focused===n?"linear-gradient(135deg,#fff,#f0faf4)":"linear-gradient(135deg,#f5faf7,#eef7f2)",
    border:`2.5px solid ${errors[n]?"#ef4444":focused===n?"#2d7a4a":"#b8ddc8"}`,
    borderRadius:14,padding:"13px 16px",color:"#1a2e22",fontSize:14,outline:"none",
    boxShadow:focused===n?"0 0 0 4px rgba(45,122,74,.14),0 4px 16px rgba(45,122,74,.1)":"0 2px 8px rgba(26,61,40,.07)",
    transition:"all .2s",
  });
  const E=k=>errors[k]&&<span style={{color:"#ef4444",fontSize:11,marginTop:4,display:"block"}}>{errors[k]}</span>;

  return (
    <>
      {showWin&&<SuccessOverlay name={winName} onDone={()=>setShowWin(false)}/>}
      <div style={{minHeight:"100%",background:`${wallpaper} repeat, linear-gradient(160deg,#d8f0e2,#e8f7ee 40%,#f2fbf5)`,backgroundSize:"80px 80px, cover",animation:"bgScroll 22s linear infinite"}}>

        <div className="gb" style={{position:"relative",padding:"48px 24px 68px",overflow:"hidden",minHeight:300}}>
          <CoffeeBG density={1.1}/>
          <div style={{position:"relative",zIndex:2,maxWidth:580,margin:"0 auto"}}>
            <div className={mounted?"fu":""} style={{display:"flex",alignItems:"center",gap:18,marginBottom:28}}>
              <div className="fl" style={{background:"linear-gradient(135deg,rgba(255,255,255,.2),rgba(255,255,255,.08))",borderRadius:22,padding:"12px 14px",backdropFilter:"blur(12px)",border:"1.5px solid rgba(255,255,255,.22)",boxShadow:"0 10px 36px rgba(0,0,0,.22)"}}>
                <Logo size={58}/>
              </div>
              <div>
                <div className="now-hiring" style={{fontFamily:"'Caveat',cursive",color:"#92d4aa",fontSize:17,fontWeight:700,marginBottom:3,letterSpacing:".02em"}}>Now Hiring at</div>
                <div className="hero-sub" style={{fontFamily:"'Cormorant Garamond',serif",fontSize:30,color:"#fff",fontWeight:700,lineHeight:1,textShadow:"0 2px 14px rgba(0,0,0,.35)"}}>Hope Coffee Melissa</div>
              </div>
            </div>
            <div className={mounted?"fu":""} style={{animationDelay:"70ms"}}>
              <h1 className="hero-h1" style={{fontFamily:"'Cormorant Garamond',serif",fontSize:50,color:"#fff",fontWeight:700,margin:"0 0 16px",lineHeight:1.08,textShadow:"0 3px 22px rgba(0,0,0,.28)"}}>Join Our Team ☕</h1>
              <p style={{color:"#b8e8c8",fontSize:15,margin:"0 0 26px",lineHeight:1.85,maxWidth:460,fontWeight:300}}>Melissa's gathering place, craft coffee, good people, second chances. Every application is read by a real human.</p>
            </div>
            <div className={mounted?"fu":""} style={{animationDelay:"130ms",display:"flex",gap:10,flexWrap:"wrap"}}>
              {["Welcoming team","Flexible hours","Fair pay","Community-driven"].map(t=>(
                <span key={t} style={{background:"linear-gradient(135deg,rgba(255,255,255,.15),rgba(255,255,255,.07))",color:"#c8f0d8",fontSize:12,padding:"6px 16px",borderRadius:24,fontWeight:500,border:"1px solid rgba(255,255,255,.18)",backdropFilter:"blur(8px)"}}>✓ {t}</span>
              ))}
            </div>
          </div>
        </div>

        <div style={{maxWidth:580,margin:"0 auto",padding:"0 16px 80px"}}>
          <div className={`${mounted?"si":""} form-card`} style={{background:"linear-gradient(160deg,#fff,#f5fbf8)",borderRadius:28,padding:"38px 34px",marginTop:-34,boxShadow:"0 28px 70px rgba(26,61,40,.2),0 8px 24px rgba(26,61,40,.12),0 0 0 1px rgba(74,124,89,.08)"}}>
            <div style={{background:"linear-gradient(135deg,#d8f2e4,#e8f7ee,#d4f0e0)",borderRadius:15,padding:"16px 20px",marginBottom:26,border:"1.5px solid #a8d8b8",boxShadow:"0 4px 14px rgba(74,124,89,.1),inset 0 1px 0 rgba(255,255,255,.7)"}}>
              <p style={{color:"#0d3a1e",fontSize:13,lineHeight:1.8}}><strong style={{fontWeight:700}}>🔒 Your privacy matters.</strong> We only collect job-related info. No social media scraping. Track your application with the "My Status" tab after submitting.</p>
            </div>

            <div style={{display:"flex",flexDirection:"column",gap:22}}>
              <FD label="Contact Info"/>
              <div style={{display:"flex",flexDirection:"column",gap:15}}>
                <div><FL text="Full Name *"/><input type="text" value={f.fn} onChange={e=>up("fn",e.target.value.slice(0,100))} placeholder="Jane Smith" style={I("fn")} onFocus={()=>setFocused("fn")} onBlur={()=>setFocused(null)} autoComplete="name"/>{E("fn")}</div>
                <div className="form-grid-2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  <div><FL text="Email *"/><input type="email" value={f.em} onChange={e=>up("em",e.target.value.slice(0,200))} placeholder="jane@email.com" style={I("em")} onFocus={()=>setFocused("em")} onBlur={()=>setFocused(null)} autoComplete="email"/>{E("em")}</div>
                  <div><FL text="Phone *"/><input type="tel" value={f.ph} onChange={e=>up("ph",e.target.value.slice(0,30))} placeholder="(214) 555-0000" style={I("ph")} onFocus={()=>setFocused("ph")} onBlur={()=>setFocused(null)} autoComplete="tel"/>{E("ph")}</div>
                </div>
              </div>

              <FD label="Role & Experience"/>
              <div style={{display:"flex",flexDirection:"column",gap:15}}>
                <div className="form-grid-2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  <div><FL text="Position *"/>
                    <select value={f.pos} onChange={e=>up("pos",e.target.value)} style={{...I("pos"),cursor:"pointer"}} onFocus={()=>setFocused("pos")} onBlur={()=>setFocused(null)}>
                      <option value="">Select…</option><option value="Barista">Barista</option><option value="Shift Lead">Shift Lead</option>
                    </select>{E("pos")}
                  </div>
                  <div><FL text="Years Exp."/><input type="number" min="0" max="60" value={f.yr} onChange={e=>up("yr",e.target.value)} placeholder="0" style={I("yr")} onFocus={()=>setFocused("yr")} onBlur={()=>setFocused(null)}/></div>
                </div>
                <div><FL text="Availability *"/><textarea value={f.av} onChange={e=>up("av",e.target.value.slice(0,300))} rows={2} placeholder="e.g. Flexible, weekdays open, weekends after noon" style={{...I("av"),resize:"vertical",minHeight:72}} onFocus={()=>setFocused("av")} onBlur={()=>setFocused(null)}/>{E("av")}</div>
              </div>

              <FD label="About You"/>
              <div style={{display:"flex",flexDirection:"column",gap:15}}>
                <div>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                    <FL text="Resume"/>
                    <div style={{display:"flex",gap:4,background:"linear-gradient(135deg,#d8f0e2,#eaf7ee)",borderRadius:24,padding:4,border:"1px solid #a8d8ba"}}>
                      <button type="button" onClick={()=>setRTab("text")} className="apple-btn" style={{padding:"5px 14px",borderRadius:18,border:"none",fontSize:12,fontWeight:rTab==="text"?700:500,background:rTab==="text"?"linear-gradient(165deg,#2a6040,#1a3d28,#0f2318)":"transparent",color:rTab==="text"?"#fff":"#1a5030",boxShadow:rTab==="text"?"0 2px 8px rgba(26,61,40,.35)":"none",transition:"all .2s"}}>✏️ Write</button>
                      <button type="button" onClick={()=>setRTab("upload")} className="apple-btn" style={{padding:"5px 14px",borderRadius:18,border:"none",fontSize:12,fontWeight:rTab==="upload"?700:500,background:rTab==="upload"?"linear-gradient(165deg,#2a6040,#1a3d28,#0f2318)":"transparent",color:rTab==="upload"?"#fff":"#1a5030",boxShadow:rTab==="upload"?"0 2px 8px rgba(26,61,40,.35)":"none",transition:"all .2s"}}>📎 Upload</button>
                    </div>
                  </div>
                  {rTab==="text"
                    ?<textarea value={f.rt} onChange={e=>up("rt",e.target.value.slice(0,2000))} rows={4} placeholder="Your most recent roles and relevant experience (barista, customer service, food service, etc.)" style={{...I("rt"),resize:"vertical",minHeight:100}} onFocus={()=>setFocused("rt")} onBlur={()=>setFocused(null)}/>
                    :<div onClick={()=>fileRef.current?.click()} onDragOver={e=>{e.preventDefault();setDragOver(true)}} onDragLeave={()=>setDragOver(false)} onDrop={e=>{e.preventDefault();setDragOver(false);if(e.dataTransfer.files[0])handleFile(e.dataTransfer.files[0])}}
                      style={{width:"100%",minHeight:140,borderRadius:16,border:`2.5px dashed ${dragOver?"#2d7a4a":rFile?"#16a34a":"#9ccfae"}`,background:dragOver?"linear-gradient(135deg,#d8f2e4,#e8f7ee)":rFile?"linear-gradient(135deg,#e8faf2,#d0f0e0)":"linear-gradient(135deg,#f5faf7,#eef7f2)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10,cursor:"pointer",padding:"20px 16px",transition:"all .2s"}}>
                      <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.txt" style={{display:"none"}} onChange={e=>{if(e.target.files[0])handleFile(e.target.files[0]);}}/>
                      {rFile?<><div style={{width:48,height:48,borderRadius:"50%",background:"linear-gradient(135deg,#0d4020,#16a34a)",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 4px 14px rgba(22,163,74,.4)"}}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg></div><p style={{color:"#0d4020",fontSize:13,fontWeight:700,margin:0}}>{rFile.name}</p><p style={{color:"#5a9e6a",fontSize:11,margin:0}}>{(rFile.size/1024).toFixed(1)} KB · Click to replace</p></>
                      :<><div style={{width:48,height:48,borderRadius:"50%",background:"linear-gradient(135deg,#d0f0e0,#b8e8c8)",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 3px 12px rgba(74,124,89,.2)"}}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1a5030" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div><p style={{color:"#1a5030",fontSize:13,fontWeight:600,margin:0}}>Drag & drop or click to upload</p><p style={{color:"#5a9e6a",fontSize:11,margin:0}}>PDF, Word, or .txt · max 5 MB</p></>}
                    </div>
                  }
                </div>
                <div><FL text="Anything we should know" optional/><textarea value={f.bg} onChange={e=>up("bg",e.target.value.slice(0,500))} rows={2} placeholder="Volunteer work, community involvement, context you'd like to share…" style={{...I("bg"),resize:"vertical",minHeight:72}} onFocus={()=>setFocused("bg")} onBlur={()=>setFocused(null)}/></div>
                <div><FL text="Online presence" optional/><input type="text" value={f.fp} onChange={e=>up("fp",e.target.value.slice(0,300))} placeholder="LinkedIn URL, portfolio, or brief description" style={I("fp")} onFocus={()=>setFocused("fp")} onBlur={()=>setFocused(null)}/></div>
              </div>

              <button type="button" onClick={doSubmit} disabled={busy} className="apple-btn"
                style={{marginTop:6,background:busy?"linear-gradient(165deg,#6aad8e,#8ac4a4)":"linear-gradient(165deg,#2d6645 0%,#1a3d28 40%,#0f2318 100%)",color:"#fff",border:"none",borderRadius:16,padding:"17px 26px",fontSize:15,fontWeight:800,cursor:busy?"not-allowed":"pointer",boxShadow:busy?"none":"0 8px 28px rgba(12,30,18,.5),0 3px 10px rgba(12,30,18,.3)",letterSpacing:".03em",display:"flex",alignItems:"center",justifyContent:"center",gap:10,width:"100%"}}>
                {busy?<><div style={{width:17,height:17,borderRadius:"50%",border:"2.5px solid rgba(255,255,255,.3)",borderTopColor:"#fff",animation:"spin .7s linear infinite"}}/>Submitting…</>:"Submit My Application →"}
              </button>
            </div>
          </div>
        </div>
      </div>
      <Chatbot context="apply"/>
    </>
  );
}

/* ══ My Status Page ══════════════════════════════════════════════════════════ */
function StatusPage({applicants}) {
  const [emailInput,setEmailInput]=useState(""); const [searched,setSearched]=useState(false);
  const [found,setFound]=useState(null); const [mounted,setMounted]=useState(false);
  useEffect(()=>{setTimeout(()=>setMounted(true),60);},[]);
  function doLookup(){const q=emailInput.trim().toLowerCase();if(!q)return;setFound(applicants.find(a=>a.email.toLowerCase()===q)||null);setSearched(true);}
  const statusInfo={
    New:      {icon:"📬",label:"Application Received",desc:"We've received your application and it's in our review queue. We read every application personally.",color:"#1e40af",bg:"linear-gradient(135deg,#c7ddff,#dbeafe,#eff6ff)"},
    Interview:{icon:"📅",label:"Interview Stage!",desc:"Your application stood out! We'd love to set up an interview. Watch your email closely.",color:"#713f12",bg:"linear-gradient(135deg,#fad44e,#fde68a,#fef9c3)"},
    Hired:    {icon:"🎉",label:"Offer Extended!",desc:"Congratulations, welcome to the Hope Coffee family! Check your email for onboarding details.",color:"#14532d",bg:"linear-gradient(135deg,#6deba0,#bbf7d0,#dcfce7)"},
    Rejected: {icon:"💌",label:"Application Closed",desc:"Thank you for your interest. We went with another candidate this time. Please apply again in the future!",color:"#7f1d1d",bg:"linear-gradient(135deg,#fcafc0,#fecdd3,#fee2e2)"},
  };
  const steps=["New","Interview","Hired"];
  const stepIdx=found?steps.indexOf(found.status):-1;
  const firstName=found?found.full_name.split(" ")[0]:"";

  return (
    <div style={{minHeight:"100%",background:`${wallpaper} repeat, linear-gradient(160deg,#d0eedd,#e0f5e8,#f0fbf4)`,backgroundSize:"80px 80px, cover",animation:"bgScroll 22s linear infinite"}}>
      <div className="gb" style={{position:"relative",padding:"40px 24px 52px",overflow:"hidden"}}>
        <CoffeeBG density={0.9}/>
        <div style={{position:"relative",zIndex:2,maxWidth:560,margin:"0 auto"}}>
          <div className={mounted?"fu":""} style={{display:"flex",alignItems:"center",gap:14,marginBottom:20}}>
            <div className="fl" style={{background:"rgba(255,255,255,.16)",borderRadius:16,padding:"9px 11px",border:"1.5px solid rgba(255,255,255,.22)"}}><Logo size={42}/></div>
            <div>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:26,color:"#fff",fontWeight:700,lineHeight:1,textShadow:"0 2px 12px rgba(0,0,0,.3)"}}>My Application</div>
              <div style={{fontFamily:"'Caveat',cursive",color:"#8ec9a4",fontSize:16,marginTop:3}}>Hope Coffee Melissa</div>
            </div>
          </div>
          <h1 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:38,color:"#fff",fontWeight:700,margin:"0 0 10px",textShadow:"0 2px 14px rgba(0,0,0,.3)"}}>
            {found?`Welcome back, ${firstName}! ☕`:"Check Your Status"}
          </h1>
          <p style={{color:"#a8d5b5",fontSize:14,lineHeight:1.75,fontWeight:300}}>{found?"Here's everything about your application.":"Enter the email you used when applying."}</p>
        </div>
      </div>

      <div style={{maxWidth:580,margin:"0 auto",padding:"0 16px 80px"}}>
        <div className={mounted?"si":""} style={{background:"linear-gradient(160deg,#fff,#f5fbf8)",borderRadius:24,padding:"24px 24px",marginTop:-24,boxShadow:"0 22px 58px rgba(26,61,40,.18),0 5px 18px rgba(26,61,40,.09)",marginBottom:16}}>
          <div style={{fontFamily:"'Caveat',cursive",fontSize:16,color:"#1a5030",fontWeight:700,marginBottom:13}}>🔍 Look up your application</div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            <input type="email" value={emailInput} onChange={e=>setEmailInput(e.target.value.slice(0,200))} onKeyDown={e=>{if(e.key==="Enter")doLookup();}} placeholder="your@email.com" style={{flex:"1 1 200px",background:"linear-gradient(135deg,#f5faf7,#eef7f2)",border:"2px solid #b8ddc8",borderRadius:13,padding:"12px 15px",color:"#1a2e22",fontSize:14,outline:"none"}}/>
            <button type="button" onClick={doLookup} className="apple-btn" style={{padding:"12px 22px",borderRadius:13,border:"none",background:"linear-gradient(165deg,#2d6645,#1a3d28,#0f2318)",color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",boxShadow:"0 5px 18px rgba(26,61,40,.4)",whiteSpace:"nowrap",flexShrink:0}}>Look Up</button>
          </div>
        </div>

        {searched&&!found&&(
          <div className="fu" style={{background:"linear-gradient(135deg,#fff,#fff5f7)",borderRadius:20,padding:"26px",border:"1.5px solid #f8b4c0",textAlign:"center",boxShadow:"0 4px 16px rgba(0,0,0,.06)"}}>
            <div style={{fontSize:40,marginBottom:12}}>🤔</div>
            <p style={{color:"#7f1d1d",fontWeight:700,fontSize:15,margin:"0 0 8px"}}>No application found</p>
            <p style={{color:"#6a9e7a",fontSize:13,margin:0,lineHeight:1.7}}>We couldn't find an application with that email. Double-check the address, or head to Apply to submit one.</p>
          </div>
        )}

        {found&&(
          <div className="fu" style={{display:"flex",flexDirection:"column",gap:14}}>
            {(()=>{const info=statusInfo[found.status]||statusInfo.New;return(
              <div style={{background:info.bg,borderRadius:22,padding:"24px 22px",border:`1.5px solid ${info.color}35`,boxShadow:"0 8px 28px rgba(0,0,0,.1)"}}>
                <div style={{display:"flex",alignItems:"flex-start",gap:16}}>
                  <div style={{fontSize:44,lineHeight:1,flexShrink:0}}>{info.icon}</div>
                  <div>
                    <div style={{color:info.color,fontSize:11,fontWeight:800,letterSpacing:".12em",textTransform:"uppercase",marginBottom:5}}>Current Status</div>
                    <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:26,color:info.color,fontWeight:700,margin:"0 0 9px"}}>{info.label}</h2>
                    <p style={{color:info.color,fontSize:13,lineHeight:1.75,margin:0,opacity:.88}}>{info.desc}</p>
                  </div>
                </div>
              </div>
            );})()}

            {found.status!=="Rejected"&&(
              <div style={{background:"linear-gradient(135deg,#fff,#f5fbf8)",borderRadius:20,padding:"20px 22px",boxShadow:"0 4px 18px rgba(26,61,40,.09)",border:"1.5px solid #c8e8d4"}}>
                <div style={{fontFamily:"'Caveat',cursive",fontSize:15,fontWeight:700,color:"#1a5030",marginBottom:16}}>Application Progress</div>
                <div style={{display:"flex",alignItems:"center"}}>
                  {steps.map((step,i)=>{const active=stepIdx>=i;const current=stepIdx===i;const st=stG(step);return(
                    <div key={step} style={{display:"flex",alignItems:"center",flex:i<steps.length-1?1:"none"}}>
                      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:5}}>
                        <div style={{width:38,height:38,borderRadius:"50%",background:active?st.g:"linear-gradient(135deg,#e0eee8,#d4e8dc)",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:active?`0 4px 14px ${st.d}60`:"none",animation:current?"statusPulse 2s ease infinite":"none",border:current?`2.5px solid ${st.d}`:"2.5px solid transparent"}}>
                          {active?<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>:<div style={{width:9,height:9,borderRadius:"50%",background:"#b8d4c0"}}/>}
                        </div>
                        <div style={{fontSize:10,fontWeight:current?800:500,color:active?st.c:"#8aab98",whiteSpace:"nowrap"}}>{step}</div>
                      </div>
                      {i<steps.length-1&&<div style={{flex:1,height:2.5,background:stepIdx>i?"linear-gradient(90deg,#16a34a,#4ade80)":"linear-gradient(90deg,#d4e8dc,#d4e8dc)",margin:"0 4px",marginBottom:22,borderRadius:2}}/>}
                    </div>
                  );})}
                </div>
              </div>
            )}

            <div style={{background:"linear-gradient(135deg,#fff,#f5fbf8)",borderRadius:20,padding:"20px 22px",boxShadow:"0 4px 18px rgba(26,61,40,.09)",border:"1.5px solid #c8e8d4"}}>
              <div style={{fontFamily:"'Caveat',cursive",fontSize:15,fontWeight:700,color:"#1a5030",marginBottom:16}}>👤 Your Application Details</div>
              <div className="status-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                {[
                  {l:"Name",      v:found.full_name},
                  {l:"Email",     v:found.email},
                  {l:"Phone",     v:found.phone},
                  {l:"Position",  v:found.position},
                  {l:"Applied",   v:new Date(found.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})},
                  {l:"Experience",v:`${found.experience_years} yr${found.experience_years!==1?"s":""}`},
                ].map(x=>(
                  <div key={x.l} style={{background:"linear-gradient(135deg,#eaf7f0,#d8f0e4)",borderRadius:12,padding:"12px 14px",border:"1px solid #b8ddc8"}}>
                    <div style={{color:"#5a9e6a",fontSize:10,fontWeight:700,letterSpacing:".09em",textTransform:"uppercase",marginBottom:4}}>{x.l}</div>
                    <div style={{color:"#0d3a1e",fontSize:13,fontWeight:600,wordBreak:"break-word"}}>{x.v||"—"}</div>
                  </div>
                ))}
              </div>
              {[{l:"Availability",v:found.availability},{l:"Resume Summary",v:found.resume_summary},{l:"Background Notes",v:found.background_notes},{l:"Online Presence",v:found.digital_footprint}].filter(x=>x.v).map(x=>(
                <div key={x.l} style={{background:"linear-gradient(135deg,#eaf7f0,#d8f0e4)",borderRadius:12,padding:"12px 14px",border:"1px solid #b8ddc8",marginBottom:8}}>
                  <div style={{color:"#5a9e6a",fontSize:10,fontWeight:700,letterSpacing:".09em",textTransform:"uppercase",marginBottom:5}}>{x.l}</div>
                  <div style={{color:"#0d3a1e",fontSize:13,lineHeight:1.7,whiteSpace:"pre-line"}}>{x.v}</div>
                </div>
              ))}
            </div>

            <div style={{background:"linear-gradient(135deg,#d8f0e4,#e4f7ec,#d0ede0)",borderRadius:20,padding:"20px 22px",border:"1.5px solid #a8d8b8",boxShadow:"0 5px 18px rgba(74,124,89,.12)"}}>
              <div style={{fontFamily:"'Caveat',cursive",fontSize:15,fontWeight:700,color:"#0d4020",marginBottom:14}}>⭐ Your Fit Score</div>
              <div style={{background:"linear-gradient(135deg,#fff4e0,#fef3c7)",borderRadius:12,padding:"10px 14px",border:"1px solid #fcd34d",marginBottom:14}}>
                <p style={{color:"#78350f",fontSize:12,lineHeight:1.7,margin:0}}><strong style={{fontWeight:700}}>⚠️ AI Estimate — Not Final.</strong> This score is automatically calculated by an AI rubric as a helpful guide. It is not a hiring decision. Brian personally reviews every application and your score is only one of many factors considered.</p>
              </div>
              <div className="score-flex" style={{display:"flex",alignItems:"center",gap:18,marginBottom:14}}>
                <div style={{position:"relative",width:84,height:84,flexShrink:0}}>
                  <svg width="84" height="84" viewBox="0 0 84 84" style={{transform:"rotate(-90deg)"}}>
                    <circle cx="42" cy="42" r="34" fill="none" stroke="#c8e8d4" strokeWidth="9"/>
                    <circle cx="42" cy="42" r="34" fill="none" stroke={found.risk_score>=8?"#16a34a":found.risk_score>=6?"#d97706":found.risk_score>=4?"#ea580c":"#ef4444"} strokeWidth="9" strokeDasharray={`${(found.risk_score/10)*213.6} 213.6`} strokeLinecap="round"/>
                  </svg>
                  <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                    <span style={{color:sTxt(found.risk_score),fontSize:23,fontWeight:800,lineHeight:1}}>{found.risk_score}</span>
                    <span style={{color:"#8aab98",fontSize:9,fontWeight:700}}>/10</span>
                  </div>
                </div>
                <div style={{flex:1}}>
                  <div style={{display:"inline-block",background:sBg(found.risk_score),color:sTxt(found.risk_score),fontSize:12,fontWeight:700,padding:"5px 14px",borderRadius:22,marginBottom:8,boxShadow:"0 2px 8px rgba(0,0,0,.1)"}}>{sLabel(found.risk_score)}</div>
                  <p style={{color:"#3a7a50",fontSize:12,lineHeight:1.7,margin:0}}>Experience is weighted most (30%). A higher score means more relevant background for coffee service roles.</p>
                </div>
              </div>
              {(found.score_breakdown||[]).map(b=>(
                <div key={b.label} style={{marginBottom:9}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                    <span style={{color:"#1a5030",fontSize:11,fontWeight:700}}>{b.label} <span style={{color:"#8aab98",fontWeight:400}}>({b.weight}%)</span></span>
                    <span style={{color:"#1a5030",fontSize:11,fontWeight:800}}>{b.raw}/10</span>
                  </div>
                  <div style={{height:7,borderRadius:4,background:"#b8e8c8",overflow:"hidden"}}>
                    <div style={{height:"100%",borderRadius:4,background:`linear-gradient(90deg,${b.raw>=7?"#0d9044,#22c55e":b.raw>=5?"#d97706,#fbbf24":"#ef4444,#fca5a5"})`,width:`${b.raw*10}%`,transition:"width 1s ease"}}/>
                  </div>
                </div>
              ))}
            </div>

            <div style={{background:"linear-gradient(135deg,#0c1f12,#1a3d28,#2d5a3d)",borderRadius:20,padding:"18px 22px",display:"flex",alignItems:"center",gap:14,boxShadow:"0 7px 26px rgba(12,31,18,.38)"}}>
              <div className="fl" style={{width:46,height:46,borderRadius:"50%",background:"rgba(255,255,255,.15)",border:"1.5px solid rgba(255,255,255,.22)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Logo size={28}/></div>
              <div style={{flex:1}}><div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:17,color:"#fff",fontWeight:700,marginBottom:3}}>Questions? Ask Brew ☕</div><p style={{color:"#a8d5b5",fontSize:12,margin:0,lineHeight:1.65}}>Brew can explain your status, what happens next, or anything about Hope Coffee.</p></div>
            </div>
          </div>
        )}
      </div>
      <Chatbot context="status"/>
    </div>
  );
}

/* ══ Manager Auth Gate ═══════════════════════════════════════════════════════ */
function ManagerAuthGate({onAuth}) {
  const [emailInput,setEmailInput]=useState(""); const [err,setErr]=useState("");
  const [attempts,setAttempts]=useState(0); const [locked,setLocked]=useState(false); const [lockTimer,setLockTimer]=useState(0);
  useEffect(()=>{
    if(locked&&lockTimer>0){const t=setInterval(()=>setLockTimer(s=>{if(s<=1){setLocked(false);setAttempts(0);return 0;}return s-1;}),1000);return()=>clearInterval(t);}
  },[locked,lockTimer]);
  function tryAccess(){
    if(locked) return;
    const clean=emailInput.trim().toLowerCase();
    if(ADMIN_EMAILS.has(clean)){onAuth(clean);}
    else{
      const a=attempts+1;setAttempts(a);setErr("That email is not authorized.");setEmailInput("");
      if(a>=4){setLocked(true);setLockTimer(30);setErr("Too many attempts. Locked for 30 seconds.");}
    }
  }
  return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",background:"linear-gradient(160deg,#d0eedd,#e0f5e8,#f0fbf4)",position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",inset:0,opacity:.3}} className="gb"><CoffeeBG density={0.5}/></div>
      <div className="si" style={{position:"relative",zIndex:1,background:"linear-gradient(160deg,#fff,#f5fbf8)",borderRadius:26,padding:"42px 38px",width:"min(390px,calc(100vw - 32px))",boxShadow:"0 22px 60px rgba(26,61,40,.18),0 5px 18px rgba(26,61,40,.1)",textAlign:"center"}}>
        <div className="fl" style={{width:68,height:68,borderRadius:"50%",background:"linear-gradient(165deg,#2a6040,#1a3d28,#0f2318)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 22px",boxShadow:"0 8px 26px rgba(12,30,18,.48)"}}><Logo size={38}/></div>
        <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:28,color:"#0d3a1e",fontWeight:700,margin:"0 0 8px"}}>Manager Access</h2>
        <p style={{color:"#5a9e6a",fontSize:13,margin:"0 0 26px",lineHeight:1.65}}>Enter your authorized email address to access the hiring dashboard.</p>
        <input type="email" value={emailInput} onChange={e=>setEmailInput(e.target.value.slice(0,200))} onKeyDown={e=>{if(e.key==="Enter")tryAccess();}} placeholder="manager@hopecoffee.com" disabled={locked}
          style={{width:"100%",background:"linear-gradient(135deg,#f5faf7,#eef7f2)",border:`2px solid ${err?"#ef4444":"#b8ddc8"}`,borderRadius:14,padding:"13px 16px",color:"#1a2e22",fontSize:14,outline:"none",marginBottom:14,textAlign:"center"}}/>
        <button type="button" onClick={tryAccess} disabled={locked||!emailInput.trim()} className="apple-btn"
          style={{width:"100%",padding:"14px 24px",borderRadius:14,border:"none",background:locked||!emailInput.trim()?"linear-gradient(135deg,#c8ddd0,#d8e8dc)":"linear-gradient(165deg,#2d6645,#1a3d28,#0f2318)",color:locked||!emailInput.trim()?"#6b9e7e":"#fff",fontSize:15,fontWeight:700,cursor:locked||!emailInput.trim()?"not-allowed":"pointer",boxShadow:locked||!emailInput.trim()?"none":"0 5px 20px rgba(26,61,40,.42)",marginBottom:14}}>
          {locked?`Try again in ${lockTimer}s`:"Access Dashboard →"}
        </button>
        {err&&<p style={{color:"#ef4444",fontSize:12,margin:0}}>{err}</p>}
        <p style={{color:"#8aab98",marginTop:14,fontFamily:"'Caveat',cursive",fontSize:13}}>🔒 Authorized emails only</p>
      </div>
    </div>
  );
}

/* ══ Manager Dashboard ═══════════════════════════════════════════════════════ */
function ManagerDashboard({applicants,onStatusChange,onDelete,managerEmail}) {
  const [sel,setSel]=useState(null);
  const [filter,setFilter]=useState("All");
  const [search,setSearch]=useState("");
  const [confirmDelete,setConfirmDelete]=useState(false);

  const selEntry = sel ? applicants.find(a=>a.id===sel&&!a.deleted_by_manager) : null;
  useEffect(()=>{if(sel&&!applicants.find(a=>a.id===sel&&!a.deleted_by_manager))setSel(null);},[applicants,sel]);

  const visibleApplicants = applicants.filter(a=>!a.deleted_by_manager);
  const counts=visibleApplicants.reduce((a,x)=>{a[x.status]=(a[x.status]||0)+1;return a;},{});
  const filtered=visibleApplicants.filter(a=>{
    if(filter!=="All"&&a.status!==filter) return false;
    if(search&&!a.full_name.toLowerCase().includes(search.toLowerCase())&&!a.email.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const managerName=managerEmail==="atharv.singh0912@gmail.com"?"Atharv":managerEmail==="annadurainaghul@gmail.com"?"Naghul":managerEmail==="melissa@hopecoffee.com"?"Brian":"Manager";
  const hour=new Date().getHours();
  const greeting=hour<12?"Good morning":hour<17?"Good afternoon":"Good evening";

  const cards=[
    {l:"Total",    v:visibleApplicants.length, g:"linear-gradient(165deg,#1c4a30,#1a3d28,#0f2318)"},
    {l:"New",      v:counts.New||0,             g:"linear-gradient(165deg,#2558a8,#1d4ed8,#1338a8)"},
    {l:"Interview",v:counts.Interview||0,        g:"linear-gradient(165deg,#9a4010,#b45309,#7a3208)"},
    {l:"Hired",    v:counts.Hired||0,            g:"linear-gradient(165deg,#0d5a28,#15803d,#0a4020)"},
  ];

  return (
    <div className="dash-layout" style={{display:"flex",height:"100%",background:`${wallpaper} repeat, linear-gradient(160deg,#d8f0e4,#e8f7ee,#f2fbf5)`,backgroundSize:"80px 80px, cover",animation:"bgScroll 22s linear infinite",overflow:"hidden"}}>

      <div className="dash-sidebar" style={{width:300,flexShrink:0,background:"linear-gradient(180deg,rgba(255,255,255,.98),rgba(245,251,248,.98))",borderRight:"1.5px solid #c0e4cc",display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"4px 0 32px rgba(26,61,40,.12)"}}>

        <div style={{background:"linear-gradient(165deg,#0c1f12,#1a3d28,#2d5a3d,#3a6a45)",padding:"20px 18px",flexShrink:0,boxShadow:"0 5px 22px rgba(0,0,0,.3)",position:"relative",overflow:"hidden"}}>
          <CoffeeBG density={0.65}/>
          <div style={{position:"relative",zIndex:2}}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
              <div className="fl" style={{background:"rgba(255,255,255,.16)",borderRadius:14,padding:"8px 10px",border:"1.5px solid rgba(255,255,255,.2)"}}><Logo size={30}/></div>
              <div><div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:"#fff",fontWeight:700}}>Hire4Hope</div><div style={{fontFamily:"'Caveat',cursive",color:"#8ec9a4",fontSize:13,marginTop:1}}>Manager Dashboard</div></div>
            </div>
            <div style={{background:"rgba(255,255,255,.12)",borderRadius:12,padding:"10px 14px",border:"1px solid rgba(255,255,255,.16)",backdropFilter:"blur(6px)"}}>
              <div style={{fontFamily:"'Caveat',cursive",color:"#b8e8c8",fontSize:15,fontWeight:700}}>{greeting}, {managerName}! ☕</div>
              <div style={{color:"rgba(255,255,255,.72)",fontSize:11,marginTop:2}}>{visibleApplicants.length} applicant{visibleApplicants.length!==1?"s":" "}{counts.New?" · "+counts.New+" new":""}</div>
            </div>
          </div>
        </div>

        <div style={{padding:"13px",borderBottom:"1px solid #c8e4d0",flexShrink:0}}>
          <div className="stat-cards" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {cards.map((c,i)=>(
              <div key={c.l} className="fu ch" style={{background:c.g,borderRadius:14,padding:"12px 14px",boxShadow:"0 6px 22px rgba(0,0,0,.22),inset 0 1px 0 rgba(255,255,255,.12)",animationDelay:`${i*55}ms`}}>
                <div style={{color:"#fff",fontSize:28,fontWeight:800,lineHeight:1,textShadow:"0 2px 8px rgba(0,0,0,.28)"}}>{c.v}</div>
                <div style={{color:"rgba(255,255,255,.74)",fontSize:11,marginTop:3,fontWeight:600}}>{c.l}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{padding:"10px 13px 8px",borderBottom:"1px solid #c8e4d0",flexShrink:0}}>
          <input type="text" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name or email…" style={{width:"100%",background:"linear-gradient(135deg,#f0f9f4,#e6f5ec)",border:"1.5px solid #b8ddc8",borderRadius:11,padding:"9px 12px",fontSize:13,color:"#1a2e22",outline:"none"}}/>
        </div>

        <div style={{padding:"8px 13px 8px",borderBottom:"1px solid #c8e4d0",flexShrink:0}}>
          <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
            {["All","New","Interview","Hired","Rejected"].map(s=>(
              <button key={s} type="button" onClick={()=>setFilter(s)} className="apple-btn"
                style={{padding:"4px 11px",borderRadius:20,border:"none",background:filter===s?"linear-gradient(165deg,#2a6040,#1a3d28,#0f2318)":"linear-gradient(135deg,#d8f0e4,#e8f7ee)",color:filter===s?"#fff":"#1a5030",fontSize:11,fontWeight:filter===s?800:500,boxShadow:filter===s?"0 3px 12px rgba(26,61,40,.42)":"0 1px 4px rgba(26,61,40,.1)"}}>
                {s}{s!=="All"&&counts[s]?` (${counts[s]})`:""}</button>
            ))}
          </div>
        </div>

        <div style={{flex:1,overflowY:"auto",padding:"8px 10px 14px"}}>
          {filtered.length===0
            ?<p style={{color:"#5a9e6a",fontSize:13,textAlign:"center",padding:"26px 12px",lineHeight:1.75}}>{visibleApplicants.length===0?"No applications yet.":"No matches."}</p>
            :filtered.map((a,i)=>{const st=stG(a.status);const isActive=sel===a.id;return(
              <button key={a.id} type="button" onClick={()=>setSel(a.id)} className="rh"
                style={{display:"block",width:"100%",textAlign:"left",padding:"12px 13px",borderRadius:14,cursor:"pointer",marginBottom:6,background:isActive?"linear-gradient(135deg,#d4f2e2,#e4f9ec)":"linear-gradient(135deg,rgba(255,255,255,.95),rgba(245,251,248,.95))",border:`1.5px solid ${isActive?"#2d7a4a":"#c8e4d0"}`,boxShadow:isActive?"0 4px 20px rgba(45,122,74,.24)":"0 2px 10px rgba(26,61,40,.07)",animation:`slideL .3s ease ${i*35}ms both`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                  <span style={{color:"#0d3a1e",fontSize:13,fontWeight:700}}>{a.full_name}</span>
                  <span style={{background:sBg(a.risk_score),color:sTxt(a.risk_score),fontSize:11,fontWeight:800,padding:"2px 10px",borderRadius:18,boxShadow:"0 1px 4px rgba(0,0,0,.1)"}}>★ {a.risk_score}</span>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{color:"#5a9e6a",fontSize:11,fontWeight:500}}>{a.position}</span>
                  <span style={{background:st.l,color:st.c,fontSize:10,fontWeight:700,padding:"2px 9px",borderRadius:18,display:"flex",alignItems:"center",gap:3,boxShadow:"0 1px 4px rgba(0,0,0,.08)"}}><span style={{width:4,height:4,borderRadius:"50%",background:st.d,display:"inline-block",boxShadow:`0 0 4px ${st.d}`}}/>{a.status}</span>
                </div>
              </button>
            );})}
        </div>
      </div>

      <div className="dash-detail" style={{flex:1,overflowY:"auto",padding:"28px 30px"}}>
        {!selEntry?(
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",gap:14}}>
            <div style={{color:"#a8d4b8",opacity:.55}} className="fl"><svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg></div>
            <p style={{color:"#5a9e6a",fontSize:14,textAlign:"center",lineHeight:1.85,opacity:.75}}>{visibleApplicants.length===0?"No applications yet.\nUse the Apply tab to submit one.":"Select an applicant to review."}</p>
          </div>
        ):(
          <div key={selEntry.id} style={{background:"rgba(255,255,255,.97)",borderRadius:24,padding:"24px 26px",boxShadow:"0 10px 44px rgba(26,61,40,.14)",animation:"fadeUp .4s ease both"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:16,marginBottom:16}}>
              <div style={{display:"flex",gap:14,alignItems:"flex-start",flex:1}}>
                <div style={{width:54,height:54,borderRadius:"50%",background:"linear-gradient(165deg,#2a6040,#1a3d28,#0f2318)",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:21,fontWeight:800,flexShrink:0,boxShadow:"0 7px 24px rgba(12,30,18,.45)",fontFamily:"'Cormorant Garamond',serif"}}>{selEntry.full_name.charAt(0)}</div>
                <div>
                  <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:27,color:"#0d3a1e",fontWeight:700,margin:"0 0 7px",lineHeight:1.05}}>{selEntry.full_name}</h2>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:5}}>
                    {(()=>{const st=stG(selEntry.status);return<span style={{background:st.g,color:"#fff",fontSize:11,fontWeight:700,padding:"4px 14px",borderRadius:22,display:"flex",alignItems:"center",gap:5,boxShadow:"0 2px 10px rgba(0,0,0,.22)"}}><span style={{width:6,height:6,borderRadius:"50%",background:"rgba(255,255,255,.72)"}}/>{selEntry.status}</span>;})()}
                    <span style={{color:"#1a5030",fontSize:12,fontWeight:600,background:"linear-gradient(135deg,#d4f0de,#e4f7ec)",padding:"3px 12px",borderRadius:18,border:"1px solid #a8d8b8"}}>{selEntry.position}</span>
                  </div>
                  <p style={{color:"#5a9e6a",fontSize:12,margin:"0 0 2px"}}>{selEntry.email} · {selEntry.phone}</p>
                  <p style={{fontFamily:"'Caveat',cursive",color:"#8aab98",fontSize:13}}>Applied {new Date(selEntry.created_at).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}</p>
                </div>
              </div>
              <div style={{textAlign:"center",flexShrink:0}}>
                <div style={{width:80,height:80,borderRadius:"50%",background:`conic-gradient(${selEntry.risk_score>=8?"#16a34a":selEntry.risk_score>=6?"#d97706":selEntry.risk_score>=4?"#ea580c":"#ef4444"} ${selEntry.risk_score*36}deg,#c8e8d4 0deg)`,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:`0 6px 24px ${selEntry.risk_score>=8?"rgba(22,163,74,.4)":selEntry.risk_score>=6?"rgba(217,119,6,.4)":"rgba(234,88,12,.4)"}`}}>
                  <div style={{width:62,height:62,borderRadius:"50%",background:"linear-gradient(135deg,#f2fcf6,#fff)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",boxShadow:"inset 0 2px 6px rgba(0,0,0,.05)"}}>
                    <span style={{color:sTxt(selEntry.risk_score),fontSize:22,fontWeight:800,lineHeight:1}}>{selEntry.risk_score}</span>
                    <span style={{color:"#8aab98",fontSize:9,fontWeight:700}}>/10</span>
                  </div>
                </div>
                <p style={{fontFamily:"'Caveat',cursive",color:"#5a9e6a",fontSize:12,margin:"6px 0 0",fontWeight:700}}>{sLabel(selEntry.risk_score)}</p>
              </div>
            </div>

            <div style={{background:"linear-gradient(135deg,#d4f0de,#e4f7ec,#d8f2e4)",border:"1.5px solid #a8d8b8",borderRadius:16,padding:"16px 20px",marginBottom:14}}>
              <div style={{fontFamily:"'Caveat',cursive",fontSize:14,fontWeight:700,color:"#0d4020",marginBottom:12}}>Weighted Rubric Breakdown</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                {(selEntry.score_breakdown||[]).map(b=>(
                  <div key={b.label} style={{background:"linear-gradient(135deg,#f2fcf6,#e8f7ee)",borderRadius:11,padding:"10px 13px",border:"1px solid #b8ddc8"}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                      <span style={{color:"#0d4020",fontSize:11,fontWeight:700}}>{b.label}</span>
                      <span style={{color:"#1a5030",fontSize:11,fontWeight:700}}>{b.raw}/10 <span style={{color:"#8aab98",fontWeight:400}}>({b.weight}%)</span></span>
                    </div>
                    <div style={{height:5,borderRadius:3,background:"#c0e4cc",overflow:"hidden"}}>
                      <div style={{height:"100%",borderRadius:3,background:`linear-gradient(90deg,${b.raw>=7?"#0d9044,#22c55e":b.raw>=5?"#d97706,#fbbf24":"#ef4444,#fca5a5"})`,width:`${b.raw*10}%`}}/>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
              {[{l:"Availability",v:selEntry.availability,e:"🗓️",g:"linear-gradient(135deg,#e8f0ff,#dbeafe)"},{l:"Experience",v:`${selEntry.experience_years} yr${selEntry.experience_years!==1?"s":""}`,e:"⭐",g:"linear-gradient(135deg,#fffde8,#fef9c3)"}].map(x=>(
                <div key={x.l} className="ch" style={{background:x.g,borderRadius:14,padding:"14px 16px",boxShadow:"0 3px 12px rgba(26,61,40,.08)",border:"1.5px solid rgba(255,255,255,.8)"}}>
                  <div style={{fontFamily:"'Caveat',cursive",fontSize:13,fontWeight:700,color:"#1a5030",marginBottom:7}}>{x.e} {x.l}</div>
                  <div style={{color:"#0d3a1e",fontSize:13,lineHeight:1.65,fontWeight:500}}>{x.v||"—"}</div>
                </div>
              ))}
            </div>

            {selEntry.resume_file_name
              ?<div className="ch" style={{background:"linear-gradient(135deg,#d8f2e8,#c8edd8)",borderRadius:14,padding:"14px 18px",marginBottom:12,border:"1.5px solid #a8ddb8"}}><div style={{fontFamily:"'Caveat',cursive",fontSize:13,fontWeight:700,color:"#1a5030",marginBottom:8}}>📋 Resume</div><div style={{display:"flex",alignItems:"center",gap:10}}><div style={{width:36,height:36,borderRadius:"50%",background:"linear-gradient(135deg,#0d4020,#16a34a)",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 3px 10px rgba(22,163,74,.38)"}}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div><div><p style={{color:"#0d4020",fontSize:13,fontWeight:700,margin:0}}>{selEntry.resume_file_name}</p><p style={{color:"#5a9e6a",fontSize:11,margin:"2px 0 0"}}>File uploaded</p></div></div></div>
              :selEntry.resume_summary?<div className="ch" style={{background:"linear-gradient(135deg,#f5fbf8,#eef7f2)",borderRadius:14,padding:"14px 18px",marginBottom:12,border:"1.5px solid #c0e4cc"}}><div style={{fontFamily:"'Caveat',cursive",fontSize:13,fontWeight:700,color:"#1a5030",marginBottom:8}}>📋 Resume Summary</div><p style={{color:"#0d3a1e",fontSize:13,lineHeight:1.8,margin:0,whiteSpace:"pre-line"}}>{selEntry.resume_summary}</p></div>
              :null
            }

            {[{l:"Background Notes",v:selEntry.background_notes,e:"📝",g:"linear-gradient(135deg,#fff,#fffbf4)"},{l:"Online Presence",v:selEntry.digital_footprint,e:"🔗",g:"linear-gradient(135deg,#fff,#f4f8ff)"}].filter(x=>x.v).map(x=>(
              <div key={x.l} className="ch" style={{background:x.g,borderRadius:14,padding:"14px 18px",marginBottom:12,border:"1.5px solid #c8e4cc"}}>
                <div style={{fontFamily:"'Caveat',cursive",fontSize:13,fontWeight:700,color:"#1a5030",marginBottom:8}}>{x.e} {x.l}</div>
                <p style={{color:"#0d3a1e",fontSize:13,lineHeight:1.8,margin:0,whiteSpace:"pre-line"}}>{x.v}</p>
              </div>
            ))}

            <div style={{background:"linear-gradient(135deg,#f2fbf6,#e8f7ee)",borderRadius:18,padding:"18px 22px",marginTop:4,boxShadow:"0 5px 22px rgba(26,61,40,.1)",border:"1.5px solid #c0e4cc"}}>
              <div style={{fontFamily:"'Caveat',cursive",fontSize:14,fontWeight:700,color:"#1a5030",marginBottom:14}}>Update Status</div>
              <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:16}}>
                {[{l:"Move to Interview",s:"Interview",g:"linear-gradient(165deg,#9a4010,#b45309,#7a3208)",sh:"rgba(180,83,9,.45)"},{l:"Mark as Hired",s:"Hired",g:"linear-gradient(165deg,#0d5a28,#15803d,#0a4020)",sh:"rgba(21,128,61,.45)"},{l:"Reject",s:"Rejected",g:"linear-gradient(165deg,#8a1a1a,#b91c1c,#7a1010)",sh:"rgba(185,28,28,.45)"},{l:"Reset to New",s:"New",g:"linear-gradient(165deg,#1a3a8a,#1d4ed8,#1228a0)",sh:"rgba(29,78,216,.45)"}].map(b=>{
                  const act=selEntry.status===b.s;
                  return<button key={b.s} type="button" onClick={()=>onStatusChange(selEntry.id,b.s)} disabled={act} className="apple-btn" style={{padding:"10px 18px",borderRadius:13,border:"none",background:act?"linear-gradient(135deg,#c8ddd0,#d8e8dc)":b.g,color:act?"#6b9e7e":"#fff",fontSize:13,fontWeight:700,cursor:act?"default":"pointer",boxShadow:act?"none":`0 4px 18px ${b.sh},0 2px 6px rgba(0,0,0,.14)`}}>{act?"✓ ":""}{b.l}</button>;
                })}
              </div>
              <div style={{borderTop:"1px solid #c0e4cc",paddingTop:14}}>
                {!confirmDelete
                  ?<button type="button" onClick={()=>setConfirmDelete(true)} className="bh"
                    style={{padding:"8px 16px",borderRadius:11,border:"1.5px solid #fca5a5",background:"linear-gradient(135deg,#fff5f5,#fff0f0)",color:"#991b1b",fontSize:12,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                    Delete from Manager View
                  </button>
                  :<div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                    <p style={{color:"#7f1d1d",fontSize:12,fontWeight:600,margin:0}}>Delete this record from your view? Applicant can still see their status.</p>
                    <div style={{display:"flex",gap:8}}>
                      <button type="button" onClick={()=>{onDelete(selEntry.id);setSel(null);setConfirmDelete(false);}} className="apple-btn" style={{padding:"7px 14px",borderRadius:10,border:"none",background:"linear-gradient(165deg,#8a1a1a,#b91c1c)",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",boxShadow:"0 3px 12px rgba(185,28,28,.4)"}}>Yes, Delete</button>
                      <button type="button" onClick={()=>setConfirmDelete(false)} className="bh" style={{padding:"7px 14px",borderRadius:10,border:"1px solid #c0e4cc",background:"transparent",color:"#5a9e6a",fontSize:12,fontWeight:600,cursor:"pointer"}}>Cancel</button>
                    </div>
                  </div>
                }
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ══ Root ════════════════════════════════════════════════════════════════════ */
export default function App() {
  const [page,setPage]=useState("apply");
  const [applicants,setApplicants]=useState([]);
  const [loaded,setLoaded]=useState(false);
  const [managerEmail,setManagerEmail]=useState(null);

  // ── Real-time listener from Firestore ──
  useEffect(()=>{
    const q = query(collection(db,"applicants"), orderBy("created_at","desc"));
    const unsub = onSnapshot(q, (snap)=>{
      const data = snap.docs.map(d=>({id:d.id,...d.data()}));
      setApplicants(data);
      setLoaded(true);
    }, (err)=>{
      console.error("Firestore error:", err);
      setLoaded(true);
    });
    return ()=>unsub();
  },[]);

  // ── Add applicant to Firestore ──
  const addApplicant = useCallback(async (entry) => {
    await addDoc(collection(db,"applicants"), entry);
  },[]);

  // ── Update status in Firestore ──
  const changeSt = useCallback(async (id,ns) => {
    await updateDoc(doc(db,"applicants",id), {status:ns});
  },[]);

  // ── Soft-delete in Firestore ──
  const deleteApplicant = useCallback(async (id) => {
    await updateDoc(doc(db,"applicants",id), {deleted_by_manager:true});
  },[]);

  if(!loaded){
    return(
      <div style={{height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"linear-gradient(160deg,#d8f0e4,#eaf7ee)"}}>
        <style>{CSS}</style>
        <div style={{textAlign:"center",display:"flex",flexDirection:"column",alignItems:"center",gap:16}}>
          <div className="fl"><Logo size={52}/></div>
          <p style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:"#1a4028"}}>Loading Hire4Hope…</p>
        </div>
      </div>
    );
  }

  const navItems=[
    {id:"apply", l:"Apply",     ic:<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-2"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>},
    {id:"status",l:"My Status", ic:<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>},
  ];

  return (
    <div style={{height:"100vh",display:"flex",flexDirection:"column"}}>
      <style>{CSS}</style>
      <div className="nav-bar" style={{flexShrink:0,background:"linear-gradient(135deg,#fff,#f0fbf4)",borderBottom:"1.5px solid #b8ddc8",padding:"0 20px",display:"flex",alignItems:"center",height:56,gap:4,boxShadow:"0 4px 24px rgba(26,61,40,.12)"}}>
        <button type="button" onClick={()=>setPage("apply")} className="bh" style={{display:"flex",alignItems:"center",gap:9,marginRight:14,background:"none",border:"none",padding:"4px 8px",borderRadius:11,cursor:"pointer"}}>
          <div className="fl"><Logo size={30}/></div>
          <div>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:16,fontWeight:700,lineHeight:1}} className="gt">Hire4Hope</div>
            <div style={{fontFamily:"'Caveat',cursive",color:"#5a9e6a",fontSize:10,lineHeight:1,marginTop:1}}>by Hope Coffee Melissa</div>
          </div>
        </button>
        <div style={{width:1,height:22,background:"linear-gradient(180deg,transparent,#a8d8b8,transparent)",marginRight:8}}/>
        {navItems.map(p=>(
          <button key={p.id} type="button" onClick={()=>setPage(p.id)} className="bh"
            style={{display:"flex",alignItems:"center",gap:6,padding:"6px 14px",borderRadius:11,border:"none",background:page===p.id?"linear-gradient(135deg,#d4f0de,#e4f9ec)":"transparent",color:page===p.id?"#0d4020":"#5a9e6a",fontSize:13,fontWeight:page===p.id?700:500,cursor:"pointer",boxShadow:page===p.id?"0 2px 12px rgba(26,61,40,.2)":"none",borderBottom:`2.5px solid ${page===p.id?"#2d7a4a":"transparent"}`}}>
            {p.ic}<span className="nav-label">{p.l}</span>
          </button>
        ))}
        <button type="button" onClick={()=>setPage("manager")} className="bh"
          style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:4,padding:"5px 9px",borderRadius:9,border:`1px solid ${page==="manager"?"#2d7a4a":"rgba(168,216,184,.5)"}`,background:page==="manager"?"linear-gradient(135deg,#d4f0de,#e4f9ec)":"transparent",color:page==="manager"?"#0d4020":"rgba(90,158,106,.4)",fontSize:11,fontWeight:500,cursor:"pointer"}}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          {page==="manager"&&managerEmail&&<span className="nav-label" style={{fontSize:11}}>Dashboard</span>}
        </button>
        {applicants.filter(a=>!a.deleted_by_manager).length>0&&(
          <span style={{background:"linear-gradient(165deg,#2a6040,#1a3d28,#0f2318)",color:"#fff",fontSize:11,padding:"3px 12px",borderRadius:22,fontWeight:700,boxShadow:"0 3px 14px rgba(26,61,40,.4)",marginLeft:8,whiteSpace:"nowrap"}}>
            {applicants.filter(a=>!a.deleted_by_manager).length} applicant{applicants.filter(a=>!a.deleted_by_manager).length!==1?"s":""}
          </span>
        )}
      </div>

      <div style={{flex:1,overflow:page==="manager"?"hidden":"auto"}}>
        {page==="apply"   && <ApplyPage onSubmit={addApplicant}/>}
        {page==="status"  && <StatusPage applicants={applicants.filter(a=>!a.deleted_by_manager)}/>}
        {page==="manager" && (
          managerEmail
            ?<ManagerDashboard applicants={applicants} onStatusChange={changeSt} onDelete={deleteApplicant} managerEmail={managerEmail}/>
            :<ManagerAuthGate onAuth={email=>{setManagerEmail(email);}}/>
        )}
      </div>
    </div>
  );
}
