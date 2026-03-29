import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { db } from "./firebase";
import {
  collection, onSnapshot, addDoc, updateDoc,
  doc, query, orderBy,
} from "firebase/firestore";
import emailjs from "@emailjs/browser";

/* ══ EmailJS config ════════════════════════════════════════════════════════ */
const EJS_SVC     = import.meta.env.VITE_EMAILJS_SERVICE_ID       || "";
const EJS_TVERIFY = import.meta.env.VITE_EMAILJS_TEMPLATE_VERIFY  || "";
const EJS_TSTATUS = import.meta.env.VITE_EMAILJS_TEMPLATE_STATUS  || "";
const EJS_KEY     = import.meta.env.VITE_EMAILJS_PUBLIC_KEY       || "";

/* ══ Admin whitelist ════════════════════════════════════════════════════════ */
const ADMIN_EMAILS = new Set(
  (import.meta.env.VITE_ADMIN_EMAILS || "melissa@hopecoffee.com")
    .split(",").map(e => e.trim().toLowerCase())
);

/* ══ Security helpers ═══════════════════════════════════════════════════════ */
const sanitize = (s, max = 500) =>
  typeof s !== "string" ? "" :
  s.slice(0, max)
    .replace(/[<>]/g, c => c === "<" ? "＜" : "＞")
    .replace(/javascript:/gi, "")
    .replace(/on\w+\s*=/gi, "")
    .trim();
const clampNum = (v, lo = 0, hi = 60) => {
  const n = parseInt(v, 10); return isNaN(n) ? lo : Math.min(hi, Math.max(lo, n));
};
const genCode = () => String(Math.floor(100000 + Math.random() * 900000));

/* ══ EmailJS helpers ════════════════════════════════════════════════════════ */
async function sendVerificationEmail(toEmail, toName, code) {
  if (!EJS_SVC || !EJS_TVERIFY || !EJS_KEY) return false;
  try {
    await emailjs.send(EJS_SVC, EJS_TVERIFY, {
      to_email: toEmail,
      to_name: toName || "Applicant",
      verification_code: code,
    }, EJS_KEY);
    return true;
  } catch(e) { console.error("EmailJS verify error:", e); return false; }
}

async function sendStatusEmail(applicant, newStatus) {
  if (!EJS_SVC || !EJS_TSTATUS || !EJS_KEY) return;
  const messages = {
    Interview: `Great news! Your application for the ${applicant.position} position at Hope Coffee Melissa has been reviewed and we'd love to set up an interview. Please watch your email and phone for next steps from our team. We look forward to meeting you! ☕`,
    Hired:     `Congratulations! We are thrilled to welcome you to the Hope Coffee Melissa family. You have been selected for the ${applicant.position} position. Please watch your email for onboarding details. We can't wait to have you on the team! ☕`,
    Rejected:  `Thank you so much for your interest in joining Hope Coffee Melissa and for taking the time to apply for the ${applicant.position} position. After careful consideration, we have decided to move forward with other candidates at this time. We truly appreciate your interest and encourage you to apply again in the future. God bless! ☕`,
  };
  if (!messages[newStatus]) return;
  try {
    await emailjs.send(EJS_SVC, EJS_TSTATUS, {
      to_email: applicant.email,
      to_name: applicant.full_name.split(" ")[0],
      full_name: applicant.full_name,
      position: applicant.position,
      new_status: newStatus,
      status_message: messages[newStatus],
    }, EJS_KEY);
  } catch(e) { console.error("EmailJS status error:", e); }
}

/* ══ Brew Knowledge Base ════════════════════════════════════════════════════ */
const BREW_KB = [
  {q:/how.*(apply|submit|application)/i,a:"Head to the **Apply** tab at the top! Fill out the form with your contact info, the position you want, your availability, and a quick resume summary. Hit Submit and you're done. ☕"},
  {q:/position|job|role|open/i,a:"We're hiring for **Barista** and **Shift Lead** roles. Baristas craft the drinks and connect with guests. Shift Leads run shifts and support the team. Both are full or part-time!"},
  {q:/pay|wage|salary|money|hourly/i,a:"Barista pay is **$11–$13 per hour** based on experience. For Shift Lead specifics, reach out to melissa@hopecoffee.com!"},
  {q:/status.*mean|what.*new|what.*interview|what.*hired|what.*reject/i,a:"**New** = received and in queue. **Interview** = you stood out, we want to meet! **Hired** = offer extended, check your email. **Rejected** = not this time, but please apply again!"},
  {q:/how long|when.*hear|timeline|response/i,a:"We review on a rolling basis. Most applicants hear back within 1–2 weeks. You'll get an email automatically when your status changes!"},
  {q:/hours|shift|schedule|part.time|full.time/i,a:"We're open **Monday–Saturday, 6 AM–6 PM**. Barista roles are 10–36 hrs/week. We offer flexible scheduling!"},
  {q:/address|location|where|find/i,a:"We're at **2907 McKinney Street, STE 100, Melissa, TX 75454**. Come say hi!"},
  {q:/phone|call|contact|email/i,a:"Call us at **(469) 518-1994** or email **melissa@hopecoffee.com**. We'd love to chat!"},
  {q:/experience|years|no experience|beginner/i,a:"No experience? No problem! We value a servant heart and willingness to learn. Your attitude matters just as much as your resume. Apply anyway!"},
  {q:/hope coffee|about|mission/i,a:"Hope Coffee exists to bring value and purpose through every cup — serving the community with hospitality, excellence, and intentionality. We're faith-driven and community-rooted. ☕"},
  {q:/hello|hi|hey|howdy/i,a:"Hey! ☕ I'm Brew, the Hire4Hope assistant. Ask me anything about applying, the positions, or the process!"},
  {q:/thank|thanks/i,a:"Of course! That's what I'm here for. ☕"},
];
function brewAnswer(t){for(const e of BREW_KB){if(e.q.test(t.trim()))return e.a;}return null;}

/* ══ Color helpers ══════════════════════════════════════════════════════════ */
const stG = st=>({
  New:      {g:"linear-gradient(135deg,#1d4ed8,#3b82f6)",l:"linear-gradient(135deg,#dbeafe,#eff6ff)",c:"#1e3a8a",d:"#3b82f6"},
  Interview:{g:"linear-gradient(135deg,#b45309,#d97706)",l:"linear-gradient(135deg,#fde68a,#fef9c3)",c:"#713f12",d:"#ca8a04"},
  Hired:    {g:"linear-gradient(135deg,#14532d,#16a34a)",l:"linear-gradient(135deg,#bbf7d0,#dcfce7)",c:"#14532d",d:"#16a34a"},
  Rejected: {g:"linear-gradient(135deg,#991b1b,#ef4444)",l:"linear-gradient(135deg,#fecdd3,#fee2e2)",c:"#7f1d1d",d:"#ef4444"},
}[st]||{g:"linear-gradient(135deg,#475569,#94a3b8)",l:"linear-gradient(135deg,#e2e8f0,#f1f5f9)",c:"#475569",d:"#94a3b8"});

/* ══ CSS ════════════════════════════════════════════════════════════════════ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=Outfit:wght@300;400;500;600;700;800&family=Caveat:wght@600;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body,input,textarea,select,button{font-family:'Outfit',sans-serif}
@keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes scaleIn{from{opacity:0;transform:scale(.91)}to{opacity:1;transform:scale(1)}}
@keyframes floatY{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes pring{0%{box-shadow:0 0 0 0 rgba(74,124,89,.55)}70%{box-shadow:0 0 0 22px rgba(74,124,89,0)}100%{box-shadow:0 0 0 0 rgba(74,124,89,0)}}
@keyframes popIn{0%{transform:scale(.4);opacity:0}60%{transform:scale(1.1)}100%{transform:scale(1);opacity:1}}
@keyframes slideL{from{opacity:0;transform:translateX(-12px)}to{opacity:1;transform:translateX(0)}}
@keyframes chatPop{from{opacity:0;transform:scale(.84) translateY(14px)}to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes msgIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
@keyframes dot{0%,80%,100%{transform:scale(.4);opacity:.35}40%{transform:scale(1);opacity:1}}
@keyframes chkDraw{from{stroke-dashoffset:50}to{stroke-dashoffset:0}}
@keyframes wiggle{0%,100%{transform:rotate(0)}25%{transform:rotate(-9deg)}75%{transform:rotate(9deg)}}
@keyframes ovIn{from{opacity:0}to{opacity:1}}
@keyframes txtUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
@keyframes gshift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
@keyframes steam{0%{transform:translateY(0) scaleX(1);opacity:.8}50%{transform:translateY(-22px) scaleX(1.4);opacity:.4}100%{transform:translateY(-42px) scaleX(.7);opacity:0}}
@keyframes bf1{0%,100%{transform:translate(0,0) rotate(0)}33%{transform:translate(9px,-18px) rotate(30deg)}66%{transform:translate(-6px,-10px) rotate(-20deg)}}
@keyframes bf2{0%,100%{transform:translate(0,0) rotate(0)}40%{transform:translate(-12px,-22px) rotate(-34deg)}80%{transform:translate(8px,-12px) rotate(24deg)}}
@keyframes bf3{0%,100%{transform:translate(0,0) rotate(0)}25%{transform:translate(14px,-14px) rotate(44deg)}75%{transform:translate(-10px,-24px) rotate(-30deg)}}
@keyframes bgScroll{from{background-position:0 0}to{background-position:80px 80px}}
@keyframes tiltF{0%,100%{transform:rotate(-4deg) translateY(0)}50%{transform:rotate(4deg) translateY(-12px)}}
@keyframes dropF{0%{transform:translateY(-5px);opacity:0}15%{opacity:.8}100%{transform:translateY(70px);opacity:0}}
@keyframes statusPulse{0%,100%{opacity:1}50%{opacity:.55}}
@keyframes cfetti{0%{transform:translateY(-10px) rotate(0);opacity:1}100%{transform:translateY(115vh) rotate(720deg);opacity:0}}
@keyframes cfettiW{0%{transform:translateY(-10px) rotate(0) scaleX(1);opacity:1}30%{transform:translateY(30vh) rotate(180deg) scaleX(.8)}60%{transform:translateY(65vh) rotate(360deg) scaleX(1.1)}100%{transform:translateY(115vh) rotate(720deg) scaleX(.9);opacity:0}}
@keyframes sparkle{0%,100%{opacity:0;transform:scale(0)}50%{opacity:1;transform:scale(1)}}
.apple-btn{position:relative;overflow:hidden;cursor:pointer;border:none;outline:none;transition:transform .16s cubic-bezier(.34,1.56,.64,1),box-shadow .16s,filter .16s}
.apple-btn::before{content:'';position:absolute;top:0;left:0;right:0;height:52%;background:linear-gradient(180deg,rgba(255,255,255,.32) 0%,rgba(255,255,255,.08) 100%);border-radius:inherit;pointer-events:none;z-index:1}
.apple-btn::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.15),transparent);left:-80%;width:60%;transition:left .45s ease;pointer-events:none;z-index:2}
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
  .nav-label{display:none}
  .nav-bar{padding:0 12px!important;gap:2px!important}
  .stat-cards{grid-template-columns:1fr 1fr!important}
}
@media(max-width:480px){.hero-h1{font-size:26px!important}.dash-detail{padding:12px 10px!important}}
`;

const wallpaperSVG = encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><g fill='none' stroke='rgba(74,124,89,0.1)' stroke-width='1.3' stroke-linecap='round'><path d='M16 42 L20 62 H36 L40 42 Z'/><path d='M16 42 H40'/><path d='M40 50 Q49 50 49 56 Q49 62 40 62' stroke-width='1.5'/><path d='M24 37 Q22 32 24 27'/><path d='M32 37 Q30 32 32 27'/><ellipse cx='62' cy='22' rx='8' ry='12' transform='rotate(-18 62 22)'/><path d='M56 14 Q62 22 58 30'/></g></svg>`);
const wallpaper = `url("data:image/svg+xml,${wallpaperSVG}")`;

/* ══ CoffeeBG ═══════════════════════════════════════════════════════════════ */
function CoffeeBG({density=1}){
  const items=useMemo(()=>{
    const anims=["bf1","bf2","bf3"];
    const beans=Array.from({length:Math.round(10*density)},(_,i)=>({type:"bean",top:`${5+(i*9.1)%90}%`,left:`${3+(i*11.3)%93}%`,size:12+(i%5)*4,anim:`${anims[i%3]} ${7+i%5}s ease-in-out infinite`,delay:`${(i*.65)%4}s`,op:0.22+(i%4)*.04}));
    const cups=Array.from({length:Math.round(5*density)},(_,i)=>({type:"cup",top:`${8+(i*19)}%`,left:`${4+(i*21)}%`,size:36+(i%3)*14,delay:`${i*.85}s`,op:0.18+(i%3)*.03,anim:i%2===0?"tiltF 9s ease-in-out infinite":"tiltF 11s ease-in-out infinite reverse"}));
    const drops=Array.from({length:Math.round(7*density)},(_,i)=>({type:"drop",left:`${(i*14+5)%95}%`,size:3+(i%3),delay:`${(i*.55)%3}s`,dur:`${2.2+(i%3)}s`,op:0.20}));
    return[...beans,...cups,...drops];
  },[density]);
  return(
    <div style={{position:"absolute",inset:0,overflow:"hidden",pointerEvents:"none"}}>
      {items.map((item,i)=>{
        if(item.type==="bean")return(<svg key={i} width={item.size} height={item.size*1.45} viewBox="0 0 22 32" fill="none" style={{position:"absolute",top:item.top,left:item.left,opacity:item.op,animation:`${item.anim} ${item.delay} both`}}><ellipse cx="11" cy="16" rx="9.5" ry="14" fill="rgba(255,255,255,.92)" stroke="rgba(200,230,210,.4)" strokeWidth=".5"/><path d="M11 4 Q17 12 11 22 Q5 12 11 4Z" fill="rgba(20,50,30,.55)"/></svg>);
        if(item.type==="cup")return(<div key={i} style={{position:"absolute",top:item.top,left:item.left,opacity:item.op,animation:item.anim}}><svg width={item.size} height={item.size*1.45} viewBox="0 0 60 87" fill="none"><path d="M22 20 Q18 10 22 3" stroke="rgba(255,255,255,.9)" strokeWidth="2.5" fill="none" strokeLinecap="round" style={{animation:`steam 2.6s ease-in-out infinite ${item.delay}`}}/><path d="M30 22 Q26 11 30 4" stroke="rgba(255,255,255,.85)" strokeWidth="2" fill="none" strokeLinecap="round" style={{animation:`steam 2.6s ease-in-out infinite ${parseFloat(item.delay)+.45}s`}}/><path d="M38 20 Q34 10 38 3" stroke="rgba(255,255,255,.9)" strokeWidth="2.5" fill="none" strokeLinecap="round" style={{animation:`steam 2.6s ease-in-out infinite ${parseFloat(item.delay)+.9}s`}}/><ellipse cx="30" cy="80" rx="26" ry="5" fill="rgba(255,255,255,.22)" stroke="rgba(255,255,255,.35)" strokeWidth="1"/><path d="M8 28 L14 72 H46 L52 28 Z" fill="rgba(255,255,255,.25)" stroke="rgba(255,255,255,.55)" strokeWidth="1.8"/><path d="M8 28 H52" stroke="rgba(255,255,255,.7)" strokeWidth="2.5" strokeLinecap="round"/><path d="M52 36 Q66 36 66 48 Q66 60 52 60" stroke="rgba(255,255,255,.55)" strokeWidth="3" fill="none" strokeLinecap="round"/></svg></div>);
        if(item.type==="drop")return(<div key={i} style={{position:"absolute",top:"-3%",left:item.left,width:item.size,height:item.size*1.6,borderRadius:"50% 50% 50% 50%/60% 60% 40% 40%",background:"rgba(255,255,255,.25)",animation:`dropF ${item.dur} ${item.delay} ease-in infinite`,opacity:item.op}}/>);
        return null;
      })}
      {[{t:"33%",l:"17%",d:"0s"},{t:"67%",l:"60%",d:"1.1s"},{t:"14%",l:"71%",d:"2.3s"}].map((s,i)=>(<div key={`sp${i}`} style={{position:"absolute",top:s.t,left:s.l,width:5,height:5,borderRadius:"50%",background:"rgba(255,255,255,.7)",animation:`sparkle 3s ease-in-out infinite ${s.d}`}}/>))}
    </div>
  );
}

const Logo=({size=48})=>(<svg width={size} height={size} viewBox="0 0 120 100" fill="none"><defs><linearGradient id="lg1" x1="20" y1="20" x2="90" y2="90" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#7abf8a"/><stop offset="100%" stopColor="#3a6648"/></linearGradient><linearGradient id="lg2" x1="70" y1="15" x2="110" y2="70" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#8fcf9f"/><stop offset="100%" stopColor="#4a7c59"/></linearGradient></defs><ellipse cx="52" cy="58" rx="36" ry="46" fill="url(#lg1)" transform="rotate(-18 52 58)"/><path d="M28 28 Q52 58 32 88" stroke="#0f2318" strokeWidth="4.5" fill="none" strokeLinecap="round"/><ellipse cx="86" cy="42" rx="22" ry="32" fill="url(#lg2)" transform="rotate(14 86 42)"/><path d="M72 22 Q86 42 74 64" stroke="#0f2318" strokeWidth="3.5" fill="none" strokeLinecap="round"/></svg>);

/* ══ Confetti ═══════════════════════════════════════════════════════════════ */
function Confetti(){
  const pieces=useMemo(()=>{
    const cols=["#4ade80","#22c55e","#86efac","#fbbf24","#f97316","#34d399","#fde68a","#fb7185","#60a5fa"];
    const shapes=["●","■","▲","◆","✦","★","▬"];
    return Array.from({length:55},(_,i)=>({id:i,color:cols[i%cols.length],shape:shapes[i%shapes.length],left:`${(i*1.9)%100}%`,size:`${8+(i%9)}px`,delay:`${(i*.028)%1.6}s`,dur:`${2.6+(i%8)*.25}s`,drift:i%2===0?"cfettiW":"cfetti",rotate:`${(i*47)%360}deg`}));
  },[]);
  return(<div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:9999,overflow:"hidden"}}>{pieces.map(p=>(<div key={p.id} style={{position:"absolute",top:0,left:p.left,color:p.color,fontSize:p.size,animation:`${p.drift} ${p.dur} ${p.delay} ease-in both`,transform:`rotate(${p.rotate})`}}>{p.shape}</div>))}</div>);
}

function SuccessOverlay({name,onDone}){
  useEffect(()=>{const t=setTimeout(onDone,5000);return()=>clearTimeout(t);},[onDone]);
  const first=name?name.split(" ")[0]:"";
  return(<><Confetti/><div onClick={onDone} style={{position:"fixed",inset:0,zIndex:9998,background:"linear-gradient(135deg,rgba(5,18,10,.96),rgba(15,45,25,.93))",display:"flex",alignItems:"center",justifyContent:"center",animation:"ovIn .38s ease both",cursor:"pointer"}}><div style={{textAlign:"center",padding:"0 32px",maxWidth:540}}><div className="fl" style={{width:108,height:108,borderRadius:"50%",background:"linear-gradient(135deg,#0d4020,#14532d,#16a34a,#4ade80)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 28px",animation:"popIn .7s cubic-bezier(.34,1.56,.64,1) both,pring 2.4s ease-out .9s",boxShadow:"0 0 0 20px rgba(74,222,128,.1),0 18px 56px rgba(22,163,74,.65)"}}><svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{strokeDasharray:50,animation:"chkDraw .55s ease .7s both"}}><polyline points="20 6 9 17 4 12"/></svg></div><h1 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:46,color:"#fff",fontWeight:700,lineHeight:1.1,marginBottom:14,animation:"txtUp .5s ease .44s both"}}>{first?`You're in, ${first}!`:"Application Submitted!"}</h1><p style={{color:"#a8d5b5",fontSize:17,lineHeight:1.85,marginBottom:28,animation:"txtUp .5s ease .58s both",fontWeight:300}}>We've received your application and will review it carefully. You'll get an email if your status changes. Use "My Status" to track anytime. ☕</p><p style={{color:"rgba(255,255,255,.3)",fontSize:11,marginTop:28,animation:"txtUp .5s ease .9s both"}}>Tap anywhere to close</p></div></div></>);
}

/* ══ Chatbot ════════════════════════════════════════════════════════════════ */
function Chatbot({context="apply"}){
  const initMsg=context==="status"?"Hi! ☕ I'm Brew, your Hope Coffee assistant. I can explain your status or anything about the process.":"Hey! ☕ I'm Brew. Ask me anything about applying to Hope Coffee or our positions.";
  const[open,setOpen]=useState(false);
  const[msgs,setMsgs]=useState([{role:"assistant",text:initMsg}]);
  const[input,setInput]=useState("");
  const[loading,setLoading]=useState(false);
  const[wig,setWig]=useState(false);
  const endRef=useRef(null);
  useEffect(()=>{endRef.current?.scrollIntoView({behavior:"smooth"});},[msgs,loading]);
  useEffect(()=>{if(!open){const t=setInterval(()=>{setWig(true);setTimeout(()=>setWig(false),700)},5500);return()=>clearInterval(t);}},[open]);
  async function send(){
    const text=sanitize(input,800).trim();if(!text||loading)return;
    setInput("");
    const history=[...msgs,{role:"user",text}];
    setMsgs(history);setLoading(true);
    const kb=brewAnswer(text);
    if(kb){setTimeout(()=>{setMsgs(p=>[...p,{role:"assistant",text:kb}]);setLoading(false);},400);return;}
    try{
      const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:350,system:`You are Brew, a warm AI assistant for Hire4Hope — Hope Coffee Melissa TX (2907 McKinney St, (469)518-1994, melissa@hopecoffee.com, Mon-Sat 6AM-6PM). Barista $11-13/hr, 10-36hrs/wk, must be 18+. Be brief (2-3 sentences), warm, faith-aligned. If unsure, say so.`,messages:history.map(m=>({role:m.role,content:m.text}))})});
      if(!res.ok)throw new Error();
      const data=await res.json();
      const reply=data?.content?.find(b=>b.type==="text")?.text;
      if(!reply)throw new Error();
      setMsgs(p=>[...p,{role:"assistant",text:sanitize(reply,1200)}]);
    }catch{setMsgs(p=>[...p,{role:"assistant",text:"I'm not sure about that one, but I'm happy to help with applying, positions, or your status! ☕"}]);}
    setLoading(false);
  }
  return(
    <>
      <div style={{position:"fixed",bottom:24,right:24,zIndex:1000,width:62,height:62}}>
        <button type="button" onClick={()=>setOpen(o=>!o)} className="apple-btn" style={{width:62,height:62,borderRadius:"50%",background:"linear-gradient(165deg,#2d6645 0%,#1a3d28 40%,#0f2318 100%)",boxShadow:"0 6px 28px rgba(15,35,24,.6)",display:"flex",alignItems:"center",justifyContent:"center",animation:wig&&!open?"wiggle .55s ease":"none"}}>
          {open?<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>:<Logo size={30}/>}
        </button>
        {!open&&<div style={{position:"absolute",top:0,right:0,width:20,height:20,borderRadius:"50%",background:"linear-gradient(135deg,#16a34a,#22c55e)",border:"2.5px solid #fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"#fff",fontWeight:800,pointerEvents:"none"}}>AI</div>}
      </div>
      {open&&(
        <div style={{position:"fixed",bottom:100,right:24,zIndex:999,width:"min(360px,calc(100vw - 32px))",maxHeight:520,background:"linear-gradient(160deg,#fff,#f5fbf7)",borderRadius:22,overflow:"hidden",boxShadow:"0 24px 64px rgba(15,35,24,.32)",display:"flex",flexDirection:"column",animation:"chatPop .36s cubic-bezier(.34,1.56,.64,1) both"}}>
          <div style={{background:"linear-gradient(135deg,#0c1f12,#1a3d28,#2d5a3d,#4a7c59)",padding:"15px 18px",display:"flex",alignItems:"center",gap:12}}>
            <div className="fl" style={{width:40,height:40,borderRadius:"50%",flexShrink:0,background:"rgba(255,255,255,.14)",border:"1.5px solid rgba(255,255,255,.22)",display:"flex",alignItems:"center",justifyContent:"center"}}><Logo size={24}/></div>
            <div><div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:"#fff",fontWeight:700}}>Brew</div><div style={{color:"#a8d5b5",fontSize:11,display:"flex",alignItems:"center",gap:5,marginTop:2}}><span style={{width:6,height:6,borderRadius:"50%",background:"#4ade80",boxShadow:"0 0 6px #4ade80",display:"inline-block"}}/>AI · Hope Coffee</div></div>
          </div>
          <div style={{flex:1,overflowY:"auto",padding:"14px 13px 8px",display:"flex",flexDirection:"column",gap:11,minHeight:0}}>
            {msgs.map((m,i)=>(<div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start",animation:"msgIn .26s ease both"}}>{m.role==="assistant"&&<div style={{width:27,height:27,borderRadius:"50%",background:"linear-gradient(135deg,#1a3d28,#4a7c59)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginRight:8,marginTop:2}}><Logo size={15}/></div>}<div style={{maxWidth:"78%",padding:"10px 13px",borderRadius:m.role==="user"?"18px 18px 4px 18px":"18px 18px 18px 4px",background:m.role==="user"?"linear-gradient(135deg,#1a3d28,#2d5a3d,#4a7c59)":"linear-gradient(135deg,#f0faf3,#e6f5ea)",color:m.role==="user"?"#fff":"#1a2e22",fontSize:13,lineHeight:1.68}}>{m.text.split(/(\*\*[^*]+\*\*)/).map((p,j)=>p.startsWith("**")&&p.endsWith("**")?<strong key={j}>{p.slice(2,-2)}</strong>:<React.Fragment key={j}>{p}</React.Fragment>)}</div></div>))}
            {loading&&<div style={{display:"flex",gap:8}}><div style={{width:27,height:27,borderRadius:"50%",background:"linear-gradient(135deg,#1a3d28,#4a7c59)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Logo size={15}/></div><div style={{background:"linear-gradient(135deg,#f0faf3,#e6f5ea)",borderRadius:"18px 18px 18px 4px",padding:"11px 15px",display:"flex",gap:5,alignItems:"center"}}>{[0,1,2].map(d=><span key={d} style={{width:7,height:7,borderRadius:"50%",background:"#4a7c59",display:"inline-block",animation:`dot 1.2s ease ${d*.22}s infinite`}}/>)}</div></div>}
            <div ref={endRef}/>
          </div>
          {msgs.length<=1&&(<div style={{padding:"0 13px 10px",display:"flex",gap:6,flexWrap:"wrap"}}>{(context==="status"?["What does my status mean?","When will I hear back?"]:["How do I apply?","What positions are open?","What's the pay?"]).map(q=>(<button key={q} type="button" onClick={()=>setInput(q)} className="bh" style={{padding:"5px 11px",borderRadius:18,border:"1px solid #b8e6c8",background:"linear-gradient(135deg,#eaf7ee,#d8f0e2)",color:"#1a4028",fontSize:11,fontWeight:600,cursor:"pointer"}}>{q}</button>))}</div>)}
          <div style={{padding:"9px 13px 13px",borderTop:"1px solid #d8ece0",background:"linear-gradient(135deg,#f6fcf8,#fff)"}}>
            <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
              <textarea value={input} onChange={e=>setInput(e.target.value.slice(0,800))} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}} placeholder="Ask Brew anything…" rows={1} style={{flex:1,resize:"none",border:"1.5px solid #c0ddc8",borderRadius:12,padding:"9px 12px",fontSize:13,color:"#1a2e22",outline:"none",background:"#fff",maxHeight:90,overflowY:"auto"}}/>
              <button type="button" onClick={send} disabled={!input.trim()||loading} className="apple-btn" style={{width:38,height:38,borderRadius:"50%",border:"none",flexShrink:0,background:input.trim()&&!loading?"linear-gradient(135deg,#1a3d28,#4a7c59)":"linear-gradient(135deg,#c8ddd0,#d8e8dc)",display:"flex",alignItems:"center",justifyContent:"center",cursor:input.trim()&&!loading?"pointer":"not-allowed"}}>
                {loading?<div style={{width:14,height:14,borderRadius:"50%",border:"2px solid rgba(255,255,255,.35)",borderTopColor:"#fff",animation:"spin .7s linear infinite"}}/>:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ══ Form helpers ═══════════════════════════════════════════════════════════ */
const FL=({text,optional})=>(<div style={{color:"#14402a",fontSize:12,fontWeight:700,marginBottom:7,letterSpacing:".04em",textTransform:"uppercase"}}>{text}{optional&&<span style={{textTransform:"none",fontWeight:400,color:"#6a9e7a",marginLeft:5}}>(optional)</span>}</div>);
const FD=({label})=>(<div style={{display:"flex",alignItems:"center",gap:10,margin:"6px 0 18px"}}><div style={{flex:1,height:1.5,background:"linear-gradient(90deg,#a8d8ba,transparent)"}}/><span style={{fontFamily:"'Caveat',cursive",fontSize:16,fontWeight:700,color:"#1a5038",padding:"4px 14px",background:"linear-gradient(135deg,#d8f0e2,#eaf7ee)",borderRadius:24,border:"1px solid #a8d8ba"}}>{label}</span><div style={{flex:1,height:1.5,background:"linear-gradient(90deg,transparent,#a8d8ba)"}}/></div>);

/* ══ Apply Page ═════════════════════════════════════════════════════════════ */
function ApplyPage({onSubmit}){
  const[f,setF]=useState({fn:"",em:"",ph:"",pos:"",yr:"",av:"",bg:"",fp:"",rt:""});
  const up=(k,v)=>setF(p=>({...p,[k]:v}));
  const[rTab,setRTab]=useState("text");
  const[rFileName,setRFileName]=useState("");
  const[focused,setFocused]=useState(null);
  const[mounted,setMounted]=useState(false);
  const[busy,setBusy]=useState(false);
  const[showWin,setShowWin]=useState(false);
  const[winName,setWinName]=useState("");
  const[errors,setErrors]=useState({});
  const[lastSub,setLastSub]=useState(0);
  const fileRef=useRef(null);
  useEffect(()=>{setTimeout(()=>setMounted(true),60);},[]);

  function handleFile(file){
    if(!file)return;
    if(!/\.(pdf|doc|docx|txt)$/i.test(file.name)){alert("PDF, Word, or .txt only");return;}
    if(file.size>5*1024*1024){alert("Max 5 MB");return;}
    setRFileName(sanitize(file.name,100));
  }

  async function doSubmit(){
    if(busy)return;
    const now=Date.now();
    if(lastSub&&now-lastSub<20000){alert("Please wait before resubmitting.");return;}
    const errs={};
    if(!f.fn.trim())errs.fn="Required";
    if(!f.em.trim()||!/\S+@\S+\.\S+/.test(f.em))errs.em="Valid email required";
    if(!f.ph.trim())errs.ph="Required";
    if(!f.pos)errs.pos="Required";
    if(!f.av.trim())errs.av="Required";
    if(Object.keys(errs).length){setErrors(errs);return;}
    setErrors({});setBusy(true);setLastSub(now);

    const cleanPos=["Barista","Shift Lead"].includes(f.pos)?f.pos:"Barista";
    const yrs=clampNum(f.yr,0,60);

    const entry={
      created_at:new Date().toISOString(),
      full_name:sanitize(f.fn,100),
      email:sanitize(f.em,200).toLowerCase(),
      phone:sanitize(f.ph,30),
      position:cleanPos,
      experience_years:yrs,
      availability:sanitize(f.av,300),
      digital_footprint:sanitize(f.fp,300),
      background_notes:sanitize(f.bg,500),
      resume_text: rTab==="text" ? sanitize(f.rt,2000) : "",
      resume_file_name: rTab==="upload" ? rFileName : "",
      status:"New",
      deleted_by_manager:false,
    };

    await onSubmit(entry);
    setBusy(false);setWinName(entry.full_name);setShowWin(true);
    setF({fn:"",em:"",ph:"",pos:"",yr:"",av:"",bg:"",fp:"",rt:""});
    setRFileName("");setRTab("text");
  }

  const I=n=>({width:"100%",background:focused===n?"linear-gradient(135deg,#fff,#f0faf4)":"linear-gradient(135deg,#f5faf7,#eef7f2)",border:`2.5px solid ${errors[n]?"#ef4444":focused===n?"#2d7a4a":"#b8ddc8"}`,borderRadius:14,padding:"13px 16px",color:"#1a2e22",fontSize:14,outline:"none",boxShadow:focused===n?"0 0 0 4px rgba(45,122,74,.14)":"0 2px 8px rgba(26,61,40,.07)",transition:"all .2s"});
  const E=k=>errors[k]&&<span style={{color:"#ef4444",fontSize:11,marginTop:4,display:"block"}}>{errors[k]}</span>;

  return(
    <>
      {showWin&&<SuccessOverlay name={winName} onDone={()=>setShowWin(false)}/>}
      <div style={{minHeight:"100%",background:`${wallpaper} repeat, linear-gradient(160deg,#d8f0e2,#e8f7ee 40%,#f2fbf5)`,backgroundSize:"80px 80px, cover",animation:"bgScroll 22s linear infinite"}}>
        <div className="gb" style={{position:"relative",padding:"48px 24px 68px",overflow:"hidden",minHeight:300}}>
          <CoffeeBG density={1.1}/>
          <div style={{position:"relative",zIndex:2,maxWidth:580,margin:"0 auto"}}>
            <div className={mounted?"fu":""} style={{display:"flex",alignItems:"center",gap:18,marginBottom:28}}>
              <div className="fl" style={{background:"linear-gradient(135deg,rgba(255,255,255,.2),rgba(255,255,255,.08))",borderRadius:22,padding:"12px 14px",backdropFilter:"blur(12px)",border:"1.5px solid rgba(255,255,255,.22)"}}><Logo size={58}/></div>
              <div><div className="now-hiring" style={{fontFamily:"'Caveat',cursive",color:"#92d4aa",fontSize:17,fontWeight:700,marginBottom:3}}>Now Hiring at</div><div className="hero-sub" style={{fontFamily:"'Cormorant Garamond',serif",fontSize:30,color:"#fff",fontWeight:700,lineHeight:1}}>Hope Coffee Melissa</div></div>
            </div>
            <div className={mounted?"fu":""} style={{animationDelay:"70ms"}}>
              <h1 className="hero-h1" style={{fontFamily:"'Cormorant Garamond',serif",fontSize:50,color:"#fff",fontWeight:700,margin:"0 0 16px",lineHeight:1.08}}>Join Our Team ☕</h1>
              <p style={{color:"#b8e8c8",fontSize:15,margin:"0 0 26px",lineHeight:1.85,maxWidth:460,fontWeight:300}}>Melissa's gathering place — craft coffee, good people, second chances. Every application is read by a real human.</p>
            </div>
            <div className={mounted?"fu":""} style={{animationDelay:"130ms",display:"flex",gap:10,flexWrap:"wrap"}}>
              {["Welcoming team","$11–13/hr","Flexible hours","Community-driven"].map(t=>(<span key={t} style={{background:"linear-gradient(135deg,rgba(255,255,255,.15),rgba(255,255,255,.07))",color:"#c8f0d8",fontSize:12,padding:"6px 16px",borderRadius:24,fontWeight:500,border:"1px solid rgba(255,255,255,.18)"}}>✓ {t}</span>))}
            </div>
          </div>
        </div>

        <div style={{maxWidth:580,margin:"0 auto",padding:"0 16px 80px"}}>
          <div className={`${mounted?"si":""} form-card`} style={{background:"linear-gradient(160deg,#fff,#f5fbf8)",borderRadius:28,padding:"38px 34px",marginTop:-34,boxShadow:"0 28px 70px rgba(26,61,40,.2),0 0 0 1px rgba(74,124,89,.08)"}}>
            <div style={{background:"linear-gradient(135deg,#d8f2e4,#e8f7ee)",borderRadius:15,padding:"16px 20px",marginBottom:26,border:"1.5px solid #a8d8b8"}}>
              <p style={{color:"#0d3a1e",fontSize:13,lineHeight:1.8}}><strong>🔒 Your privacy matters.</strong> Job-related info only. You'll get an email notification when your status changes. Track anytime with the "My Status" tab.</p>
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
                      <button type="button" onClick={()=>setRTab("text")} className="apple-btn" style={{padding:"5px 14px",borderRadius:18,border:"none",fontSize:12,fontWeight:rTab==="text"?700:500,background:rTab==="text"?"linear-gradient(165deg,#2a6040,#1a3d28,#0f2318)":"transparent",color:rTab==="text"?"#fff":"#1a5030",transition:"all .2s"}}>✏️ Write</button>
                      <button type="button" onClick={()=>setRTab("upload")} className="apple-btn" style={{padding:"5px 14px",borderRadius:18,border:"none",fontSize:12,fontWeight:rTab==="upload"?700:500,background:rTab==="upload"?"linear-gradient(165deg,#2a6040,#1a3d28,#0f2318)":"transparent",color:rTab==="upload"?"#fff":"#1a5030",transition:"all .2s"}}>📎 Upload</button>
                    </div>
                  </div>
                  {rTab==="text"
                    ?<textarea value={f.rt} onChange={e=>up("rt",e.target.value.slice(0,2000))} rows={4} placeholder="Your most recent roles and relevant experience (barista, customer service, food service, etc.)" style={{...I("rt"),resize:"vertical",minHeight:100}} onFocus={()=>setFocused("rt")} onBlur={()=>setFocused(null)}/>
                    :<div onClick={()=>fileRef.current?.click()} style={{width:"100%",minHeight:140,borderRadius:16,border:`2.5px dashed ${rFileName?"#16a34a":"#9ccfae"}`,background:rFileName?"#e8faf2":"#f5faf7",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10,cursor:"pointer",padding:"20px 16px",transition:"all .2s"}}>
                      <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.txt" style={{display:"none"}} onChange={e=>{if(e.target.files[0])handleFile(e.target.files[0]);}}/>
                      {rFileName
                        ?<><div style={{width:48,height:48,borderRadius:"50%",background:"linear-gradient(135deg,#0d4020,#16a34a)",display:"flex",alignItems:"center",justifyContent:"center"}}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg></div><p style={{color:"#0d4020",fontSize:13,fontWeight:700,margin:0}}>{rFileName}</p><p style={{color:"#5a9e6a",fontSize:11,margin:0}}>Click to replace</p><p style={{color:"#8aab98",fontSize:11,margin:0}}>📋 Brian will be notified that you attached a resume — please email it directly to melissa@hopecoffee.com</p></>
                        :<><div style={{width:48,height:48,borderRadius:"50%",background:"linear-gradient(135deg,#d0f0e0,#b8e8c8)",display:"flex",alignItems:"center",justifyContent:"center"}}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1a5030" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div><p style={{color:"#1a5030",fontSize:13,fontWeight:600,margin:0}}>Click to attach your resume</p><p style={{color:"#5a9e6a",fontSize:11,margin:0}}>PDF, Word, or .txt · max 5 MB</p><p style={{color:"#8aab98",fontSize:11,margin:0,textAlign:"center"}}>📋 After submitting, please also email your resume to melissa@hopecoffee.com</p></>}
                    </div>
                  }
                </div>
                <div><FL text="Anything we should know" optional/><textarea value={f.bg} onChange={e=>up("bg",e.target.value.slice(0,500))} rows={2} placeholder="Volunteer work, community involvement, context you'd like to share…" style={{...I("bg"),resize:"vertical",minHeight:72}} onFocus={()=>setFocused("bg")} onBlur={()=>setFocused(null)}/></div>
                <div>
                  <FL text="Online presence" optional/>
                  <input type="text" value={f.fp} onChange={e=>up("fp",e.target.value.slice(0,300))} placeholder="LinkedIn URL, portfolio link" style={I("fp")} onFocus={()=>setFocused("fp")} onBlur={()=>setFocused(null)}/>
                </div>
              </div>

              <button type="button" onClick={doSubmit} disabled={busy} className="apple-btn"
                style={{marginTop:6,background:busy?"linear-gradient(165deg,#6aad8e,#8ac4a4)":"linear-gradient(165deg,#2d6645 0%,#1a3d28 40%,#0f2318 100%)",color:"#fff",border:"none",borderRadius:16,padding:"17px 26px",fontSize:15,fontWeight:800,cursor:busy?"not-allowed":"pointer",boxShadow:busy?"none":"0 8px 28px rgba(12,30,18,.5)",display:"flex",alignItems:"center",justifyContent:"center",gap:10,width:"100%"}}>
                {busy?<><div style={{width:17,height:17,borderRadius:"50%",border:"2.5px solid rgba(255,255,255,.3)",borderTopColor:"#fff",animation:"spin .7s linear infinite"}}/>"Submitting…"</>:"Submit My Application →"}
              </button>
            </div>
          </div>
        </div>
      </div>
      <Chatbot context="apply"/>
    </>
  );
}

/* ══ My Status Page ═════════════════════════════════════════════════════════ */
function StatusPage({applicants}){
  const[emailInput,setEmailInput]=useState("");
  const[stage,setStage]=useState("email");
  const[found,setFound]=useState(null);
  const[code,setCode]=useState("");
  const[codeInput,setCodeInput]=useState("");
  const[codeError,setCodeError]=useState("");
  const[sending,setSending]=useState(false);
  const[mounted,setMounted]=useState(false);
  useEffect(()=>{setTimeout(()=>setMounted(true),60);},[]);

  async function doLookup(){
    const q=emailInput.trim().toLowerCase();
    if(!q)return;
    const match=applicants.find(a=>a.email.toLowerCase()===q);
    if(!match){setStage("notfound");return;}
    setSending(true);
    const newCode=genCode();
    setCode(newCode);
    const sent=await sendVerificationEmail(q,match.full_name,newCode);
    setSending(false);
    if(sent){setFound(match);setStage("verify");}
    else{setFound(match);setStage("found");}
  }

  function doVerify(){
    if(codeInput.trim()===code){setStage("found");setCodeError("");}
    else{setCodeError("Incorrect code. Please try again.");}
  }

  function reset(){setStage("email");setEmailInput("");setFound(null);setCode("");setCodeInput("");setCodeError("");}

  const statusInfo={
    New:      {icon:"📬",label:"Application Received",desc:"We've received your application and it's in our review queue. Every application is personally reviewed by Brian.",color:"#1e40af",bg:"linear-gradient(135deg,#c7ddff,#dbeafe)"},
    Interview:{icon:"📅",label:"Interview Stage!",desc:"Your application stood out! We'd love to set up an interview. Check your email — we sent you details!",color:"#713f12",bg:"linear-gradient(135deg,#fad44e,#fde68a)"},
    Hired:    {icon:"🎉",label:"Offer Extended!",desc:"Congratulations, welcome to the Hope Coffee family! Check your email for onboarding details.",color:"#14532d",bg:"linear-gradient(135deg,#6deba0,#bbf7d0)"},
    Rejected: {icon:"💌",label:"Application Closed",desc:"Thank you for your interest. We went with another candidate this time. Please apply again in the future!",color:"#7f1d1d",bg:"linear-gradient(135deg,#fcafc0,#fecdd3)"},
  };
  const steps=["New","Interview","Hired"];
  const stepIdx=found?steps.indexOf(found.status):-1;
  const firstName=found?found.full_name.split(" ")[0]:"";

  return(
    <div style={{minHeight:"100%",background:`${wallpaper} repeat, linear-gradient(160deg,#d0eedd,#e0f5e8,#f0fbf4)`,backgroundSize:"80px 80px, cover",animation:"bgScroll 22s linear infinite"}}>
      <div className="gb" style={{position:"relative",padding:"40px 24px 52px",overflow:"hidden"}}>
        <CoffeeBG density={0.9}/>
        <div style={{position:"relative",zIndex:2,maxWidth:560,margin:"0 auto"}}>
          <div className={mounted?"fu":""} style={{display:"flex",alignItems:"center",gap:14,marginBottom:20}}>
            <div className="fl" style={{background:"rgba(255,255,255,.16)",borderRadius:16,padding:"9px 11px",border:"1.5px solid rgba(255,255,255,.22)"}}><Logo size={42}/></div>
            <div><div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:26,color:"#fff",fontWeight:700,lineHeight:1}}>My Application</div><div style={{fontFamily:"'Caveat',cursive",color:"#8ec9a4",fontSize:16,marginTop:3}}>Hope Coffee Melissa</div></div>
          </div>
          <h1 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:38,color:"#fff",fontWeight:700,margin:"0 0 10px"}}>
            {stage==="found"?`Welcome back, ${firstName}! ☕`:"Check Your Status"}
          </h1>
          <p style={{color:"#a8d5b5",fontSize:14,lineHeight:1.75,fontWeight:300}}>
            {stage==="found"?"Here's everything about your application.":stage==="verify"?"We sent a 6-digit code to your email.":"Enter the email you used when applying."}
          </p>
        </div>
      </div>

      <div style={{maxWidth:580,margin:"0 auto",padding:"0 16px 80px"}}>
        {stage==="email"&&(
          <div className={mounted?"si":""} style={{background:"linear-gradient(160deg,#fff,#f5fbf8)",borderRadius:24,padding:"24px",marginTop:-24,boxShadow:"0 22px 58px rgba(26,61,40,.18)",marginBottom:16}}>
            <div style={{fontFamily:"'Caveat',cursive",fontSize:16,color:"#1a5030",fontWeight:700,marginBottom:13}}>🔍 Look up your application</div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              <input type="email" value={emailInput} onChange={e=>setEmailInput(e.target.value.slice(0,200))} onKeyDown={e=>{if(e.key==="Enter")doLookup();}} placeholder="your@email.com" style={{flex:"1 1 200px",background:"linear-gradient(135deg,#f5faf7,#eef7f2)",border:"2px solid #b8ddc8",borderRadius:13,padding:"12px 15px",color:"#1a2e22",fontSize:14,outline:"none"}}/>
              <button type="button" onClick={doLookup} disabled={sending} className="apple-btn" style={{padding:"12px 22px",borderRadius:13,border:"none",background:"linear-gradient(165deg,#2d6645,#1a3d28,#0f2318)",color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",boxShadow:"0 5px 18px rgba(26,61,40,.4)",whiteSpace:"nowrap",flexShrink:0}}>
                {sending?<><div style={{width:14,height:14,borderRadius:"50%",border:"2px solid rgba(255,255,255,.3)",borderTopColor:"#fff",animation:"spin .7s linear infinite",display:"inline-block",marginRight:6}}/>Sending…</>:"Look Up"}
              </button>
            </div>
          </div>
        )}

        {stage==="verify"&&(
          <div className="fu si" style={{background:"linear-gradient(160deg,#fff,#f5fbf8)",borderRadius:24,padding:"28px",marginTop:-24,boxShadow:"0 22px 58px rgba(26,61,40,.18)"}}>
            <div style={{textAlign:"center",marginBottom:20}}>
              <div style={{fontSize:44,marginBottom:12}}>📧</div>
              <h3 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,color:"#0d3a1e",fontWeight:700,margin:"0 0 8px"}}>Check your email</h3>
              <p style={{color:"#5a9e6a",fontSize:13,lineHeight:1.7}}>We sent a 6-digit verification code to <strong>{emailInput}</strong>.</p>
            </div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:12}}>
              <input type="text" value={codeInput} onChange={e=>setCodeInput(e.target.value.replace(/\D/g,"").slice(0,6))} onKeyDown={e=>{if(e.key==="Enter")doVerify();}} placeholder="000000" maxLength={6} style={{flex:"1 1 160px",background:"linear-gradient(135deg,#f5faf7,#eef7f2)",border:`2px solid ${codeError?"#ef4444":"#b8ddc8"}`,borderRadius:13,padding:"14px 16px",color:"#1a2e22",fontSize:22,fontWeight:700,letterSpacing:"0.3em",textAlign:"center",outline:"none"}}/>
              <button type="button" onClick={doVerify} className="apple-btn" style={{padding:"12px 22px",borderRadius:13,border:"none",background:"linear-gradient(165deg,#2d6645,#1a3d28,#0f2318)",color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",flexShrink:0}}>Verify →</button>
            </div>
            {codeError&&<p style={{color:"#ef4444",fontSize:12,margin:"0 0 10px"}}>{codeError}</p>}
            <button type="button" onClick={reset} style={{background:"none",border:"none",color:"#8aab98",fontSize:12,cursor:"pointer",textDecoration:"underline"}}>Use a different email</button>
          </div>
        )}

        {stage==="notfound"&&(
          <div className="fu" style={{background:"linear-gradient(135deg,#fff,#fff5f7)",borderRadius:20,padding:"26px",border:"1.5px solid #f8b4c0",textAlign:"center",marginTop:-24}}>
            <div style={{fontSize:40,marginBottom:12}}>🤔</div>
            <p style={{color:"#7f1d1d",fontWeight:700,fontSize:15,margin:"0 0 8px"}}>No application found</p>
            <p style={{color:"#6a9e7a",fontSize:13,margin:"0 0 16px",lineHeight:1.7}}>We couldn't find an application with that email. Double-check the address, or head to Apply to submit one.</p>
            <button type="button" onClick={reset} className="bh" style={{background:"linear-gradient(135deg,#d4f0de,#e4f7ec)",border:"1px solid #a8d8b8",borderRadius:10,padding:"8px 18px",color:"#0d4020",fontSize:13,fontWeight:600,cursor:"pointer"}}>Try again</button>
          </div>
        )}

        {stage==="found"&&found&&(
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
                        <div style={{width:38,height:38,borderRadius:"50%",background:active?st.g:"linear-gradient(135deg,#e0eee8,#d4e8dc)",display:"flex",alignItems:"center",justifyContent:"center",animation:current?"statusPulse 2s ease infinite":"none",border:current?`2.5px solid ${st.d}`:"2.5px solid transparent"}}>
                          {active?<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>:<div style={{width:9,height:9,borderRadius:"50%",background:"#b8d4c0"}}/>}
                        </div>
                        <div style={{fontSize:10,fontWeight:current?800:500,color:active?st.c:"#8aab98",whiteSpace:"nowrap"}}>{step}</div>
                      </div>
                      {i<steps.length-1&&<div style={{flex:1,height:2.5,background:stepIdx>i?"linear-gradient(90deg,#16a34a,#4ade80)":"#d4e8dc",margin:"0 4px",marginBottom:22,borderRadius:2}}/>}
                    </div>
                  );})}
                </div>
              </div>
            )}

            <div style={{background:"linear-gradient(135deg,#fff,#f5fbf8)",borderRadius:20,padding:"20px 22px",boxShadow:"0 4px 18px rgba(26,61,40,.09)",border:"1.5px solid #c8e8d4"}}>
              <div style={{fontFamily:"'Caveat',cursive",fontSize:15,fontWeight:700,color:"#1a5030",marginBottom:16}}>👤 Your Application Details</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}} className="form-grid-2">
                {[{l:"Name",v:found.full_name},{l:"Email",v:found.email},{l:"Phone",v:found.phone},{l:"Position",v:found.position},{l:"Applied",v:new Date(found.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})},{l:"Experience",v:`${found.experience_years} yr${found.experience_years!==1?"s":""}`}].map(x=>(
                  <div key={x.l} style={{background:"linear-gradient(135deg,#eaf7f0,#d8f0e4)",borderRadius:12,padding:"12px 14px",border:"1px solid #b8ddc8"}}>
                    <div style={{color:"#5a9e6a",fontSize:10,fontWeight:700,letterSpacing:".09em",textTransform:"uppercase",marginBottom:4}}>{x.l}</div>
                    <div style={{color:"#0d3a1e",fontSize:13,fontWeight:600,wordBreak:"break-word"}}>{x.v||"—"}</div>
                  </div>
                ))}
              </div>
            </div>
            <button type="button" onClick={reset} className="bh" style={{background:"transparent",border:"1px solid #c0e4cc",borderRadius:12,padding:"10px",color:"#5a9e6a",fontSize:13,fontWeight:600,cursor:"pointer",textAlign:"center",width:"100%"}}>← Search a different email</button>
          </div>
        )}
      </div>
      <Chatbot context="status"/>
    </div>
  );
}

/* ══ About Page ═════════════════════════════════════════════════════════════ */
function AboutPage(){
  const[mounted,setMounted]=useState(false);
  useEffect(()=>{setTimeout(()=>setMounted(true),60);},[]);
  const values=[
    {icon:"⚖️",title:"Act Justly — Work with Purpose",desc:"We pour intentionality into everything we do, seeking to honor God and people through excellent work that reflects His goodness. Each task, large or small, becomes an opportunity to serve with integrity and purpose."},
    {icon:"💚",title:"Love Mercy — Welcome with Generosity",desc:"We extend the heart of Christ through genuine hospitality—creating spaces of warmth, encouragement, and belonging. Every cup, every conversation, every act of service becomes a reflection of His love."},
    {icon:"🙏",title:"Walk Humbly — Lead with Grace",desc:"We walk alongside one another and those we serve with humility and gratitude. We listen, learn, and lead by serving—trusting God to use our efforts to build community and bring hope to others."},
  ];
  const perks=[
    {icon:"💰",label:"Pay",val:"$11–13/hr Barista · Competitive for Shift Lead"},
    {icon:"📅",label:"Hours",val:"10–36 hrs/week · Mon–Sat 6 AM–6 PM"},
    {icon:"📍",label:"Location",val:"2907 McKinney St, STE 100, Melissa TX 75454"},
    {icon:"📞",label:"Contact",val:"(469) 518-1994 · melissa@hopecoffee.com"},
    {icon:"🎂",label:"Requirement",val:"Must be 18 or older"},
    {icon:"☕",label:"Culture",val:"Faith-driven, community-rooted, servant-hearted"},
  ];
  return(
    <div style={{minHeight:"100%",background:`${wallpaper} repeat, linear-gradient(160deg,#d8f0e2,#e8f7ee 40%,#f2fbf5)`,backgroundSize:"80px 80px, cover",animation:"bgScroll 22s linear infinite"}}>
      <div className="gb" style={{position:"relative",padding:"48px 24px 68px",overflow:"hidden"}}>
        <CoffeeBG density={1}/>
        <div style={{position:"relative",zIndex:2,maxWidth:600,margin:"0 auto"}}>
          <div className={mounted?"fu":""} style={{display:"flex",alignItems:"center",gap:18,marginBottom:24}}>
            <div className="fl" style={{background:"rgba(255,255,255,.16)",borderRadius:22,padding:"12px 14px",border:"1.5px solid rgba(255,255,255,.22)"}}><Logo size={56}/></div>
            <div><div style={{fontFamily:"'Caveat',cursive",color:"#92d4aa",fontSize:17,fontWeight:700,marginBottom:3}}>About</div><div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:32,color:"#fff",fontWeight:700,lineHeight:1}}>Hope Coffee Melissa</div></div>
          </div>
          <h1 className={`hero-h1 ${mounted?"fu":""}`} style={{fontFamily:"'Cormorant Garamond',serif",fontSize:46,color:"#fff",fontWeight:700,margin:"0 0 16px",lineHeight:1.08,animationDelay:"60ms"}}>Drink Coffee. Change Lives. ☕</h1>
          <p className={mounted?"fu":""} style={{color:"#b8e8c8",fontSize:15,lineHeight:1.85,maxWidth:500,fontWeight:300,animationDelay:"120ms"}}>Our mission is to bring value and purpose through every cup, serving our community with hospitality, excellence, and intentionality.</p>
        </div>
      </div>

      <div style={{maxWidth:620,margin:"0 auto",padding:"0 16px 80px"}}>
        <div className={mounted?"si":""} style={{background:"linear-gradient(160deg,#fff,#f5fbf8)",borderRadius:28,padding:"34px",marginTop:-34,boxShadow:"0 28px 70px rgba(26,61,40,.2)"}}>
          <div style={{fontFamily:"'Caveat',cursive",fontSize:18,fontWeight:700,color:"#1a5030",marginBottom:16}}>📋 Quick Info</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:28}} className="form-grid-2">
            {perks.map(p=>(<div key={p.label} style={{background:"linear-gradient(135deg,#eaf7f0,#d8f0e4)",borderRadius:14,padding:"14px 16px",border:"1px solid #b8ddc8"}}>
              <div style={{fontSize:20,marginBottom:6}}>{p.icon}</div>
              <div style={{color:"#5a9e6a",fontSize:10,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",marginBottom:4}}>{p.label}</div>
              <div style={{color:"#0d3a1e",fontSize:13,fontWeight:600,lineHeight:1.5}}>{p.val}</div>
            </div>))}
          </div>

          <div style={{background:"linear-gradient(135deg,#0c1f12,#1a3d28,#2d5a3d)",borderRadius:18,padding:"22px 24px",marginBottom:28}}>
            <div style={{fontFamily:"'Caveat',cursive",fontSize:18,fontWeight:700,color:"#92d4aa",marginBottom:12}}>Our Mission</div>
            <p style={{color:"rgba(255,255,255,.88)",fontSize:14,lineHeight:1.85,margin:"0 0 12px"}}>The culture of HOPE COFFEE is one of serving. We exist to serve great coffee; to serve our community; to serve our customers; to serve coffee farmers; to serve the church; to serve one another; to serve those in need; and ultimately, we exist to serve Jesus Christ.</p>
            <p style={{color:"rgba(255,255,255,.65)",fontSize:13,lineHeight:1.8,margin:0}}>We aim to create a welcoming space where people feel cared for and valued — a true gathering place for Melissa, Texas.</p>
          </div>

          <div style={{fontFamily:"'Caveat',cursive",fontSize:18,fontWeight:700,color:"#1a5030",marginBottom:16}}>🌿 Team Values</div>
          <div style={{display:"flex",flexDirection:"column",gap:14,marginBottom:28}}>
            {values.map(v=>(<div key={v.title} style={{background:"linear-gradient(135deg,#f5fbf8,#eef7f2)",borderRadius:16,padding:"18px 20px",border:"1.5px solid #c0e4cc"}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                <span style={{fontSize:22}}>{v.icon}</span>
                <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:17,color:"#0d3a1e",fontWeight:700}}>{v.title}</div>
              </div>
              <p style={{color:"#3a6a4a",fontSize:13,lineHeight:1.8,margin:0}}>{v.desc}</p>
            </div>))}
          </div>

          <div style={{fontFamily:"'Caveat',cursive",fontSize:18,fontWeight:700,color:"#1a5030",marginBottom:16}}>☕ Open Positions</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:28}} className="form-grid-2">
            {[{role:"Barista",pay:"$11–13/hr",hrs:"10–36 hrs/wk",desc:"Craft drinks, connect with guests, share the Hope Coffee story."},
              {role:"Shift Lead",pay:"Competitive",hrs:"Full or Part Time",desc:"Run shifts, support the team, uphold our values and standards."}].map(r=>(
              <div key={r.role} style={{background:"linear-gradient(135deg,#0c1f12,#1a3d28)",borderRadius:16,padding:"18px 16px",boxShadow:"0 6px 22px rgba(12,31,18,.3)"}}>
                <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,color:"#fff",fontWeight:700,marginBottom:6}}>{r.role}</div>
                <div style={{color:"#92d4aa",fontSize:12,fontWeight:600,marginBottom:4}}>{r.pay} · {r.hrs}</div>
                <p style={{color:"rgba(255,255,255,.7)",fontSize:12,lineHeight:1.7,margin:0}}>{r.desc}</p>
              </div>
            ))}
          </div>

          <div style={{textAlign:"center",background:"linear-gradient(135deg,#d8f2e4,#e8f7ee)",borderRadius:18,padding:"24px",border:"1.5px solid #a8d8b8"}}>
            <div style={{fontSize:36,marginBottom:8}}>🙌</div>
            <h3 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:"#0d3a1e",fontWeight:700,margin:"0 0 8px"}}>Ready to join the family?</h3>
            <p style={{color:"#3a6a4a",fontSize:13,lineHeight:1.7,margin:"0 0 16px"}}>If you're passionate about making a difference with every cup — we'd love to hear from you.</p>
            <div style={{color:"#5a9e6a",fontSize:12}}>(469) 518-1994 · melissa@hopecoffee.com</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══ Manager Auth Gate ══════════════════════════════════════════════════════ */
function ManagerAuthGate({onAuth}){
  const[emailInput,setEmailInput]=useState("");const[err,setErr]=useState("");
  const[attempts,setAttempts]=useState(0);const[locked,setLocked]=useState(false);const[lockTimer,setLockTimer]=useState(0);
  useEffect(()=>{if(locked&&lockTimer>0){const t=setInterval(()=>setLockTimer(s=>{if(s<=1){setLocked(false);setAttempts(0);return 0;}return s-1;}),1000);return()=>clearInterval(t);}},[locked,lockTimer]);
  function tryAccess(){
    if(locked)return;
    const clean=emailInput.trim().toLowerCase();
    if(ADMIN_EMAILS.has(clean)){onAuth(clean);}
    else{const a=attempts+1;setAttempts(a);setErr("That email is not authorized.");setEmailInput("");if(a>=4){setLocked(true);setLockTimer(30);setErr("Too many attempts. Locked for 30 seconds.");}}
  }
  return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",background:"linear-gradient(160deg,#d0eedd,#e0f5e8)",position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",inset:0,opacity:.3}} className="gb"><CoffeeBG density={0.5}/></div>
      <div className="si" style={{position:"relative",zIndex:1,background:"linear-gradient(160deg,#fff,#f5fbf8)",borderRadius:26,padding:"42px 38px",width:"min(390px,calc(100vw - 32px))",boxShadow:"0 22px 60px rgba(26,61,40,.18)",textAlign:"center"}}>
        <div className="fl" style={{width:68,height:68,borderRadius:"50%",background:"linear-gradient(165deg,#2a6040,#1a3d28,#0f2318)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 22px"}}><Logo size={38}/></div>
        <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:28,color:"#0d3a1e",fontWeight:700,margin:"0 0 8px"}}>Manager Access</h2>
        <p style={{color:"#5a9e6a",fontSize:13,margin:"0 0 26px",lineHeight:1.65}}>Enter your authorized email to access the hiring dashboard.</p>
        <input type="email" value={emailInput} onChange={e=>setEmailInput(e.target.value.slice(0,200))} onKeyDown={e=>{if(e.key==="Enter")tryAccess();}} placeholder="manager@hopecoffee.com" disabled={locked} style={{width:"100%",background:"linear-gradient(135deg,#f5faf7,#eef7f2)",border:`2px solid ${err?"#ef4444":"#b8ddc8"}`,borderRadius:14,padding:"13px 16px",color:"#1a2e22",fontSize:14,outline:"none",marginBottom:14,textAlign:"center"}}/>
        <button type="button" onClick={tryAccess} disabled={locked||!emailInput.trim()} className="apple-btn" style={{width:"100%",padding:"14px 24px",borderRadius:14,border:"none",background:locked||!emailInput.trim()?"linear-gradient(135deg,#c8ddd0,#d8e8dc)":"linear-gradient(165deg,#2d6645,#1a3d28,#0f2318)",color:locked||!emailInput.trim()?"#6b9e7e":"#fff",fontSize:15,fontWeight:700,cursor:locked||!emailInput.trim()?"not-allowed":"pointer",marginBottom:14}}>
          {locked?`Try again in ${lockTimer}s`:"Access Dashboard →"}
        </button>
        {err&&<p style={{color:"#ef4444",fontSize:12,margin:0}}>{err}</p>}
      </div>
    </div>
  );
}

/* ══ Manager Dashboard ══════════════════════════════════════════════════════ */
function ManagerDashboard({applicants,onStatusChange,onDelete,managerEmail}){
  const[sel,setSel]=useState(null);
  const[filter,setFilter]=useState("All");
  const[search,setSearch]=useState("");
  const[confirmDelete,setConfirmDelete]=useState(false);
  const[statusMsg,setStatusMsg]=useState("");

  const selEntry=sel?applicants.find(a=>a.id===sel&&!a.deleted_by_manager):null;
  useEffect(()=>{if(sel&&!applicants.find(a=>a.id===sel&&!a.deleted_by_manager))setSel(null);},[applicants,sel]);

  const visibleApplicants=applicants.filter(a=>!a.deleted_by_manager);
  const counts=visibleApplicants.reduce((a,x)=>{a[x.status]=(a[x.status]||0)+1;return a;},{});
  const filtered=visibleApplicants.filter(a=>{
    if(filter!=="All"&&a.status!==filter)return false;
    if(search&&!a.full_name.toLowerCase().includes(search.toLowerCase())&&!a.email.toLowerCase().includes(search.toLowerCase()))return false;
    return true;
  });

  const managerName=managerEmail==="melissa@hopecoffee.com"?"Brian":"Manager";
  const hour=new Date().getHours();
  const greeting=hour<12?"Good morning":hour<17?"Good afternoon":"Good evening";

  async function handleStatusChange(id,ns){
    const applicant=applicants.find(a=>a.id===id);
    setStatusMsg("Updating…");
    await onStatusChange(id,ns);
    if(applicant&&["Interview","Hired","Rejected"].includes(ns)){
      setStatusMsg("Sending email…");
      await sendStatusEmail(applicant,ns);
    }
    setStatusMsg(`✓ Status updated to ${ns}`);
    setTimeout(()=>setStatusMsg(""),3000);
  }

  const cards=[
    {l:"Total",v:visibleApplicants.length,g:"linear-gradient(165deg,#1c4a30,#1a3d28,#0f2318)"},
    {l:"New",v:counts.New||0,g:"linear-gradient(165deg,#2558a8,#1d4ed8,#1338a8)"},
    {l:"Interview",v:counts.Interview||0,g:"linear-gradient(165deg,#9a4010,#b45309,#7a3208)"},
    {l:"Hired",v:counts.Hired||0,g:"linear-gradient(165deg,#0d5a28,#15803d,#0a4020)"},
  ];

  return(
    <div className="dash-layout" style={{display:"flex",height:"100%",background:`${wallpaper} repeat, linear-gradient(160deg,#d8f0e4,#e8f7ee)`,backgroundSize:"80px 80px, cover",animation:"bgScroll 22s linear infinite",overflow:"hidden"}}>

      {/* Sidebar */}
      <div className="dash-sidebar" style={{width:300,flexShrink:0,background:"linear-gradient(180deg,rgba(255,255,255,.98),rgba(245,251,248,.98))",borderRight:"1.5px solid #c0e4cc",display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"4px 0 32px rgba(26,61,40,.12)"}}>
        <div style={{background:"linear-gradient(165deg,#0c1f12,#1a3d28,#2d5a3d,#3a6a45)",padding:"20px 18px",flexShrink:0,position:"relative",overflow:"hidden"}}>
          <CoffeeBG density={0.65}/>
          <div style={{position:"relative",zIndex:2}}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
              <div className="fl" style={{background:"rgba(255,255,255,.16)",borderRadius:14,padding:"8px 10px",border:"1.5px solid rgba(255,255,255,.2)"}}><Logo size={30}/></div>
              <div><div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:"#fff",fontWeight:700}}>Hire4Hope</div><div style={{fontFamily:"'Caveat',cursive",color:"#8ec9a4",fontSize:13,marginTop:1}}>Manager Dashboard</div></div>
            </div>
            <div style={{background:"rgba(255,255,255,.12)",borderRadius:12,padding:"10px 14px",border:"1px solid rgba(255,255,255,.16)"}}>
              <div style={{fontFamily:"'Caveat',cursive",color:"#b8e8c8",fontSize:15,fontWeight:700}}>{greeting}, {managerName}! ☕</div>
              <div style={{color:"rgba(255,255,255,.72)",fontSize:11,marginTop:2}}>{visibleApplicants.length} applicant{visibleApplicants.length!==1?"s":""}{counts.New?" · "+counts.New+" new":""}</div>
            </div>
          </div>
        </div>

        <div style={{padding:"13px",borderBottom:"1px solid #c8e4d0",flexShrink:0}}>
          <div className="stat-cards" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {cards.map((c,i)=>(<div key={c.l} className="fu ch" style={{background:c.g,borderRadius:14,padding:"12px 14px",boxShadow:"0 6px 22px rgba(0,0,0,.22)",animationDelay:`${i*55}ms`}}><div style={{color:"#fff",fontSize:28,fontWeight:800,lineHeight:1}}>{c.v}</div><div style={{color:"rgba(255,255,255,.74)",fontSize:11,marginTop:3,fontWeight:600}}>{c.l}</div></div>))}
          </div>
        </div>

        <div style={{padding:"10px 13px 8px",borderBottom:"1px solid #c8e4d0",flexShrink:0}}>
          <input type="text" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name or email…" style={{width:"100%",background:"linear-gradient(135deg,#f0f9f4,#e6f5ec)",border:"1.5px solid #b8ddc8",borderRadius:11,padding:"9px 12px",fontSize:13,color:"#1a2e22",outline:"none"}}/>
        </div>

        <div style={{padding:"8px 13px 8px",borderBottom:"1px solid #c8e4d0",flexShrink:0}}>
          <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
            {["All","New","Interview","Hired","Rejected"].map(s=>(<button key={s} type="button" onClick={()=>setFilter(s)} className="apple-btn" style={{padding:"4px 11px",borderRadius:20,border:"none",background:filter===s?"linear-gradient(165deg,#2a6040,#1a3d28,#0f2318)":"linear-gradient(135deg,#d8f0e4,#e8f7ee)",color:filter===s?"#fff":"#1a5030",fontSize:11,fontWeight:filter===s?800:500}}>{s}{s!=="All"&&counts[s]?` (${counts[s]})`:""}</button>))}
          </div>
        </div>

        <div style={{flex:1,overflowY:"auto",padding:"8px 10px 14px"}}>
          {filtered.length===0
            ?<p style={{color:"#5a9e6a",fontSize:13,textAlign:"center",padding:"26px 12px"}}>{visibleApplicants.length===0?"No applications yet.":"No matches."}</p>
            :filtered.map((a,i)=>{const st=stG(a.status);const isActive=sel===a.id;return(
              <button key={a.id} type="button" onClick={()=>setSel(a.id)} className="rh" style={{display:"block",width:"100%",textAlign:"left",padding:"12px 13px",borderRadius:14,cursor:"pointer",marginBottom:6,background:isActive?"linear-gradient(135deg,#d4f2e2,#e4f9ec)":"linear-gradient(135deg,rgba(255,255,255,.95),rgba(245,251,248,.95))",border:`1.5px solid ${isActive?"#2d7a4a":"#c8e4d0"}`,boxShadow:isActive?"0 4px 20px rgba(45,122,74,.24)":"0 2px 10px rgba(26,61,40,.07)",animation:`slideL .3s ease ${i*35}ms both`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                  <span style={{color:"#0d3a1e",fontSize:13,fontWeight:700}}>{a.full_name}</span>
                  <span style={{background:st.l,color:st.c,fontSize:10,fontWeight:700,padding:"2px 9px",borderRadius:18,display:"flex",alignItems:"center",gap:3}}><span style={{width:4,height:4,borderRadius:"50%",background:st.d,display:"inline-block"}}/>{a.status}</span>
                </div>
                <div style={{color:"#5a9e6a",fontSize:11}}>{a.position} · {a.experience_years} yr{a.experience_years!==1?"s":""} exp</div>
              </button>
            );})}
        </div>
      </div>

      {/* Detail panel */}
      <div className="dash-detail" style={{flex:1,overflowY:"auto",padding:"28px 30px"}}>
        {!selEntry?(
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",gap:14}}>
            <div style={{color:"#a8d4b8",opacity:.55}} className="fl"><svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg></div>
            <p style={{color:"#5a9e6a",fontSize:14,textAlign:"center",lineHeight:1.85,opacity:.75}}>{visibleApplicants.length===0?"No applications yet.":"Select an applicant to review."}</p>
          </div>
        ):(
          <div key={selEntry.id} style={{background:"rgba(255,255,255,.97)",borderRadius:24,padding:"24px 26px",boxShadow:"0 10px 44px rgba(26,61,40,.14)",animation:"fadeUp .4s ease both"}}>

            {/* Header */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:16,marginBottom:16}}>
              <div style={{display:"flex",gap:14,alignItems:"flex-start",flex:1}}>
                <div style={{width:54,height:54,borderRadius:"50%",background:"linear-gradient(165deg,#2a6040,#1a3d28,#0f2318)",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:21,fontWeight:800,flexShrink:0,fontFamily:"'Cormorant Garamond',serif"}}>{selEntry.full_name.charAt(0)}</div>
                <div>
                  <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:27,color:"#0d3a1e",fontWeight:700,margin:"0 0 7px"}}>{selEntry.full_name}</h2>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:5}}>
                    {(()=>{const st=stG(selEntry.status);return<span style={{background:st.g,color:"#fff",fontSize:11,fontWeight:700,padding:"4px 14px",borderRadius:22,display:"flex",alignItems:"center",gap:5}}><span style={{width:6,height:6,borderRadius:"50%",background:"rgba(255,255,255,.72)"}}/>{selEntry.status}</span>;})()}
                    <span style={{color:"#1a5030",fontSize:12,fontWeight:600,background:"linear-gradient(135deg,#d4f0de,#e4f7ec)",padding:"3px 12px",borderRadius:18,border:"1px solid #a8d8b8"}}>{selEntry.position}</span>
                  </div>
                  <p style={{color:"#5a9e6a",fontSize:12,margin:"0 0 2px"}}>{selEntry.email} · {selEntry.phone}</p>
                  <p style={{fontFamily:"'Caveat',cursive",color:"#8aab98",fontSize:13}}>Applied {new Date(selEntry.created_at).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}</p>
                </div>
              </div>
            </div>

            {/* Application details grid */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}} className="form-grid-2">
              {[{l:"Experience",v:`${selEntry.experience_years} yr${selEntry.experience_years!==1?"s":""}`},{l:"Availability",v:selEntry.availability}].map(x=>(
                <div key={x.l} style={{background:"linear-gradient(135deg,#eaf7f0,#d8f0e4)",borderRadius:12,padding:"12px 14px",border:"1px solid #b8ddc8"}}>
                  <div style={{color:"#5a9e6a",fontSize:10,fontWeight:700,letterSpacing:".09em",textTransform:"uppercase",marginBottom:4}}>{x.l}</div>
                  <div style={{color:"#0d3a1e",fontSize:13,fontWeight:600,wordBreak:"break-word"}}>{x.v||"—"}</div>
                </div>
              ))}
            </div>

            {/* Resume */}
            {selEntry.resume_file_name?(
              <div style={{background:"linear-gradient(135deg,#e8f4ff,#dbeafe)",borderRadius:14,padding:"14px 18px",marginBottom:12,border:"1px solid #93c5fd"}}>
                <div style={{fontFamily:"'Caveat',cursive",fontSize:13,fontWeight:700,color:"#1e40af",marginBottom:8}}>📎 Resume Attached</div>
                <p style={{color:"#1e3a8a",fontSize:13,margin:"0 0 6px",fontWeight:600}}>{selEntry.resume_file_name}</p>
                <p style={{color:"#3b5bdb",fontSize:12,margin:0,lineHeight:1.6}}>Applicant indicated they attached a resume. Please check <strong>melissa@hopecoffee.com</strong> — they were asked to email it directly.</p>
              </div>
            ):selEntry.resume_text?(
              <div style={{background:"linear-gradient(135deg,#f5fbf8,#eef7f2)",borderRadius:14,padding:"14px 18px",marginBottom:12,border:"1.5px solid #c0e4cc"}}>
                <div style={{fontFamily:"'Caveat',cursive",fontSize:13,fontWeight:700,color:"#1a5030",marginBottom:8}}>📋 Resume Summary</div>
                <p style={{color:"#0d3a1e",fontSize:13,lineHeight:1.8,margin:0,whiteSpace:"pre-line"}}>{selEntry.resume_text}</p>
              </div>
            ):null}

            {/* Background & online presence */}
            {[{l:"Background Notes",v:selEntry.background_notes,e:"📝",g:"linear-gradient(135deg,#fff,#fffbf4)"},{l:"Online Presence",v:selEntry.digital_footprint,e:"🔗",g:"linear-gradient(135deg,#fff,#f4f8ff)"}].filter(x=>x.v).map(x=>(<div key={x.l} style={{background:x.g,borderRadius:14,padding:"14px 18px",marginBottom:12,border:"1.5px solid #c8e4cc"}}><div style={{fontFamily:"'Caveat',cursive",fontSize:13,fontWeight:700,color:"#1a5030",marginBottom:8}}>{x.e} {x.l}</div><p style={{color:"#0d3a1e",fontSize:13,lineHeight:1.8,margin:0,whiteSpace:"pre-line"}}>{x.v}</p></div>))}

            {/* Status update */}
            <div style={{background:"linear-gradient(135deg,#f2fbf6,#e8f7ee)",borderRadius:18,padding:"18px 22px",marginTop:4,border:"1.5px solid #c0e4cc"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                <div style={{fontFamily:"'Caveat',cursive",fontSize:14,fontWeight:700,color:"#1a5030"}}>Update Status</div>
                {statusMsg&&<div style={{fontSize:12,color:"#16a34a",fontWeight:600,animation:"fadeUp .3s ease both"}}>{statusMsg}</div>}
              </div>
              <div style={{background:"linear-gradient(135deg,#e8f4ff,#dbeafe)",borderRadius:12,padding:"10px 14px",marginBottom:14,border:"1px solid #93c5fd"}}>
                <p style={{color:"#1e40af",fontSize:12,margin:0,lineHeight:1.6}}>📧 <strong>Auto-email enabled:</strong> Moving to Interview, Hired, or Rejected will automatically send a branded email to the applicant.</p>
              </div>
              <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:16}}>
                {[{l:"Move to Interview",s:"Interview",g:"linear-gradient(165deg,#9a4010,#b45309,#7a3208)",sh:"rgba(180,83,9,.45)"},{l:"Mark as Hired",s:"Hired",g:"linear-gradient(165deg,#0d5a28,#15803d,#0a4020)",sh:"rgba(21,128,61,.45)"},{l:"Reject",s:"Rejected",g:"linear-gradient(165deg,#8a1a1a,#b91c1c,#7a1010)",sh:"rgba(185,28,28,.45)"},{l:"Reset to New",s:"New",g:"linear-gradient(165deg,#1a3a8a,#1d4ed8,#1228a0)",sh:"rgba(29,78,216,.45)"}].map(b=>{
                  const act=selEntry.status===b.s;
                  return<button key={b.s} type="button" onClick={()=>handleStatusChange(selEntry.id,b.s)} disabled={act} className="apple-btn" style={{padding:"10px 18px",borderRadius:13,border:"none",background:act?"linear-gradient(135deg,#c8ddd0,#d8e8dc)":b.g,color:act?"#6b9e7e":"#fff",fontSize:13,fontWeight:700,cursor:act?"default":"pointer",boxShadow:act?"none":`0 4px 18px ${b.sh}`}}>{act?"✓ ":""}{b.l}</button>;
                })}
              </div>
              <div style={{borderTop:"1px solid #c0e4cc",paddingTop:14}}>
                {!confirmDelete
                  ?<button type="button" onClick={()=>setConfirmDelete(true)} className="bh" style={{padding:"8px 16px",borderRadius:11,border:"1.5px solid #fca5a5",background:"linear-gradient(135deg,#fff5f5,#fff0f0)",color:"#991b1b",fontSize:12,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:6}}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>Delete from Manager View</button>
                  :<div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}><p style={{color:"#7f1d1d",fontSize:12,fontWeight:600,margin:0}}>Delete from your view? Applicant can still see their status.</p><div style={{display:"flex",gap:8}}><button type="button" onClick={()=>{onDelete(selEntry.id);setSel(null);setConfirmDelete(false);}} className="apple-btn" style={{padding:"7px 14px",borderRadius:10,border:"none",background:"linear-gradient(165deg,#8a1a1a,#b91c1c)",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Yes, Delete</button><button type="button" onClick={()=>setConfirmDelete(false)} className="bh" style={{padding:"7px 14px",borderRadius:10,border:"1px solid #c0e4cc",background:"transparent",color:"#5a9e6a",fontSize:12,fontWeight:600,cursor:"pointer"}}>Cancel</button></div></div>
                }
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ══ Root ═══════════════════════════════════════════════════════════════════ */
export default function App(){
  const[page,setPage]=useState("apply");
  const[applicants,setApplicants]=useState([]);
  const[loaded,setLoaded]=useState(false);
  const[managerEmail,setManagerEmail]=useState(null);

  useEffect(()=>{
    if(EJS_KEY) emailjs.init(EJS_KEY);
    const q=query(collection(db,"applicants"),orderBy("created_at","desc"));
    const unsub=onSnapshot(q,snap=>{
      setApplicants(snap.docs.map(d=>({id:d.id,...d.data()})));
      setLoaded(true);
    },err=>{console.error("Firestore:",err);setLoaded(true);});
    return()=>unsub();
  },[]);

  const addApplicant=useCallback(async e=>{await addDoc(collection(db,"applicants"),e);},[]);
  const changeSt=useCallback(async(id,ns)=>{await updateDoc(doc(db,"applicants",id),{status:ns});},[]);
  const deleteApplicant=useCallback(async id=>{await updateDoc(doc(db,"applicants",id),{deleted_by_manager:true});},[]);

  if(!loaded)return(<div style={{height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"linear-gradient(160deg,#d8f0e4,#eaf7ee)"}}><style>{CSS}</style><div style={{textAlign:"center",display:"flex",flexDirection:"column",alignItems:"center",gap:16}}><div className="fl"><Logo size={52}/></div><p style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:"#1a4028"}}>Loading Hire4Hope…</p></div></div>);

  const navItems=[
    {id:"apply",l:"Apply",ic:<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-2"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>},
    {id:"status",l:"My Status",ic:<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>},
    {id:"about",l:"About",ic:<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>},
  ];

  return(
    <div style={{height:"100vh",display:"flex",flexDirection:"column"}}>
      <style>{CSS}</style>
      <div className="nav-bar" style={{flexShrink:0,background:"linear-gradient(135deg,#fff,#f0fbf4)",borderBottom:"1.5px solid #b8ddc8",padding:"0 20px",display:"flex",alignItems:"center",height:56,gap:4,boxShadow:"0 4px 24px rgba(26,61,40,.12)"}}>
        <button type="button" onClick={()=>setPage("apply")} className="bh" style={{display:"flex",alignItems:"center",gap:9,marginRight:14,background:"none",border:"none",padding:"4px 8px",borderRadius:11,cursor:"pointer"}}>
          <div className="fl"><Logo size={30}/></div>
          <div><div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:16,fontWeight:700,lineHeight:1}} className="gt">Hire4Hope</div><div style={{fontFamily:"'Caveat',cursive",color:"#5a9e6a",fontSize:10,lineHeight:1,marginTop:1}}>by Hope Coffee Melissa</div></div>
        </button>
        <div style={{width:1,height:22,background:"linear-gradient(180deg,transparent,#a8d8b8,transparent)",marginRight:8}}/>
        {navItems.map(p=>(<button key={p.id} type="button" onClick={()=>setPage(p.id)} className="bh" style={{display:"flex",alignItems:"center",gap:6,padding:"6px 14px",borderRadius:11,border:"none",background:page===p.id?"linear-gradient(135deg,#d4f0de,#e4f9ec)":"transparent",color:page===p.id?"#0d4020":"#5a9e6a",fontSize:13,fontWeight:page===p.id?700:500,cursor:"pointer",borderBottom:`2.5px solid ${page===p.id?"#2d7a4a":"transparent"}`}}>{p.ic}<span className="nav-label">{p.l}</span></button>))}
        <button type="button" onClick={()=>setPage("manager")} className="bh" style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:4,padding:"5px 9px",borderRadius:9,border:`1px solid ${page==="manager"?"#2d7a4a":"rgba(168,216,184,.5)"}`,background:page==="manager"?"linear-gradient(135deg,#d4f0de,#e4f9ec)":"transparent",color:page==="manager"?"#0d4020":"rgba(90,158,106,.4)",fontSize:11,fontWeight:500,cursor:"pointer"}}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          {page==="manager"&&managerEmail&&<span className="nav-label" style={{fontSize:11}}>Dashboard</span>}
        </button>
      </div>

      <div style={{flex:1,overflow:page==="manager"?"hidden":"auto"}}>
        {page==="apply"   &&<ApplyPage onSubmit={addApplicant}/>}
        {page==="status"  &&<StatusPage applicants={applicants.filter(a=>!a.deleted_by_manager)}/>}
        {page==="about"   &&<AboutPage/>}
        {page==="manager" &&(managerEmail?<ManagerDashboard applicants={applicants} onStatusChange={changeSt} onDelete={deleteApplicant} managerEmail={managerEmail}/>:<ManagerAuthGate onAuth={email=>setManagerEmail(email)}/>)}
      </div>
    </div>
  );
}