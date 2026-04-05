import React,{useState,useRef,useCallback,useEffect,useMemo}from"react";
import{db}from"./firebase";
import{collection,onSnapshot,addDoc,updateDoc,doc,query,orderBy}from"firebase/firestore";
import emailjs from"@emailjs/browser";

/* ─── ENV ─────────────────────────────────────────────────────────────── */
const EJS_SVC    =import.meta.env.VITE_EMAILJS_SERVICE_ID      ||"";
const EJS_VERIFY =import.meta.env.VITE_EMAILJS_TEMPLATE_VERIFY ||"";
const EJS_STATUS =import.meta.env.VITE_EMAILJS_TEMPLATE_STATUS ||"";
const EJS_CONFIRM=import.meta.env.VITE_EMAILJS_TEMPLATE_CONFIRM||"";
const EJS_KEY    =import.meta.env.VITE_EMAILJS_PUBLIC_KEY      ||"";
const MGR_PASS   =import.meta.env.VITE_MANAGER_PASSWORD        ||"Hire4Hope26";
const ADMIN_SET  =new Set((import.meta.env.VITE_ADMIN_EMAILS||"melissa@hopecoffee.com").split(",").map(s=>s.trim().toLowerCase()));

/* ─── RATE LIMITER ────────────────────────────────────────────────────── */
// Prevents runaway AI calls that could cause unexpected billing
const RL={
  aiCalls:JSON.parse(sessionStorage.getItem("h4h_ai")||"[]"),
  chatCalls:JSON.parse(sessionStorage.getItem("h4h_chat")||"[]"),
  save(){sessionStorage.setItem("h4h_ai",JSON.stringify(this.aiCalls));sessionStorage.setItem("h4h_chat",JSON.stringify(this.chatCalls));},
  checkAI(){
    const now=Date.now();
    this.aiCalls=this.aiCalls.filter(t=>now-t<60000); // 1 min window
    if(this.aiCalls.length>=5){return false;} // max 5 AI scores per minute
    this.aiCalls.push(now);this.save();return true;
  },
  checkChat(){
    const now=Date.now();
    this.chatCalls=this.chatCalls.filter(t=>now-t<60000);
    if(this.chatCalls.length>=15){return false;} // max 15 chat messages per minute
    this.chatCalls.push(now);this.save();return true;
  }
};

/* ─── HELPERS ─────────────────────────────────────────────────────────── */
const san=(s,max=500)=>typeof s!=="string"?"":s.slice(0,max).replace(/[<>]/g,c=>c==="<"?"＜":"＞").replace(/javascript:/gi,"").replace(/on\w+\s*=/gi,"").trim();
const clamp=(v,lo=0,hi=60)=>{const n=parseInt(v,10);return isNaN(n)?lo:Math.min(hi,Math.max(lo,n));};
const code6=()=>String(Math.floor(100000+Math.random()*900000));
const MAX_FILE=800*1024; // 800 KB

function toB64(file){
  return new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=()=>res({b64:r.result.split(",")[1],mime:file.type||"application/octet-stream"});
    r.onerror=rej;
    r.readAsDataURL(file);
  });
}

/* ─── EMAILS ──────────────────────────────────────────────────────────── */
async function mailConfirm(email,name,pos){
  if(!EJS_SVC||!EJS_KEY)return false;
  const tid=EJS_CONFIRM||EJS_STATUS;
  if(!tid)return false;
  try{
    await emailjs.send(EJS_SVC,tid,{
      to_email:email,to_name:name||"Applicant",full_name:name,position:pos,
      new_status:"Received",
      status_message:`Thank you for applying for the ${pos} position at Hope Coffee Melissa! We received your application and will review it carefully. You'll get an email update when your status changes. Track your status anytime using the "My Status" tab on our website. ☕`
    },EJS_KEY);
    return true;
  }catch(e){console.warn("Confirm email skipped:",e.text||e);return false;}
}

async function mailVerify(email,name,code){
  if(!EJS_SVC||!EJS_VERIFY||!EJS_KEY)return false;
  try{await emailjs.send(EJS_SVC,EJS_VERIFY,{to_email:email,to_name:name||"Applicant",verification_code:code},EJS_KEY);return true;}
  catch(e){console.warn("Verify email skipped:",e.text||e);return false;}
}

async function mailStatus(app,status){
  if(!EJS_SVC||!EJS_STATUS||!EJS_KEY)return;
  const M={
    Interview:`Great news! Your application for the ${app.position} position at Hope Coffee Melissa has been reviewed and we'd love to set up an interview. Watch your email and phone for next steps. We look forward to meeting you! ☕`,
    Hired:`Congratulations! We are thrilled to welcome you to the Hope Coffee Melissa family. You've been selected for the ${app.position} position. Watch your email for onboarding details. We can't wait to have you on the team! ☕`,
    Rejected:`Thank you for your interest in joining Hope Coffee Melissa. After careful consideration, we've decided to move forward with other candidates for the ${app.position} role. We appreciate your interest and encourage you to apply again in the future. God bless! ☕`,
  };
  if(!M[status])return;
  try{await emailjs.send(EJS_SVC,EJS_STATUS,{to_email:app.email,to_name:app.full_name.split(" ")[0],full_name:app.full_name,position:app.position,new_status:status,status_message:M[status]},EJS_KEY);}
  catch(e){console.warn("Status email skipped:",e.text||e);}
}

/* ─── AI SCORING ──────────────────────────────────────────────────────── */
async function scoreAI(entry){
  if(!RL.checkAI()){console.warn("AI rate limit hit, using fallback");return scoreFallback(entry);}
  const hasFile=!!(entry.b64&&entry.mime);
  const hasText=!!(entry.resume_text?.trim().length>10);
  const prompt=`You are a hiring assistant for Hope Coffee Melissa, a faith-based community coffee shop in Melissa TX.
Score this applicant for the ${entry.position} role. Be honest.
APPLICANT: Position=${entry.position}, Experience=${entry.experience_years}yrs, Availability=${entry.availability||"N/A"}, Resume=${hasText?entry.resume_text:"Not provided"}, Background=${entry.background_notes||"N/A"}, Online=${entry.digital_footprint||"N/A"}
CRITERIA (score each 0-10):
- Experience (30%): 0yrs=1,1=3,2=5,3=7,4=8,5+=10. Boost for coffee/food service.
- Availability (20%): flexible/open=10, wkday+wkend=8, mornings=7, wkdays=6, wknds=5, vague=3.
- Role Fit (15%): match to barista/shift lead keywords.
- Resume Quality (20%): none=1, file uploaded or text present scored on relevance and quality.
- Background (10%): volunteer/community/awards boost score.
- Online Presence (5%): only real verifiable URLs count.
Return ONLY valid JSON, no markdown, no extra text:
{"score":<1-10>,"breakdown":[{"label":"Experience","raw":<0-10>,"weight":30,"reason":"<one sentence>"},{"label":"Availability","raw":<0-10>,"weight":20,"reason":"<one sentence>"},{"label":"Role Fit","raw":<0-10>,"weight":15,"reason":"<one sentence>"},{"label":"Resume Quality","raw":<0-10>,"weight":20,"reason":"<one sentence>"},{"label":"Background","raw":<0-10>,"weight":10,"reason":"<one sentence>"},{"label":"Online Presence","raw":<0-10>,"weight":5,"reason":"<one sentence>"}],"summary":"<2 sentence overall assessment>"}`;
  try{
    const msgs=hasFile
      ?[{role:"user",content:[{type:"document",source:{type:"base64",media_type:entry.mime,data:entry.b64}},{type:"text",text:prompt+"\n\nApplicant uploaded a resume file above — read it thoroughly and use its contents for Resume Quality and Role Fit scoring."}]}]
      :[{role:"user",content:prompt}];
    const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:700,messages:msgs})});
    if(!res.ok)throw new Error("API "+res.status);
    const data=await res.json();
    const raw=data?.content?.find(b=>b.type==="text")?.text||"";
    const parsed=JSON.parse(raw.replace(/```json|```/g,"").trim());
    if(typeof parsed.score==="number"&&Array.isArray(parsed.breakdown))
      return{score:Math.max(1,Math.min(10,Math.round(parsed.score))),breakdown:parsed.breakdown,ai_summary:parsed.summary||"",ai_scored:true};
    throw new Error("bad shape");
  }catch(e){console.warn("AI scoring error, using fallback:",e.message);return scoreFallback(entry);}
}

function scoreFallback(entry){
  const yrs=Number(entry.experience_years||0);
  const av=(entry.availability||"").toLowerCase();
  const rs=entry.resume_text||"";
  const bg=(entry.background_notes||"").toLowerCase();
  const fp=entry.digital_footprint||"";
  const pos=(entry.position||"").toLowerCase();
  const hasFile=!!(entry.b64);
  const hasText=rs.trim().length>10;
  const exp=yrs===0?1:yrs===1?3:yrs===2?5:yrs===3?7:yrs===4?8:10;
  const av2=/flexible|open|any.?time/i.test(av)?10:/weekday/i.test(av)&&/weekend/i.test(av)?8:/morning|6.?am/i.test(av)?7:/weekday/i.test(av)?6:/weekend/i.test(av)?5:av.trim().length>15?4:2;
  let role=2;
  if(pos==="shift lead")role+=2;
  const all=(rs+" "+bg).toLowerCase();
  if(/barista|espresso|coffee/i.test(all))role+=4;
  else if(/food service|restaurant/i.test(all))role+=2;
  else if(/customer service/i.test(all))role+=1;
  if(/lead|supervis|manag/i.test(all))role+=1;
  role=Math.min(10,role);
  const res2=hasFile?6:hasText?Math.min(10,3+(rs.length>200?2:0)+(/experience|skill|work/i.test(rs)?2:0)):0;
  const bgs=bg.trim().length>10?Math.min(10,3+(/volunteer|community/i.test(bg)?3:0)+(/award|recogni/i.test(bg)?2:0)+(bg.length>80?1:0)):0;
  const fps=/linkedin\.com\//i.test(fp)?8:/github\.com\/|portfolio\./i.test(fp)?7:0;
  const w=exp*.30+av2*.20+role*.15+res2*.20+bgs*.10+fps*.05;
  return{
    score:Math.max(1,Math.min(10,Math.round(w))),
    breakdown:[
      {label:"Experience",raw:exp,weight:30,reason:`${yrs} year(s) of experience.`},
      {label:"Availability",raw:av2,weight:20,reason:"Based on stated availability."},
      {label:"Role Fit",raw:role,weight:15,reason:"Based on resume and background keywords."},
      {label:"Resume Quality",raw:res2,weight:20,reason:hasFile?"Resume file uploaded.":hasText?"Text resume provided.":"No resume provided."},
      {label:"Background",raw:bgs,weight:10,reason:bg.trim().length>10?"Background info provided.":"No background info."},
      {label:"Online Presence",raw:fps,weight:5,reason:fps>0?"Verified link provided.":"No verifiable link."},
    ],
    ai_scored:false,
  };
}

/* ─── BREW KB ─────────────────────────────────────────────────────────── */
const KB=[
  {q:/how.*(apply|submit)/i,a:"Head to the **Apply** tab! Fill out the form and hit Submit. ☕"},
  {q:/position|job|role|open/i,a:"We're hiring **Barista** and **Shift Lead** — full or part-time!"},
  {q:/pay|wage|salary/i,a:"Barista pay is **$11–$13/hr**. Email melissa@hopecoffee.com for Shift Lead details!"},
  {q:/status.*mean|what.*interview|what.*hired|what.*reject/i,a:"**New**=received. **Interview**=we want to meet you! **Hired**=offer extended. **Rejected**=not this time, apply again!"},
  {q:/how long|when.*hear/i,a:"Most hear back within 1–2 weeks. You'll get an email when your status changes!"},
  {q:/hours|shift|schedule/i,a:"Open **Mon–Sat, 6AM–6PM**. Barista is 10–36 hrs/week, flexible scheduling!"},
  {q:/address|location|where/i,a:"**2907 McKinney St, STE 100, Melissa TX 75454** ☕"},
  {q:/phone|call|contact|email/i,a:"**(469) 518-1994** or **melissa@hopecoffee.com** ☕"},
  {q:/experience|no experience/i,a:"No experience? No problem! A servant heart matters most. Apply anyway!"},
  {q:/hope coffee|about|mission/i,a:"Hope Coffee serves the community with hospitality, excellence, and intentionality. Faith-driven, community-rooted. ☕"},
  {q:/hello|hi|hey/i,a:"Hey! ☕ I'm Brew. Ask me anything about applying to Hope Coffee!"},
  {q:/thank/i,a:"Of course! That's what I'm here for. ☕"},
];
const brewAns=t=>{for(const e of KB){if(e.q.test(t.trim()))return e.a;}return null;};

/* ─── COLOR HELPERS ───────────────────────────────────────────────────── */
const sBg=s=>s>=8?"linear-gradient(135deg,#bbf7d0,#dcfce7)":s>=6?"linear-gradient(135deg,#fde68a,#fef3c7)":s>=4?"linear-gradient(135deg,#fed7aa,#ffedd5)":"linear-gradient(135deg,#fecdd3,#fee2e2)";
const sTxt=s=>s>=8?"#14532d":s>=6?"#78350f":s>=4?"#7c2d12":"#7f1d1d";
const sLbl=s=>s>=8?"Strong Match ✓":s>=6?"Good Match":s>=4?"Developing":"Needs Review";
const stG=st=>({
  New     :{g:"linear-gradient(135deg,#1d4ed8,#3b82f6)",l:"linear-gradient(135deg,#dbeafe,#eff6ff)",c:"#1e3a8a",d:"#3b82f6"},
  Interview:{g:"linear-gradient(135deg,#b45309,#d97706)",l:"linear-gradient(135deg,#fde68a,#fef9c3)",c:"#713f12",d:"#ca8a04"},
  Hired   :{g:"linear-gradient(135deg,#14532d,#16a34a)",l:"linear-gradient(135deg,#bbf7d0,#dcfce7)",c:"#14532d",d:"#16a34a"},
  Rejected:{g:"linear-gradient(135deg,#991b1b,#ef4444)",l:"linear-gradient(135deg,#fecdd3,#fee2e2)",c:"#7f1d1d",d:"#ef4444"},
}[st]||{g:"linear-gradient(135deg,#475569,#94a3b8)",l:"linear-gradient(135deg,#e2e8f0,#f1f5f9)",c:"#475569",d:"#94a3b8"});

/* ─── CSS ─────────────────────────────────────────────────────────────── */
const CSS=`
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700;800&family=DM+Sans:wght@300;400;500;600;700&family=Caveat:wght@600;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body,input,textarea,select,button{font-family:'DM Sans',sans-serif}
@keyframes fadeUp{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:translateY(0)}}
@keyframes scaleIn{from{opacity:0;transform:scale(.91)}to{opacity:1;transform:scale(1)}}
@keyframes floatY{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
@keyframes pring{0%{box-shadow:0 0 0 0 rgba(52,211,153,.55)}70%{box-shadow:0 0 0 22px rgba(52,211,153,0)}100%{box-shadow:0 0 0 0 rgba(52,211,153,0)}}
@keyframes popIn{0%{transform:scale(.3);opacity:0}60%{transform:scale(1.1)}100%{transform:scale(1);opacity:1}}
@keyframes slideL{from{opacity:0;transform:translateX(-14px)}to{opacity:1;transform:translateX(0)}}
@keyframes chatPop{from{opacity:0;transform:scale(.8) translateY(20px)}to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes msgIn{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:translateY(0)}}
@keyframes dot{0%,80%,100%{transform:scale(.35);opacity:.25}40%{transform:scale(1);opacity:1}}
@keyframes checkDraw{from{stroke-dashoffset:50}to{stroke-dashoffset:0}}
@keyframes wiggle{0%,100%{transform:rotate(0)}25%{transform:rotate(-11deg)}75%{transform:rotate(11deg)}}
@keyframes ovIn{from{opacity:0}to{opacity:1}}
@keyframes txtUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
@keyframes cfetti{0%{transform:translateY(-10px) rotate(0);opacity:1}100%{transform:translateY(110vh) rotate(720deg);opacity:0}}
@keyframes pulse2{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes bgFlow{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
.btn{position:relative;overflow:hidden;cursor:pointer;border:none;outline:none;transition:transform .18s cubic-bezier(.34,1.56,.64,1),filter .18s;}
.btn::before{content:'';position:absolute;inset:0 0 50% 0;background:linear-gradient(180deg,rgba(255,255,255,.18),rgba(255,255,255,.04));border-radius:inherit;pointer-events:none;z-index:1;}
.btn::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.13),transparent);left:-80%;width:60%;transition:left .5s;pointer-events:none;z-index:2;}
.btn:hover::after{left:120%}
.btn:hover:not(:disabled){transform:translateY(-2px) scale(1.022);filter:brightness(1.07)}
.btn:active:not(:disabled){transform:scale(.962);filter:brightness(.95)}
.ch{transition:transform .22s cubic-bezier(.34,1.56,.64,1)!important}.ch:hover{transform:translateY(-3px)}
.rh{transition:all .14s!important}.rh:hover{transform:translateX(3px)}
.fu{animation:fadeUp .44s cubic-bezier(.25,.46,.45,.94) both}
.si{animation:scaleIn .37s cubic-bezier(.34,1.56,.64,1) both}
.fl{animation:floatY 4s ease-in-out infinite}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(52,211,153,.22);border-radius:10px}
@media(max-width:768px){.dl{flex-direction:column!important}.ds{width:100%!important;max-height:300px;border-right:none!important;border-bottom:1px solid rgba(52,211,153,.08)}.dd{padding:14px!important}.g2{grid-template-columns:1fr!important}.ht{font-size:30px!important}.fc{padding:20px 14px!important;margin-top:-20px!important}.nl{display:none!important}.sg{grid-template-columns:1fr 1fr!important}}
@media(max-width:480px){.ht{font-size:22px!important}.dd{padding:8px 6px!important}}
`;

/* ─── LOGO — Hope Coffee official bean-leaf mark ─────────────────────── */
const Logo=({s=48})=>(
  <svg width={s} height={s} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="hcA" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#a7f3d0"/><stop offset="100%" stopColor="#059669"/></linearGradient>
      <linearGradient id="hcB" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#6ee7b7"/><stop offset="100%" stopColor="#047857"/></linearGradient>
      <linearGradient id="hcC" x1="100%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor="#86efac"/><stop offset="100%" stopColor="#16a34a"/></linearGradient>
    </defs>
    {/* Left leaf */}
    <ellipse cx="20" cy="40" rx="11" ry="19" fill="url(#hcB)" transform="rotate(-28 20 40)"/>
    <path d="M13 26 Q20 40 17 54" stroke="#022c22" strokeWidth="1.6" fill="none" strokeLinecap="round"/>
    {/* Center leaf — tallest */}
    <ellipse cx="32" cy="34" rx="11" ry="21" fill="url(#hcA)" transform="rotate(0 32 34)"/>
    <path d="M32 13 Q32 34 32 55" stroke="#022c22" strokeWidth="1.6" fill="none" strokeLinecap="round"/>
    {/* Right leaf */}
    <ellipse cx="44" cy="39" rx="11" ry="19" fill="url(#hcC)" transform="rotate(26 44 39)"/>
    <path d="M51 25 Q44 39 47 53" stroke="#022c22" strokeWidth="1.6" fill="none" strokeLinecap="round"/>
  </svg>
);

/* ─── CONFETTI ────────────────────────────────────────────────────────── */
function Confetti(){
  const p=useMemo(()=>{
    const C=["#34d399","#10b981","#6ee7b7","#fbbf24","#f97316","#a7f3d0","#fb7185","#60a5fa"];
    const S=["●","■","▲","◆","✦","★"];
    return Array.from({length:60},(_,i)=>({id:i,color:C[i%C.length],shape:S[i%S.length],left:`${(i*1.7)%100}%`,sz:`${7+(i%8)}px`,dl:`${(i*.025)%1.5}s`,dr:`${2.4+(i%7)*.22}s`,rot:`${(i*43)%360}deg`}));
  },[]);
  return(<div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:9999,overflow:"hidden"}}>{p.map(x=>(<div key={x.id} style={{position:"absolute",top:0,left:x.left,color:x.color,fontSize:x.sz,animation:`cfetti ${x.dr} ${x.dl} ease-in both`,transform:`rotate(${x.rot})`}}>{x.shape}</div>))}</div>);
}

/* ─── SUCCESS OVERLAY ─────────────────────────────────────────────────── */
function SuccessOverlay({name,onDone}){
  useEffect(()=>{const t=setTimeout(onDone,5500);return()=>clearTimeout(t);},[onDone]);
  const first=name?name.split(" ")[0]:"";
  return(<><Confetti/><div onClick={onDone} style={{position:"fixed",inset:0,zIndex:9998,background:"linear-gradient(135deg,rgba(2,26,20,.97),rgba(4,47,36,.95))",display:"flex",alignItems:"center",justifyContent:"center",animation:"ovIn .4s ease both",cursor:"pointer"}}><div style={{textAlign:"center",padding:"0 32px",maxWidth:520}}>
    <div className="fl" style={{width:110,height:110,borderRadius:"50%",background:"linear-gradient(135deg,#022c22,#065f46,#10b981,#34d399)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 28px",animation:"popIn .7s cubic-bezier(.34,1.56,.64,1) both,pring 2.5s ease-out .9s",boxShadow:"0 0 0 20px rgba(52,211,153,.1),0 20px 60px rgba(16,185,129,.55)"}}>
      <svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{strokeDasharray:50,animation:"checkDraw .55s ease .75s both"}}><polyline points="20 6 9 17 4 12"/></svg>
    </div>
    <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:46,color:"#fff",fontWeight:800,lineHeight:1.1,marginBottom:14,animation:"txtUp .5s ease .45s both"}}>{first?`You're in, ${first}!`:"Submitted!"}</h1>
    <p style={{color:"#6ee7b7",fontSize:16,lineHeight:1.85,marginBottom:20,animation:"txtUp .5s ease .6s both",fontWeight:300}}>We received your application and a confirmation email is on its way. Track your status anytime in "My Status". ☕</p>
    <p style={{color:"rgba(255,255,255,.2)",fontSize:12,animation:"txtUp .5s ease .9s both"}}>Tap anywhere to close</p>
  </div></div></>);
}

/* ─── CHATBOT ─────────────────────────────────────────────────────────── */
function Chatbot({ctx="apply"}){
  const init=ctx==="status"?"Hi! ☕ I'm Brew. I can explain your status or anything about the process.":"Hey! ☕ I'm Brew. Ask me anything about applying to Hope Coffee!";
  const[open,setOpen]=useState(false);
  const[msgs,setMsgs]=useState([{role:"assistant",text:init}]);
  const[inp,setInp]=useState("");
  const[busy,setBusy]=useState(false);
  const[wig,setWig]=useState(false);
  const endR=useRef(null);
  useEffect(()=>{endR.current?.scrollIntoView({behavior:"smooth"});},[msgs,busy]);
  useEffect(()=>{if(!open){const t=setInterval(()=>{setWig(true);setTimeout(()=>setWig(false),700)},5500);return()=>clearInterval(t);}},[open]);
  async function send(){
    const t=san(inp,800).trim();if(!t||busy)return;
    setInp("");const hist=[...msgs,{role:"user",text:t}];setMsgs(hist);setBusy(true);
    const kb=brewAns(t);
    if(kb){setTimeout(()=>{setMsgs(p=>[...p,{role:"assistant",text:kb}]);setBusy(false);},380);return;}
    if(!RL.checkChat()){setMsgs(p=>[...p,{role:"assistant",text:"You're sending messages really fast! Take a breath and try again in a moment. ☕"}]);setBusy(false);return;}
    try{
      const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:320,system:"You are Brew, a warm assistant for Hire4Hope — Hope Coffee Melissa TX (2907 McKinney St, (469)518-1994, melissa@hopecoffee.com, Mon-Sat 6AM-6PM). Barista $11-13/hr, 10-36hrs/wk, must be 18+. Be brief (2-3 sentences max), warm, faith-aligned.",messages:hist.map(m=>({role:m.role,content:m.text}))})});
      if(!res.ok)throw new Error("API");
      const d=await res.json();const reply=d?.content?.find(b=>b.type==="text")?.text;
      if(!reply)throw new Error("empty");
      setMsgs(p=>[...p,{role:"assistant",text:san(reply,1200)}]);
    }catch{setMsgs(p=>[...p,{role:"assistant",text:"Not sure about that, but I can help with applying or checking your status! ☕"}]);}
    setBusy(false);
  }
  const BG="linear-gradient(165deg,#065f46,#022c22)";
  return(<>
    <div style={{position:"fixed",bottom:24,right:24,zIndex:1000}}>
      <button type="button" onClick={()=>setOpen(o=>!o)} className="btn" style={{width:60,height:60,borderRadius:"50%",background:BG,boxShadow:"0 8px 32px rgba(6,95,70,.55)",display:"flex",alignItems:"center",justifyContent:"center",animation:wig&&!open?"wiggle .55s ease":"none"}}>
        {open?<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>:<Logo s={28}/>}
      </button>
      {!open&&<div style={{position:"absolute",top:0,right:0,width:18,height:18,borderRadius:"50%",background:"linear-gradient(135deg,#10b981,#34d399)",border:"2px solid #022c22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,color:"#fff",fontWeight:800}}>AI</div>}
    </div>
    {open&&(<div style={{position:"fixed",bottom:96,right:24,zIndex:999,width:"min(360px,calc(100vw - 32px))",maxHeight:500,background:"#0a1a14",borderRadius:20,overflow:"hidden",boxShadow:"0 24px 80px rgba(0,0,0,.6)",display:"flex",flexDirection:"column",animation:"chatPop .38s cubic-bezier(.34,1.56,.64,1) both",border:"1px solid rgba(52,211,153,.15)"}}>
      <div style={{background:BG,padding:"14px 18px",display:"flex",alignItems:"center",gap:12}}>
        <div className="fl" style={{width:38,height:38,borderRadius:"50%",background:"rgba(52,211,153,.15)",border:"1.5px solid rgba(52,211,153,.3)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Logo s={22}/></div>
        <div><div style={{fontFamily:"'Playfair Display',serif",fontSize:17,color:"#fff",fontWeight:700}}>Brew</div><div style={{color:"#6ee7b7",fontSize:11,display:"flex",alignItems:"center",gap:5,marginTop:1}}><span style={{width:6,height:6,borderRadius:"50%",background:"#34d399",boxShadow:"0 0 6px #34d399",display:"inline-block"}}/>AI · Hope Coffee</div></div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"12px 12px 6px",display:"flex",flexDirection:"column",gap:10,minHeight:0}}>
        {msgs.map((m,i)=>(<div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start",animation:"msgIn .25s ease both"}}>
          {m.role==="assistant"&&<div style={{width:26,height:26,borderRadius:"50%",background:"linear-gradient(135deg,#065f46,#10b981)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginRight:8,marginTop:2}}><Logo s={14}/></div>}
          <div style={{maxWidth:"78%",padding:"9px 13px",borderRadius:m.role==="user"?"18px 18px 4px 18px":"18px 18px 18px 4px",background:m.role==="user"?"linear-gradient(135deg,#065f46,#047857)":"rgba(255,255,255,.06)",color:m.role==="user"?"#fff":"#d1fae5",fontSize:13,lineHeight:1.65,border:m.role==="assistant"?"1px solid rgba(52,211,153,.1)":"none"}}>
            {m.text.split(/(\*\*[^*]+\*\*)/).map((p,j)=>p.startsWith("**")&&p.endsWith("**")?<strong key={j}>{p.slice(2,-2)}</strong>:<React.Fragment key={j}>{p}</React.Fragment>)}
          </div>
        </div>))}
        {busy&&<div style={{display:"flex",gap:8}}><div style={{width:26,height:26,borderRadius:"50%",background:"linear-gradient(135deg,#065f46,#10b981)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Logo s={14}/></div><div style={{background:"rgba(255,255,255,.06)",borderRadius:"18px 18px 18px 4px",padding:"10px 14px",display:"flex",gap:5,alignItems:"center"}}>{[0,1,2].map(d=><span key={d} style={{width:7,height:7,borderRadius:"50%",background:"#34d399",display:"inline-block",animation:`dot 1.2s ease ${d*.22}s infinite`}}/>)}</div></div>}
        <div ref={endR}/>
      </div>
      {msgs.length<=1&&<div style={{padding:"0 12px 8px",display:"flex",gap:6,flexWrap:"wrap"}}>{(ctx==="status"?["What does my status mean?","When will I hear back?"]:["How do I apply?","What positions are open?","What's the pay?"]).map(q=><button key={q} type="button" onClick={()=>setInp(q)} className="btn" style={{padding:"5px 11px",borderRadius:18,border:"1px solid rgba(52,211,153,.2)",background:"rgba(52,211,153,.06)",color:"#6ee7b7",fontSize:11,fontWeight:600}}>{q}</button>)}</div>}
      <div style={{padding:"8px 12px 12px",borderTop:"1px solid rgba(255,255,255,.05)",background:"rgba(0,0,0,.2)"}}>
        <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
          <textarea value={inp} onChange={e=>setInp(e.target.value.slice(0,800))} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}} placeholder="Ask Brew anything…" rows={1} style={{flex:1,resize:"none",border:"1px solid rgba(52,211,153,.2)",borderRadius:12,padding:"9px 12px",fontSize:13,color:"#d1fae5",outline:"none",background:"rgba(255,255,255,.04)",maxHeight:80,overflowY:"auto"}}/>
          <button type="button" onClick={send} disabled={!inp.trim()||busy} className="btn" style={{width:36,height:36,borderRadius:"50%",flexShrink:0,background:inp.trim()&&!busy?"linear-gradient(135deg,#065f46,#10b981)":"rgba(255,255,255,.04)",display:"flex",alignItems:"center",justifyContent:"center",cursor:inp.trim()&&!busy?"pointer":"not-allowed"}}>
            {busy?<div style={{width:14,height:14,borderRadius:"50%",border:"2px solid rgba(255,255,255,.3)",borderTopColor:"#34d399",animation:"spin .7s linear infinite"}}/>:<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>}
          </button>
        </div>
      </div>
    </div>)}
  </>);
}

/* ─── FORM HELPERS ────────────────────────────────────────────────────── */
const FL=({text,opt})=>(<div style={{color:"#6ee7b7",fontSize:11,fontWeight:700,marginBottom:6,letterSpacing:".06em",textTransform:"uppercase"}}>{text}{opt&&<span style={{textTransform:"none",fontWeight:400,color:"rgba(110,231,183,.4)",marginLeft:5}}>(optional)</span>}</div>);
const FD=({label})=>(<div style={{display:"flex",alignItems:"center",gap:12,margin:"4px 0 16px"}}><div style={{flex:1,height:1,background:"linear-gradient(90deg,rgba(52,211,153,.4),transparent)"}}/><span style={{fontFamily:"'Caveat',cursive",fontSize:15,fontWeight:700,color:"#34d399",padding:"3px 14px",background:"rgba(52,211,153,.08)",borderRadius:24,border:"1px solid rgba(52,211,153,.2)"}}>{label}</span><div style={{flex:1,height:1,background:"linear-gradient(90deg,transparent,rgba(52,211,153,.4))"}}/></div>);

/* ─── APPLY PAGE ──────────────────────────────────────────────────────── */
function ApplyPage({onSubmit}){
  const[f,setF]=useState({fn:"",em:"",ph:"",pos:"",yr:"",av:"",bg:"",fp:"",rt:""});
  const up=(k,v)=>setF(p=>({...p,[k]:v}));
  const[rTab,setRTab]=useState("text");
  const[rFile,setRFile]=useState(null);
  const[rName,setRName]=useState("");
  const[fErr,setFErr]=useState("");
  const[foc,setFoc]=useState(null);
  const[mounted,setMounted]=useState(false);
  const[busy,setBusy]=useState(false);
  const[bMsg,setBMsg]=useState("Submitting…");
  const[win,setWin]=useState(false);
  const[winN,setWinN]=useState("");
  const[errs,setErrs]=useState({});
  const[last,setLast]=useState(0);
  const[drag,setDrag]=useState(false);
  const fRef=useRef(null);
  useEffect(()=>{setTimeout(()=>setMounted(true),80);},[]);

  function pickFile(file){
    if(!file)return;
    if(!/\.(pdf|doc|docx|txt)$/i.test(file.name)){setFErr("Please upload PDF, Word, or .txt");return;}
    if(file.size>MAX_FILE){setFErr(`File too large (${(file.size/1024).toFixed(0)}KB). Max 800KB — compress or paste as text instead.`);return;}
    setFErr("");setRFile(file);setRName(san(file.name,100));
  }

  async function submit(){
    if(busy)return;
    const now=Date.now();
    if(last&&now-last<20000){alert("Please wait a moment before resubmitting.");return;}
    const e={};
    if(!f.fn.trim())e.fn="Required";
    if(!f.em.trim()||!/\S+@\S+\.\S+/.test(f.em))e.em="Valid email required";
    if(!f.ph.trim())e.ph="Required";
    if(!f.pos)e.pos="Required";
    if(!f.av.trim())e.av="Required";
    if(Object.keys(e).length){setErrs(e);return;}
    setErrs({});setBusy(true);setLast(now);
    const pos=["Barista","Shift Lead"].includes(f.pos)?f.pos:"Barista";
    let b64="",mime="",fname="";
    if(rTab==="upload"&&rFile){
      setBMsg("Processing resume…");
      try{const r=await toB64(rFile);b64=r.b64;mime=r.mime;fname=rName;}
      catch(x){console.error("File read:",x);}
    }
    const entry={
      created_at:new Date().toISOString(),
      full_name:san(f.fn,100),email:san(f.em,200).toLowerCase(),phone:san(f.ph,30),
      position:pos,experience_years:clamp(f.yr,0,60),
      availability:san(f.av,300),digital_footprint:san(f.fp,300),
      background_notes:san(f.bg,500),
      resume_text:rTab==="text"?san(f.rt,2000):"",
      b64,mime,resume_file_name:fname,
      status:"New",deleted_by_manager:false,
    };
    setBMsg("AI is analyzing your application…");
    const{score,breakdown,ai_summary,ai_scored}=await scoreAI(entry);
    entry.risk_score=score;entry.score_breakdown=breakdown;entry.ai_summary=ai_summary||"";entry.ai_scored=ai_scored;
    // Don't store raw b64 under different name — keep consistent
    entry.resume_base64=b64;entry.resume_media_type=mime;
    delete entry.b64;delete entry.mime;
    setBMsg("Saving to database…");
    await onSubmit(entry);
    setBMsg("Sending confirmation email…");
    await mailConfirm(entry.email,entry.full_name,entry.position);
    setBusy(false);setWinN(entry.full_name);setWin(true);
    setF({fn:"",em:"",ph:"",pos:"",yr:"",av:"",bg:"",fp:"",rt:""});
    setRFile(null);setRName("");setRTab("text");setFErr("");
  }

  const IS=n=>({width:"100%",background:foc===n?"rgba(52,211,153,.06)":"rgba(255,255,255,.03)",border:`1.5px solid ${errs[n]?"#ef4444":foc===n?"rgba(52,211,153,.5)":"rgba(255,255,255,.08)"}`,borderRadius:12,padding:"12px 16px",color:"#e2fdf5",fontSize:14,outline:"none",boxShadow:foc===n?"0 0 0 3px rgba(52,211,153,.1)":"none",transition:"all .2s"});
  const EL=k=>errs[k]&&<span style={{color:"#f87171",fontSize:11,marginTop:4,display:"block"}}>{errs[k]}</span>;
  const BG="linear-gradient(165deg,#065f46,#022c22)";

  return(<>
    {win&&<SuccessOverlay name={winN} onDone={()=>setWin(false)}/>}
    <div style={{minHeight:"100%",background:"#040d0a"}}>
      {/* Hero */}
      <div style={{position:"relative",padding:"52px 24px 72px",overflow:"hidden",background:"linear-gradient(160deg,#022c22 0%,#065f46 40%,#047857 70%,#022c22 100%)",backgroundSize:"400% 400%",animation:"bgFlow 12s ease infinite"}}>
        <div style={{position:"absolute",top:-60,right:-60,width:300,height:300,borderRadius:"50%",background:"radial-gradient(circle,rgba(52,211,153,.14),transparent 70%)",pointerEvents:"none"}}/>
        <div style={{position:"relative",zIndex:2,maxWidth:580,margin:"0 auto"}}>
          <div className={mounted?"fu":""} style={{display:"flex",alignItems:"center",gap:18,marginBottom:28}}>
            <div className="fl" style={{background:"rgba(255,255,255,.12)",borderRadius:20,padding:"12px 14px",backdropFilter:"blur(12px)",border:"1px solid rgba(255,255,255,.18)"}}><Logo s={54}/></div>
            <div><div style={{fontFamily:"'Caveat',cursive",color:"#6ee7b7",fontSize:16,fontWeight:700,marginBottom:2}}>Now Hiring at</div><div style={{fontFamily:"'Playfair Display',serif",fontSize:26,color:"#fff",fontWeight:700}}>Hope Coffee Melissa</div></div>
          </div>
          <h1 className={`ht ${mounted?"fu":""}`} style={{fontFamily:"'Playfair Display',serif",fontSize:52,color:"#fff",fontWeight:800,margin:"0 0 16px",lineHeight:1.08,animationDelay:"70ms"}}>Join Our Team ☕</h1>
          <p className={mounted?"fu":""} style={{color:"rgba(110,231,183,.85)",fontSize:16,margin:"0 0 28px",lineHeight:1.8,maxWidth:460,fontWeight:300,animationDelay:"130ms"}}>Melissa's gathering place — craft coffee, good people, second chances. Every application is read by a real human.</p>
          <div className={mounted?"fu":""} style={{display:"flex",gap:10,flexWrap:"wrap",animationDelay:"190ms"}}>
            {["Welcoming team","$11–13/hr","Flexible hours","Community-driven"].map(t=><span key={t} style={{background:"rgba(255,255,255,.1)",color:"#a7f3d0",fontSize:12,padding:"6px 16px",borderRadius:24,fontWeight:500,border:"1px solid rgba(255,255,255,.15)"}}>✓ {t}</span>)}
          </div>
        </div>
      </div>
      {/* Form */}
      <div style={{maxWidth:580,margin:"0 auto",padding:"0 16px 80px"}}>
        <div className={`${mounted?"si":""} fc`} style={{background:"linear-gradient(160deg,#0a1a14,#0d1f18)",borderRadius:24,padding:"36px 32px",marginTop:-36,boxShadow:"0 30px 80px rgba(0,0,0,.5)",border:"1px solid rgba(52,211,153,.12)"}}>
          <div style={{background:"rgba(52,211,153,.06)",borderRadius:12,padding:"14px 18px",marginBottom:24,border:"1px solid rgba(52,211,153,.15)"}}><p style={{color:"#6ee7b7",fontSize:13,lineHeight:1.75,margin:0}}><strong>🔒 Your privacy matters.</strong> Job-related info only. You'll receive a confirmation email and notifications when your status changes.</p></div>
          <div style={{display:"flex",flexDirection:"column",gap:20}}>
            <FD label="Contact Info"/>
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <div><FL text="Full Name *"/><input type="text" value={f.fn} onChange={e=>up("fn",e.target.value.slice(0,100))} placeholder="Jane Smith" style={IS("fn")} onFocus={()=>setFoc("fn")} onBlur={()=>setFoc(null)} autoComplete="name"/>{EL("fn")}</div>
              <div className="g2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <div><FL text="Email *"/><input type="email" value={f.em} onChange={e=>up("em",e.target.value.slice(0,200))} placeholder="jane@email.com" style={IS("em")} onFocus={()=>setFoc("em")} onBlur={()=>setFoc(null)} autoComplete="email"/>{EL("em")}</div>
                <div><FL text="Phone *"/><input type="tel" value={f.ph} onChange={e=>up("ph",e.target.value.slice(0,30))} placeholder="(214) 555-0000" style={IS("ph")} onFocus={()=>setFoc("ph")} onBlur={()=>setFoc(null)} autoComplete="tel"/>{EL("ph")}</div>
              </div>
            </div>
            <FD label="Role & Experience"/>
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <div className="g2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <div><FL text="Position *"/><select value={f.pos} onChange={e=>up("pos",e.target.value)} style={{...IS("pos"),cursor:"pointer"}} onFocus={()=>setFoc("pos")} onBlur={()=>setFoc(null)}><option value="">Select…</option><option value="Barista">Barista</option><option value="Shift Lead">Shift Lead</option></select>{EL("pos")}</div>
                <div><FL text="Years Exp."/><input type="number" min="0" max="60" value={f.yr} onChange={e=>up("yr",e.target.value)} placeholder="0" style={IS("yr")} onFocus={()=>setFoc("yr")} onBlur={()=>setFoc(null)}/></div>
              </div>
              <div><FL text="Availability *"/><textarea value={f.av} onChange={e=>up("av",e.target.value.slice(0,300))} rows={2} placeholder="e.g. Flexible, weekdays open, weekends after noon" style={{...IS("av"),resize:"vertical",minHeight:70}} onFocus={()=>setFoc("av")} onBlur={()=>setFoc(null)}/>{EL("av")}</div>
            </div>
            <FD label="About You"/>
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              {/* Resume toggle */}
              <div>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                  <FL text="Resume"/>
                  <div style={{display:"flex",gap:3,background:"rgba(255,255,255,.04)",borderRadius:24,padding:3,border:"1px solid rgba(52,211,153,.15)"}}>
                    {["text","upload"].map(tab=><button key={tab} type="button" onClick={()=>setRTab(tab)} className="btn" style={{padding:"5px 14px",borderRadius:18,border:"none",fontSize:12,fontWeight:rTab===tab?700:500,background:rTab===tab?BG:"transparent",color:rTab===tab?"#fff":"rgba(110,231,183,.6)",transition:"all .2s"}}>{tab==="text"?"✏️ Write":"📎 Upload"}</button>)}
                  </div>
                </div>
                {rTab==="text"
                  ?<textarea value={f.rt} onChange={e=>up("rt",e.target.value.slice(0,2000))} rows={4} placeholder="Your most relevant experience — barista, customer service, food service, leadership roles…" style={{...IS("rt"),resize:"vertical",minHeight:100}} onFocus={()=>setFoc("rt")} onBlur={()=>setFoc(null)}/>
                  :<div onDragOver={e=>{e.preventDefault();setDrag(true)}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);if(e.dataTransfer.files[0])pickFile(e.dataTransfer.files[0]);}} onClick={()=>fRef.current?.click()} style={{width:"100%",minHeight:130,borderRadius:14,border:`2px dashed ${drag?"rgba(52,211,153,.6)":rName?"rgba(52,211,153,.4)":"rgba(255,255,255,.1)"}`,background:drag?"rgba(52,211,153,.06)":rName?"rgba(52,211,153,.03)":"rgba(255,255,255,.02)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8,cursor:"pointer",padding:"18px 16px",transition:"all .2s"}}>
                    <input ref={fRef} type="file" accept=".pdf,.doc,.docx,.txt" style={{display:"none"}} onChange={e=>{if(e.target.files[0])pickFile(e.target.files[0]);}}/>
                    {rName
                      ?<><div style={{width:44,height:44,borderRadius:"50%",background:"linear-gradient(135deg,#065f46,#10b981)",display:"flex",alignItems:"center",justifyContent:"center"}}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg></div><p style={{color:"#6ee7b7",fontSize:13,fontWeight:700,margin:0}}>{rName}</p><p style={{color:"rgba(110,231,183,.45)",fontSize:11,margin:0}}>Click to replace · AI will read this file</p></>
                      :<><div style={{width:44,height:44,borderRadius:"50%",background:"rgba(52,211,153,.08)",display:"flex",alignItems:"center",justifyContent:"center"}}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div><p style={{color:"#6ee7b7",fontSize:13,fontWeight:600,margin:0}}>Drag & drop or click to upload</p><p style={{color:"rgba(110,231,183,.45)",fontSize:11,margin:0}}>PDF, Word, or .txt · max 800KB</p></>}
                    {fErr&&<p style={{color:"#f87171",fontSize:12,margin:"4px 0 0",textAlign:"center"}}>{fErr}</p>}
                  </div>
                }
              </div>
              <div><FL text="Anything we should know" opt/><textarea value={f.bg} onChange={e=>up("bg",e.target.value.slice(0,500))} rows={2} placeholder="Volunteer work, community involvement, anything you'd like to share…" style={{...IS("bg"),resize:"vertical",minHeight:70}} onFocus={()=>setFoc("bg")} onBlur={()=>setFoc(null)}/></div>
              <div><FL text="Online presence" opt/><input type="text" value={f.fp} onChange={e=>up("fp",e.target.value.slice(0,300))} placeholder="LinkedIn URL or portfolio link" style={IS("fp")} onFocus={()=>setFoc("fp")} onBlur={()=>setFoc(null)}/><span style={{color:"rgba(110,231,183,.3)",fontSize:11,marginTop:4,display:"block"}}>Tip: a real link improves your fit score.</span></div>
            </div>
            <button type="button" onClick={submit} disabled={busy} className="btn" style={{marginTop:4,background:busy?"rgba(52,211,153,.1)":BG,color:busy?"rgba(110,231,183,.35)":"#fff",border:"1px solid rgba(52,211,153,.3)",borderRadius:14,padding:"16px 24px",fontSize:15,fontWeight:700,cursor:busy?"not-allowed":"pointer",boxShadow:busy?"none":"0 8px 32px rgba(6,95,70,.5)",display:"flex",alignItems:"center",justifyContent:"center",gap:10,width:"100%"}}>
              {busy?<><div style={{width:16,height:16,borderRadius:"50%",border:"2px solid rgba(110,231,183,.3)",borderTopColor:"#34d399",animation:"spin .7s linear infinite"}}/>{bMsg}</>:"Submit My Application →"}
            </button>
          </div>
        </div>
      </div>
    </div>
    <Chatbot ctx="apply"/>
  </>);
}

/* ─── STATUS PAGE ─────────────────────────────────────────────────────── */
function StatusPage({applicants}){
  const[emailIn,setEmailIn]=useState("");
  const[stage,setStage]=useState("email");
  const[found,setFound]=useState(null);
  const[code,setCode]=useState("");
  const[codeIn,setCodeIn]=useState("");
  const[codeErr,setCodeErr]=useState("");
  const[sending,setSending]=useState(false);
  const[mounted,setMounted]=useState(false);
  useEffect(()=>{setTimeout(()=>setMounted(true),80);},[]);

  async function lookup(){
    const q=emailIn.trim().toLowerCase();if(!q)return;
    const match=applicants.find(a=>a.email.toLowerCase()===q);
    if(!match){setStage("notfound");return;}
    setSending(true);const c=code6();setCode(c);
    const sent=await mailVerify(q,match.full_name,c);
    setSending(false);setFound(match);
    sent?setStage("verify"):setStage("found"); // if email not configured skip OTP
  }
  function verify(){codeIn.trim()===code?(setStage("found"),setCodeErr("")):(setCodeErr("Incorrect code. Try again."));}
  function reset(){setStage("email");setEmailIn("");setFound(null);setCode("");setCodeIn("");setCodeErr("");}

  const SI={
    New:     {icon:"📬",label:"Application Received",desc:"We've got your application and it's in our review queue. Brian personally reviews every application.",color:"#3b82f6",bg:"rgba(59,130,246,.1)",bd:"rgba(59,130,246,.25)"},
    Interview:{icon:"📅",label:"Interview Stage!",desc:"Your application stood out! We sent you interview details — check your email!",color:"#f59e0b",bg:"rgba(245,158,11,.1)",bd:"rgba(245,158,11,.25)"},
    Hired:   {icon:"🎉",label:"Offer Extended!",desc:"Congratulations! Welcome to the Hope Coffee family. Check your email for onboarding details.",color:"#10b981",bg:"rgba(16,185,129,.1)",bd:"rgba(16,185,129,.25)"},
    Rejected:{icon:"💌",label:"Application Closed",desc:"Thank you for your interest. We went with other candidates this time. Please apply again in the future!",color:"#ef4444",bg:"rgba(239,68,68,.1)",bd:"rgba(239,68,68,.25)"},
  };
  const steps=["New","Interview","Hired"];
  const idx=found?steps.indexOf(found.status):-1;
  const first=found?found.full_name.split(" ")[0]:"";
  const BG="linear-gradient(165deg,#065f46,#022c22)";

  return(<div style={{minHeight:"100%",background:"#040d0a"}}>
    <div style={{position:"relative",padding:"44px 24px 56px",overflow:"hidden",background:"linear-gradient(160deg,#022c22,#065f46 50%,#022c22)"}}>
      <div style={{position:"relative",zIndex:2,maxWidth:560,margin:"0 auto"}}>
        <div className={mounted?"fu":""} style={{display:"flex",alignItems:"center",gap:14,marginBottom:20}}>
          <div className="fl" style={{background:"rgba(255,255,255,.12)",borderRadius:16,padding:"9px 11px",border:"1px solid rgba(255,255,255,.18)"}}><Logo s={40}/></div>
          <div><div style={{fontFamily:"'Playfair Display',serif",fontSize:24,color:"#fff",fontWeight:700}}>My Application</div><div style={{fontFamily:"'Caveat',cursive",color:"#6ee7b7",fontSize:15,marginTop:2}}>Hope Coffee Melissa</div></div>
        </div>
        <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:36,color:"#fff",fontWeight:800,margin:"0 0 10px"}}>{stage==="found"?`Welcome back, ${first}! ☕`:"Check Your Status"}</h1>
        <p style={{color:"rgba(110,231,183,.7)",fontSize:14,lineHeight:1.75,fontWeight:300}}>{stage==="found"?"Here's everything about your application.":stage==="verify"?"We sent a 6-digit code to your email.":"Enter the email you used when applying."}</p>
      </div>
    </div>
    <div style={{maxWidth:580,margin:"0 auto",padding:"0 16px 80px"}}>
      {stage==="email"&&<div className={mounted?"si":""} style={{background:"#0a1a14",borderRadius:20,padding:"24px",marginTop:-24,boxShadow:"0 20px 60px rgba(0,0,0,.4)",marginBottom:14,border:"1px solid rgba(52,211,153,.12)"}}>
        <div style={{fontFamily:"'Caveat',cursive",fontSize:15,color:"#34d399",fontWeight:700,marginBottom:12}}>🔍 Look up your application</div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          <input type="email" value={emailIn} onChange={e=>setEmailIn(e.target.value.slice(0,200))} onKeyDown={e=>{if(e.key==="Enter")lookup();}} placeholder="your@email.com" style={{flex:"1 1 200px",background:"rgba(255,255,255,.03)",border:"1.5px solid rgba(52,211,153,.2)",borderRadius:12,padding:"12px 16px",color:"#e2fdf5",fontSize:14,outline:"none"}}/>
          <button type="button" onClick={lookup} disabled={sending} className="btn" style={{padding:"12px 22px",borderRadius:12,background:BG,color:"#fff",fontSize:14,fontWeight:700,boxShadow:"0 4px 18px rgba(6,95,70,.4)",whiteSpace:"nowrap",flexShrink:0}}>
            {sending?<><div style={{width:13,height:13,borderRadius:"50%",border:"2px solid rgba(255,255,255,.3)",borderTopColor:"#34d399",animation:"spin .7s linear infinite",display:"inline-block",marginRight:6}}/>Sending…</>:"Look Up →"}
          </button>
        </div>
      </div>}
      {stage==="verify"&&<div className="si" style={{background:"#0a1a14",borderRadius:20,padding:"28px",marginTop:-24,boxShadow:"0 20px 60px rgba(0,0,0,.4)",border:"1px solid rgba(52,211,153,.12)"}}>
        <div style={{textAlign:"center",marginBottom:20}}><div style={{fontSize:44,marginBottom:10}}>📧</div><h3 style={{fontFamily:"'Playfair Display',serif",fontSize:22,color:"#fff",fontWeight:700,margin:"0 0 8px"}}>Check your email</h3><p style={{color:"#6ee7b7",fontSize:13,lineHeight:1.7}}>We sent a 6-digit code to <strong>{emailIn}</strong></p></div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:12}}>
          <input type="text" value={codeIn} onChange={e=>setCodeIn(e.target.value.replace(/\D/g,"").slice(0,6))} onKeyDown={e=>{if(e.key==="Enter")verify();}} placeholder="000000" maxLength={6} style={{flex:"1 1 160px",background:"rgba(255,255,255,.03)",border:`1.5px solid ${codeErr?"#ef4444":"rgba(52,211,153,.2)"}`,borderRadius:12,padding:"14px 16px",color:"#e2fdf5",fontSize:24,fontWeight:700,letterSpacing:"0.3em",textAlign:"center",outline:"none"}}/>
          <button type="button" onClick={verify} className="btn" style={{padding:"12px 22px",borderRadius:12,background:BG,color:"#fff",fontSize:14,fontWeight:700,flexShrink:0}}>Verify →</button>
        </div>
        {codeErr&&<p style={{color:"#f87171",fontSize:12,margin:"0 0 10px"}}>{codeErr}</p>}
        <button type="button" onClick={reset} style={{background:"none",border:"none",color:"rgba(110,231,183,.35)",fontSize:12,cursor:"pointer",textDecoration:"underline"}}>Use a different email</button>
      </div>}
      {stage==="notfound"&&<div className="fu" style={{background:"#0a1a14",borderRadius:18,padding:"28px",border:"1px solid rgba(239,68,68,.2)",textAlign:"center",marginTop:-24}}>
        <div style={{fontSize:42,marginBottom:12}}>🤔</div>
        <p style={{color:"#f87171",fontWeight:700,fontSize:15,margin:"0 0 8px"}}>No application found</p>
        <p style={{color:"#6ee7b7",fontSize:13,margin:"0 0 18px",lineHeight:1.7}}>We couldn't find an application with that email. Double-check it or head to Apply to submit one.</p>
        <button type="button" onClick={reset} className="btn" style={{background:"rgba(52,211,153,.08)",border:"1px solid rgba(52,211,153,.2)",borderRadius:10,padding:"8px 20px",color:"#6ee7b7",fontSize:13,fontWeight:600,cursor:"pointer"}}>Try again</button>
      </div>}
      {stage==="found"&&found&&(()=>{
        const info=SI[found.status]||SI.New;
        return(<div className="fu" style={{display:"flex",flexDirection:"column",gap:12}}>
          <div style={{background:info.bg,borderRadius:20,padding:"22px 20px",border:`1px solid ${info.bd}`}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:16}}>
              <div style={{fontSize:42,lineHeight:1,flexShrink:0}}>{info.icon}</div>
              <div><div style={{color:info.color,fontSize:11,fontWeight:800,letterSpacing:".12em",textTransform:"uppercase",marginBottom:5}}>Current Status</div><h2 style={{fontFamily:"'Playfair Display',serif",fontSize:24,color:"#fff",fontWeight:700,margin:"0 0 8px"}}>{info.label}</h2><p style={{color:"rgba(255,255,255,.65)",fontSize:13,lineHeight:1.75,margin:0}}>{info.desc}</p></div>
            </div>
          </div>
          {found.status!=="Rejected"&&<div style={{background:"#0a1a14",borderRadius:18,padding:"18px 20px",border:"1px solid rgba(52,211,153,.12)"}}>
            <div style={{fontFamily:"'Caveat',cursive",fontSize:14,fontWeight:700,color:"#34d399",marginBottom:14}}>Application Progress</div>
            <div style={{display:"flex",alignItems:"center"}}>
              {steps.map((step,i)=>{const act=idx>=i;const cur=idx===i;const sg=stG(step);return(<div key={step} style={{display:"flex",alignItems:"center",flex:i<steps.length-1?1:"none"}}>
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:5}}>
                  <div style={{width:36,height:36,borderRadius:"50%",background:act?sg.g:"rgba(255,255,255,.05)",display:"flex",alignItems:"center",justifyContent:"center",animation:cur?"pulse2 2s ease infinite":"none",border:`2px solid ${cur?sg.d:"rgba(255,255,255,.08)"}`}}>
                    {act?<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>:<div style={{width:8,height:8,borderRadius:"50%",background:"rgba(255,255,255,.2)"}}/>}
                  </div>
                  <div style={{fontSize:10,fontWeight:cur?800:500,color:act?sg.d:"rgba(255,255,255,.3)",whiteSpace:"nowrap"}}>{step}</div>
                </div>
                {i<steps.length-1&&<div style={{flex:1,height:2,background:idx>i?"linear-gradient(90deg,#10b981,#34d399)":"rgba(255,255,255,.06)",margin:"0 4px",marginBottom:20,borderRadius:2}}/>}
              </div>);})}
            </div>
          </div>}
          <div style={{background:"#0a1a14",borderRadius:18,padding:"18px 20px",border:"1px solid rgba(52,211,153,.12)"}}>
            <div style={{fontFamily:"'Caveat',cursive",fontSize:14,fontWeight:700,color:"#34d399",marginBottom:14}}>👤 Your Details</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}} className="g2">
              {[{l:"Name",v:found.full_name},{l:"Email",v:found.email},{l:"Phone",v:found.phone},{l:"Position",v:found.position},{l:"Applied",v:new Date(found.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})},{l:"Experience",v:`${found.experience_years} yr${found.experience_years!==1?"s":""}`}].map(x=><div key={x.l} style={{background:"rgba(52,211,153,.04)",borderRadius:10,padding:"10px 13px",border:"1px solid rgba(52,211,153,.08)"}}>
                <div style={{color:"rgba(110,231,183,.45)",fontSize:10,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",marginBottom:3}}>{x.l}</div>
                <div style={{color:"#e2fdf5",fontSize:13,fontWeight:600,wordBreak:"break-word"}}>{x.v||"—"}</div>
              </div>)}
            </div>
          </div>
          <button type="button" onClick={reset} className="btn" style={{background:"transparent",border:"1px solid rgba(52,211,153,.12)",borderRadius:12,padding:"10px",color:"rgba(110,231,183,.45)",fontSize:13,fontWeight:600,cursor:"pointer",textAlign:"center",width:"100%"}}>← Search a different email</button>
        </div>);
      })()}
    </div>
    <Chatbot ctx="status"/>
  </div>);
}

/* ─── ABOUT PAGE ──────────────────────────────────────────────────────── */
function AboutPage(){
  const[mounted,setMounted]=useState(false);
  useEffect(()=>{setTimeout(()=>setMounted(true),80);},[]);
  const vals=[{i:"⚖️",t:"Act Justly — Work with Purpose",d:"We pour intentionality into everything we do, seeking to honor God and people through excellent work."},{i:"💚",t:"Love Mercy — Welcome with Generosity",d:"We extend the heart of Christ through genuine hospitality — creating spaces of warmth and belonging."},{i:"🙏",t:"Walk Humbly — Lead with Grace",d:"We walk alongside others with humility and gratitude, trusting God to use our efforts to build community."}];
  const info=[{i:"💰",l:"Pay",v:"$11–13/hr Barista · Competitive for Shift Lead"},{i:"📅",l:"Hours",v:"10–36 hrs/week · Mon–Sat 6 AM–6 PM"},{i:"📍",l:"Location",v:"2907 McKinney St, STE 100, Melissa TX"},{i:"📞",l:"Contact",v:"(469) 518-1994 · melissa@hopecoffee.com"},{i:"🎂",l:"Requirement",v:"Must be 18 or older"},{i:"☕",l:"Culture",v:"Faith-driven, community-rooted, servant-hearted"}];
  return(<div style={{minHeight:"100%",background:"#040d0a"}}>
    <div style={{position:"relative",padding:"52px 24px 72px",overflow:"hidden",background:"linear-gradient(160deg,#022c22,#065f46 50%,#022c22)",backgroundSize:"400% 400%",animation:"bgFlow 14s ease infinite"}}>
      <div style={{position:"relative",zIndex:2,maxWidth:600,margin:"0 auto"}}>
        <div className={mounted?"fu":""} style={{display:"flex",alignItems:"center",gap:18,marginBottom:24}}>
          <div className="fl" style={{background:"rgba(255,255,255,.12)",borderRadius:20,padding:"12px 14px",border:"1px solid rgba(255,255,255,.18)"}}><Logo s={54}/></div>
          <div><div style={{fontFamily:"'Caveat',cursive",color:"#6ee7b7",fontSize:16,fontWeight:700,marginBottom:2}}>About</div><div style={{fontFamily:"'Playfair Display',serif",fontSize:28,color:"#fff",fontWeight:700}}>Hope Coffee Melissa</div></div>
        </div>
        <h1 className={`ht ${mounted?"fu":""}`} style={{fontFamily:"'Playfair Display',serif",fontSize:44,color:"#fff",fontWeight:800,margin:"0 0 16px",lineHeight:1.08,animationDelay:"60ms"}}>Drink Coffee. Change Lives. ☕</h1>
        <p className={mounted?"fu":""} style={{color:"rgba(110,231,183,.8)",fontSize:15,lineHeight:1.85,maxWidth:480,fontWeight:300,animationDelay:"120ms"}}>Our mission is to bring value and purpose through every cup — serving with hospitality, excellence, and intentionality.</p>
      </div>
    </div>
    <div style={{maxWidth:620,margin:"0 auto",padding:"0 16px 80px"}}>
      <div className={mounted?"si":""} style={{background:"#0a1a14",borderRadius:24,padding:"32px",marginTop:-32,boxShadow:"0 30px 80px rgba(0,0,0,.5)",border:"1px solid rgba(52,211,153,.12)"}}>
        <div style={{fontFamily:"'Caveat',cursive",fontSize:17,fontWeight:700,color:"#34d399",marginBottom:14}}>📋 Quick Info</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:26}} className="g2">
          {info.map(x=><div key={x.l} className="ch" style={{background:"rgba(52,211,153,.04)",borderRadius:14,padding:"14px 16px",border:"1px solid rgba(52,211,153,.08)"}}><div style={{fontSize:20,marginBottom:6}}>{x.i}</div><div style={{color:"rgba(110,231,183,.45)",fontSize:10,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",marginBottom:4}}>{x.l}</div><div style={{color:"#e2fdf5",fontSize:13,fontWeight:600,lineHeight:1.5}}>{x.v}</div></div>)}
        </div>
        <div style={{background:"linear-gradient(135deg,rgba(6,95,70,.4),rgba(2,44,34,.6))",borderRadius:16,padding:"20px 22px",marginBottom:24,border:"1px solid rgba(52,211,153,.15)"}}>
          <div style={{fontFamily:"'Caveat',cursive",fontSize:17,fontWeight:700,color:"#34d399",marginBottom:10}}>Our Mission</div>
          <p style={{color:"rgba(255,255,255,.82)",fontSize:14,lineHeight:1.85,margin:0}}>The culture of Hope Coffee is one of serving. We exist to serve great coffee, our community, our customers, coffee farmers, the church, one another, those in need, and ultimately, Jesus Christ.</p>
        </div>
        <div style={{fontFamily:"'Caveat',cursive",fontSize:17,fontWeight:700,color:"#34d399",marginBottom:14}}>🌿 Team Values</div>
        <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:26}}>
          {vals.map(v=><div key={v.t} className="ch" style={{background:"rgba(52,211,153,.03)",borderRadius:14,padding:"16px 18px",border:"1px solid rgba(52,211,153,.08)"}}><div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}><span style={{fontSize:20}}>{v.i}</span><div style={{fontFamily:"'Playfair Display',serif",fontSize:16,color:"#e2fdf5",fontWeight:700}}>{v.t}</div></div><p style={{color:"rgba(110,231,183,.7)",fontSize:13,lineHeight:1.75,margin:0}}>{v.d}</p></div>)}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:26}} className="g2">
          {[{r:"Barista",p:"$11–13/hr",h:"10–36 hrs/wk",d:"Craft drinks, connect with guests, share the Hope Coffee story."},{r:"Shift Lead",p:"Competitive",h:"Full or Part Time",d:"Run shifts, support the team, uphold our values and standards."}].map(x=><div key={x.r} className="ch" style={{background:"linear-gradient(135deg,rgba(6,95,70,.3),rgba(2,44,34,.5))",borderRadius:14,padding:"16px",border:"1px solid rgba(52,211,153,.15)"}}><div style={{fontFamily:"'Playfair Display',serif",fontSize:18,color:"#fff",fontWeight:700,marginBottom:5}}>{x.r}</div><div style={{color:"#34d399",fontSize:12,fontWeight:600,marginBottom:6}}>{x.p} · {x.h}</div><p style={{color:"rgba(255,255,255,.6)",fontSize:12,lineHeight:1.65,margin:0}}>{x.d}</p></div>)}
        </div>
        <div style={{textAlign:"center",background:"rgba(52,211,153,.05)",borderRadius:16,padding:"22px",border:"1px solid rgba(52,211,153,.12)"}}><div style={{fontSize:36,marginBottom:8}}>🙌</div><h3 style={{fontFamily:"'Playfair Display',serif",fontSize:22,color:"#fff",fontWeight:700,margin:"0 0 8px"}}>Ready to join the family?</h3><p style={{color:"rgba(110,231,183,.7)",fontSize:13,lineHeight:1.7,margin:"0 0 12px"}}>If you're passionate about making a difference with every cup — we'd love to hear from you.</p><div style={{color:"rgba(52,211,153,.55)",fontSize:12}}>(469) 518-1994 · melissa@hopecoffee.com</div></div>
      </div>
    </div>
  </div>);
}

/* ─── MANAGER AUTH GATE ───────────────────────────────────────────────── */
function ManagerAuthGate({onAuth}){
  const[email,setEmail]=useState("");
  const[pass,setPass]=useState("");
  const[show,setShow]=useState(false);
  const[err,setErr]=useState("");
  const[tries,setTries]=useState(0);
  const[locked,setLocked]=useState(false);
  const[timer,setTimer]=useState(0);

  useEffect(()=>{
    if(locked&&timer>0){
      const t=setInterval(()=>setTimer(s=>{if(s<=1){setLocked(false);setTries(0);return 0;}return s-1;}),1000);
      return()=>clearInterval(t);
    }
  },[locked,timer]);

  function tryLogin(){
    if(locked)return;
    const cleanEmail=email.trim().toLowerCase();
    const cleanPass=pass.trim();
    if(ADMIN_SET.has(cleanEmail)&&cleanPass===MGR_PASS){
      onAuth(cleanEmail);
    }else{
      const n=tries+1;setTries(n);setEmail("");setPass("");
      if(!ADMIN_SET.has(cleanEmail))setErr("That email is not authorized.");
      else setErr("Incorrect password. Please try again.");
      if(n>=4){setLocked(true);setTimer(30);setErr("Too many failed attempts. Locked for 30 seconds.");}
    }
  }

  const BG="linear-gradient(165deg,#065f46,#022c22)";
  const disabled=locked||!email.trim()||!pass.trim();
  return(<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",background:"#040d0a"}}>
    <div style={{position:"absolute",inset:0,background:"radial-gradient(ellipse at center,rgba(6,95,70,.18),transparent 70%)",pointerEvents:"none"}}/>
    <div className="si" style={{position:"relative",zIndex:1,background:"#0a1a14",borderRadius:24,padding:"44px 38px",width:"min(400px,calc(100vw - 32px))",boxShadow:"0 30px 80px rgba(0,0,0,.6)",textAlign:"center",border:"1px solid rgba(52,211,153,.12)"}}>
      <div className="fl" style={{width:70,height:70,borderRadius:"50%",background:BG,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 22px",boxShadow:"0 8px 32px rgba(6,95,70,.4)"}}><Logo s={40}/></div>
      <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:26,color:"#fff",fontWeight:700,margin:"0 0 8px"}}>Manager Access</h2>
      <p style={{color:"rgba(110,231,183,.5)",fontSize:13,margin:"0 0 24px",lineHeight:1.65}}>Enter your authorized email and password to access the hiring dashboard.</p>
      <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:16}}>
        <input type="email" value={email} onChange={e=>setEmail(e.target.value.slice(0,200))} onKeyDown={e=>{if(e.key==="Enter")tryLogin();}} placeholder="manager@hopecoffee.com" disabled={locked} style={{width:"100%",background:"rgba(255,255,255,.03)",border:`1.5px solid ${err&&!locked?"rgba(239,68,68,.4)":"rgba(52,211,153,.15)"}`,borderRadius:12,padding:"13px 16px",color:"#e2fdf5",fontSize:14,outline:"none",textAlign:"center"}}/>
        <div style={{position:"relative"}}>
          <input type={show?"text":"password"} value={pass} onChange={e=>setPass(e.target.value.slice(0,100))} onKeyDown={e=>{if(e.key==="Enter")tryLogin();}} placeholder="Password" disabled={locked} style={{width:"100%",background:"rgba(255,255,255,.03)",border:`1.5px solid ${err&&!locked?"rgba(239,68,68,.4)":"rgba(52,211,153,.15)"}`,borderRadius:12,padding:"13px 48px 13px 16px",color:"#e2fdf5",fontSize:14,outline:"none",textAlign:"center"}}/>
          <button type="button" onClick={()=>setShow(s=>!s)} style={{position:"absolute",right:14,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"rgba(110,231,183,.4)",cursor:"pointer",fontSize:16}}>{show?"🙈":"👁️"}</button>
        </div>
      </div>
      <button type="button" onClick={tryLogin} disabled={disabled} className="btn" style={{width:"100%",padding:"14px 24px",borderRadius:12,background:disabled?"rgba(52,211,153,.05)":BG,color:disabled?"rgba(110,231,183,.2)":"#fff",fontSize:15,fontWeight:700,cursor:disabled?"not-allowed":"pointer",marginBottom:14,border:"1px solid rgba(52,211,153,.15)"}}>
        {locked?`Try again in ${timer}s`:"Access Dashboard →"}
      </button>
      {err&&<p style={{color:"#f87171",fontSize:12,margin:0}}>{err}</p>}
    </div>
  </div>);
}

/* ─── MANAGER DASHBOARD ───────────────────────────────────────────────── */
function ManagerDashboard({applicants,onStatusChange,onDelete}){
  const[sel,setSel]=useState(null);
  const[filter,setFilter]=useState("All");
  const[search,setSearch]=useState("");
  const[confirmDel,setConfirmDel]=useState(false);
  const[statusMsg,setStatusMsg]=useState("");
  const[modal,setModal]=useState(false);

  const entry=sel?applicants.find(a=>a.id===sel&&!a.deleted_by_manager):null;
  useEffect(()=>{if(sel&&!applicants.find(a=>a.id===sel&&!a.deleted_by_manager))setSel(null);},[applicants,sel]);

  const vis=applicants.filter(a=>!a.deleted_by_manager);
  const cnts=vis.reduce((a,x)=>{a[x.status]=(a[x.status]||0)+1;return a;},{});
  const filtered=vis.filter(a=>{
    if(filter!=="All"&&a.status!==filter)return false;
    if(search&&!a.full_name.toLowerCase().includes(search.toLowerCase())&&!a.email.toLowerCase().includes(search.toLowerCase()))return false;
    return true;
  });

  const hr=new Date().getHours();
  const greet=hr<12?"Good morning":hr<17?"Good afternoon":"Good evening";
  const BG="linear-gradient(165deg,#065f46,#022c22)";

  async function changeStatus(id,ns){
    const app=applicants.find(a=>a.id===id);
    setStatusMsg("Updating…");
    await onStatusChange(id,ns);
    if(app&&["Interview","Hired","Rejected"].includes(ns)){setStatusMsg("Sending email…");await mailStatus(app,ns);}
    setStatusMsg(`✓ Moved to ${ns}`);
    setTimeout(()=>setStatusMsg(""),3000);
  }

  function downloadResume(e){
    if(!e.resume_base64)return;
    const ext=(e.resume_file_name||"resume.pdf").split(".").pop()||"pdf";
    const mimes={pdf:"application/pdf",doc:"application/msword",docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",txt:"text/plain"};
    const mime=mimes[ext]||e.resume_media_type||"application/octet-stream";
    const bytes=atob(e.resume_base64);
    const ab=new ArrayBuffer(bytes.length);const ia=new Uint8Array(ab);
    for(let i=0;i<bytes.length;i++)ia[i]=bytes.charCodeAt(i);
    const blob=new Blob([ab],{type:mime});const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download=e.resume_file_name||`resume_${e.full_name.replace(/\s/g,"_")}.${ext}`;a.click();URL.revokeObjectURL(url);
  }

  const stats=[{l:"Total",v:vis.length,g:BG},{l:"New",v:cnts.New||0,g:"linear-gradient(165deg,#1d4ed8,#1e3a8a)"},{l:"Interview",v:cnts.Interview||0,g:"linear-gradient(165deg,#b45309,#78350f)"},{l:"Hired",v:cnts.Hired||0,g:"linear-gradient(165deg,#047857,#022c22)"}];

  return(<div className="dl" style={{display:"flex",height:"100%",background:"#040d0a",overflow:"hidden"}}>
    {/* PDF Modal */}
    {modal&&entry&&entry.resume_base64&&(<div onClick={()=>setModal(false)} style={{position:"fixed",inset:0,zIndex:9000,background:"rgba(0,0,0,.88)",display:"flex",alignItems:"center",justifyContent:"center",padding:24,animation:"ovIn .3s ease both"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0a1a14",borderRadius:20,width:"min(800px,100%)",maxHeight:"90vh",overflow:"hidden",border:"1px solid rgba(52,211,153,.2)",display:"flex",flexDirection:"column",animation:"scaleIn .3s cubic-bezier(.34,1.56,.64,1) both"}}>
        <div style={{padding:"16px 20px",borderBottom:"1px solid rgba(52,211,153,.1)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div><div style={{fontFamily:"'Playfair Display',serif",fontSize:17,color:"#fff",fontWeight:700}}>Resume — {entry.full_name}</div><div style={{color:"rgba(110,231,183,.4)",fontSize:12,marginTop:2}}>{entry.resume_file_name}</div></div>
          <div style={{display:"flex",gap:10}}>
            <button type="button" onClick={()=>downloadResume(entry)} className="btn" style={{padding:"8px 16px",borderRadius:10,background:BG,color:"#fff",fontSize:12,fontWeight:700,border:"1px solid rgba(52,211,153,.2)"}}>⬇ Download</button>
            <button type="button" onClick={()=>setModal(false)} className="btn" style={{padding:"8px 14px",borderRadius:10,background:"rgba(255,255,255,.04)",color:"rgba(255,255,255,.6)",fontSize:12,border:"1px solid rgba(255,255,255,.08)"}}>✕ Close</button>
          </div>
        </div>
        <div style={{flex:1,overflow:"auto",padding:20}}>
          {entry.resume_media_type==="application/pdf"
            ?<iframe src={`data:application/pdf;base64,${entry.resume_base64}`} style={{width:"100%",height:"70vh",border:"none",borderRadius:8}} title="Resume"/>
            :<div style={{background:"rgba(255,255,255,.02)",borderRadius:12,padding:20,border:"1px solid rgba(52,211,153,.1)"}}><p style={{color:"#6ee7b7",fontSize:13,marginBottom:14}}>This file type can't be previewed inline. Download to view.</p><button type="button" onClick={()=>downloadResume(entry)} className="btn" style={{padding:"10px 20px",borderRadius:10,background:BG,color:"#fff",fontSize:13,fontWeight:700}}>⬇ Download Resume</button></div>}
        </div>
      </div>
    </div>)}

    {/* Sidebar */}
    <div className="ds" style={{width:300,flexShrink:0,background:"#060f0b",borderRight:"1px solid rgba(52,211,153,.07)",display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{background:"linear-gradient(165deg,#022c22,#065f46,#047857)",padding:"18px 16px",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:11,marginBottom:12}}>
          <div className="fl" style={{background:"rgba(255,255,255,.12)",borderRadius:12,padding:"7px 9px",border:"1px solid rgba(255,255,255,.18)"}}><Logo s={28}/></div>
          <div><div style={{fontFamily:"'Playfair Display',serif",fontSize:16,color:"#fff",fontWeight:700}}>Hire4Hope</div><div style={{fontFamily:"'Caveat',cursive",color:"#6ee7b7",fontSize:12,marginTop:1}}>Manager Dashboard</div></div>
        </div>
        <div style={{background:"rgba(0,0,0,.2)",borderRadius:10,padding:"9px 13px",border:"1px solid rgba(255,255,255,.08)"}}>
          <div style={{fontFamily:"'Caveat',cursive",color:"#a7f3d0",fontSize:14,fontWeight:700}}>{greet}! ☕</div>
          <div style={{color:"rgba(255,255,255,.45)",fontSize:11,marginTop:1}}>{vis.length} applicant{vis.length!==1?"s":""}{cnts.New?` · ${cnts.New} new`:""}</div>
        </div>
      </div>
      {/* Stats */}
      <div style={{padding:"12px",borderBottom:"1px solid rgba(52,211,153,.06)",flexShrink:0}}>
        <div className="sg" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {stats.map((c,i)=><div key={c.l} className="fu" style={{background:c.g,borderRadius:12,padding:"11px 13px",boxShadow:"0 4px 18px rgba(0,0,0,.3)",animationDelay:`${i*55}ms`,border:"1px solid rgba(255,255,255,.06)"}}>
            <div style={{color:"#fff",fontSize:26,fontWeight:800,lineHeight:1}}>{c.v}</div>
            <div style={{color:"rgba(255,255,255,.55)",fontSize:11,marginTop:2,fontWeight:600}}>{c.l}</div>
          </div>)}
        </div>
      </div>
      {/* Search */}
      <div style={{padding:"10px 12px 8px",borderBottom:"1px solid rgba(52,211,153,.06)",flexShrink:0}}>
        <input type="text" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name or email…" style={{width:"100%",background:"rgba(255,255,255,.03)",border:"1px solid rgba(52,211,153,.1)",borderRadius:10,padding:"9px 12px",fontSize:13,color:"#e2fdf5",outline:"none"}}/>
      </div>
      {/* Filters */}
      <div style={{padding:"8px 12px",borderBottom:"1px solid rgba(52,211,153,.06)",flexShrink:0,display:"flex",flexWrap:"wrap",gap:5}}>
        {["All","New","Interview","Hired","Rejected"].map(s=><button key={s} type="button" onClick={()=>setFilter(s)} className="btn" style={{padding:"4px 11px",borderRadius:18,border:`1px solid ${filter===s?"rgba(52,211,153,.4)":"transparent"}`,background:filter===s?"rgba(52,211,153,.12)":"transparent",color:filter===s?"#34d399":"rgba(110,231,183,.4)",fontSize:11,fontWeight:filter===s?700:500}}>
          {s}{s!=="All"&&cnts[s]?` (${cnts[s]})`:""}</button>)}
      </div>
      {/* List */}
      <div style={{flex:1,overflowY:"auto",padding:"8px 10px 12px"}}>
        {filtered.length===0
          ?<p style={{color:"rgba(110,231,183,.25)",fontSize:13,textAlign:"center",padding:"24px 12px"}}>{vis.length===0?"No applications yet.":"No matches found."}</p>
          :filtered.map((a,i)=>{const sg=stG(a.status);const active=sel===a.id;return(
            <button key={a.id} type="button" onClick={()=>setSel(a.id)} className="rh" style={{display:"block",width:"100%",textAlign:"left",padding:"11px 12px",borderRadius:12,cursor:"pointer",marginBottom:5,background:active?"rgba(52,211,153,.08)":"rgba(255,255,255,.02)",border:`1px solid ${active?"rgba(52,211,153,.25)":"rgba(255,255,255,.04)"}`,animation:`slideL .28s ease ${i*28}ms both`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <span style={{color:"#e2fdf5",fontSize:13,fontWeight:700}}>{a.full_name}</span>
                <span style={{background:sg.l,color:sg.c,fontSize:9,fontWeight:700,padding:"2px 8px",borderRadius:16}}>{a.status}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{color:"rgba(110,231,183,.4)",fontSize:11}}>{a.position}</span>
                {a.risk_score&&<span style={{background:sBg(a.risk_score),color:sTxt(a.risk_score),fontSize:10,fontWeight:700,padding:"1px 8px",borderRadius:14}}>★ {a.risk_score}/10</span>}
              </div>
            </button>);})}
      </div>
    </div>

    {/* Detail Panel */}
    <div className="dd" style={{flex:1,overflowY:"auto",padding:"24px 28px"}}>
      {!entry
        ?<div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",gap:12}}>
          <div className="fl" style={{color:"rgba(52,211,153,.12)"}}><svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg></div>
          <p style={{color:"rgba(110,231,183,.2)",fontSize:14,textAlign:"center"}}>{vis.length===0?"No applications yet.":"Select an applicant to review their details."}</p>
        </div>
        :<div key={entry.id} style={{background:"#0a1a14",borderRadius:22,padding:"22px 24px",boxShadow:"0 10px 48px rgba(0,0,0,.35)",animation:"fadeUp .38s ease both",border:"1px solid rgba(52,211,153,.1)"}}>
          {/* Header */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:16,marginBottom:16}}>
            <div style={{display:"flex",gap:14,alignItems:"flex-start",flex:1}}>
              <div style={{width:52,height:52,borderRadius:"50%",background:BG,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:20,fontWeight:800,flexShrink:0,fontFamily:"'Playfair Display',serif"}}>{entry.full_name.charAt(0)}</div>
              <div>
                <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:24,color:"#fff",fontWeight:700,margin:"0 0 6px"}}>{entry.full_name}</h2>
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:4}}>
                  {(()=>{const sg=stG(entry.status);return<span style={{background:sg.g,color:"#fff",fontSize:11,fontWeight:700,padding:"3px 13px",borderRadius:20}}>{entry.status}</span>;})()}
                  <span style={{color:"#34d399",fontSize:12,fontWeight:600,background:"rgba(52,211,153,.08)",padding:"3px 12px",borderRadius:18,border:"1px solid rgba(52,211,153,.15)"}}>{entry.position}</span>
                  {entry.ai_scored&&<span style={{color:"#60a5fa",fontSize:11,fontWeight:600,background:"rgba(96,165,250,.08)",padding:"3px 10px",borderRadius:18,border:"1px solid rgba(96,165,250,.15)"}}>🤖 AI Scored</span>}
                </div>
                <p style={{color:"rgba(110,231,183,.45)",fontSize:12,margin:"0 0 2px"}}>{entry.email} · {entry.phone}</p>
                <p style={{fontFamily:"'Caveat',cursive",color:"rgba(110,231,183,.3)",fontSize:12}}>Applied {new Date(entry.created_at).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}</p>
              </div>
            </div>
            {/* Score circle */}
            {entry.risk_score&&<div style={{textAlign:"center",flexShrink:0}}>
              <div style={{position:"relative",width:76,height:76}}>
                <svg width="76" height="76" viewBox="0 0 76 76" style={{transform:"rotate(-90deg)"}}>
                  <circle cx="38" cy="38" r="30" fill="none" stroke="rgba(255,255,255,.05)" strokeWidth="8"/>
                  <circle cx="38" cy="38" r="30" fill="none" stroke={entry.risk_score>=8?"#10b981":entry.risk_score>=6?"#f59e0b":entry.risk_score>=4?"#f97316":"#ef4444"} strokeWidth="8" strokeDasharray={`${(entry.risk_score/10)*188.5} 188.5`} strokeLinecap="round"/>
                </svg>
                <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                  <span style={{color:sTxt(entry.risk_score),fontSize:20,fontWeight:800,lineHeight:1}}>{entry.risk_score}</span>
                  <span style={{color:"rgba(255,255,255,.3)",fontSize:9,fontWeight:700}}>/10</span>
                </div>
              </div>
              <p style={{fontFamily:"'Caveat',cursive",color:"rgba(110,231,183,.45)",fontSize:11,margin:"4px 0 0",fontWeight:700}}>{sLbl(entry.risk_score)}</p>
            </div>}
          </div>

          {/* AI summary */}
          {entry.ai_summary&&<div style={{background:"rgba(96,165,250,.06)",borderRadius:12,padding:"13px 16px",marginBottom:12,border:"1px solid rgba(96,165,250,.15)"}}>
            <div style={{fontFamily:"'Caveat',cursive",fontSize:13,fontWeight:700,color:"#60a5fa",marginBottom:6}}>🤖 AI Assessment</div>
            <p style={{color:"rgba(96,165,250,.8)",fontSize:13,lineHeight:1.7,margin:0}}>{entry.ai_summary}</p>
          </div>}

          {/* Score breakdown */}
          {entry.score_breakdown?.length>0&&<div style={{background:"rgba(52,211,153,.04)",borderRadius:14,padding:"14px 18px",marginBottom:12,border:"1px solid rgba(52,211,153,.08)"}}>
            <div style={{fontFamily:"'Caveat',cursive",fontSize:13,fontWeight:700,color:"#34d399",marginBottom:12}}>📊 Score Breakdown</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}} className="g2">
              {entry.score_breakdown.map(b=><div key={b.label} style={{background:"rgba(255,255,255,.02)",borderRadius:10,padding:"9px 12px",border:"1px solid rgba(52,211,153,.06)"}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                  <span style={{color:"#e2fdf5",fontSize:11,fontWeight:700}}>{b.label}</span>
                  <span style={{color:"#34d399",fontSize:11,fontWeight:700}}>{b.raw}/10 <span style={{color:"rgba(110,231,183,.3)",fontWeight:400}}>({b.weight}%)</span></span>
                </div>
                <div style={{height:4,borderRadius:2,background:"rgba(255,255,255,.05)",overflow:"hidden"}}><div style={{height:"100%",borderRadius:2,background:`linear-gradient(90deg,${b.raw>=7?"#10b981,#34d399":b.raw>=5?"#f59e0b,#fbbf24":"#ef4444,#fca5a5"})`,width:`${b.raw*10}%`,transition:"width 1s ease"}}/></div>
                {b.reason&&<p style={{color:"rgba(110,231,183,.3)",fontSize:10,margin:"3px 0 0",lineHeight:1.45}}>{b.reason}</p>}
              </div>)}
            </div>
          </div>}

          {/* Resume */}
          {entry.resume_base64
            ?<div style={{background:"rgba(52,211,153,.04)",borderRadius:12,padding:"13px 16px",marginBottom:12,border:"1px solid rgba(52,211,153,.12)"}}>
              <div style={{fontFamily:"'Caveat',cursive",fontSize:13,fontWeight:700,color:"#34d399",marginBottom:10}}>📎 Resume File Uploaded</div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:36,height:36,borderRadius:"50%",background:BG,display:"flex",alignItems:"center",justifyContent:"center"}}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
                  <div><p style={{color:"#e2fdf5",fontSize:13,fontWeight:700,margin:0}}>{entry.resume_file_name||"Resume"}</p><p style={{color:"rgba(110,231,183,.35)",fontSize:11,margin:"2px 0 0"}}>AI read this file for scoring</p></div>
                </div>
                <div style={{display:"flex",gap:8}}>
                  {entry.resume_media_type==="application/pdf"&&<button type="button" onClick={()=>setModal(true)} className="btn" style={{background:"rgba(52,211,153,.08)",border:"1px solid rgba(52,211,153,.2)",borderRadius:10,padding:"7px 14px",color:"#6ee7b7",fontSize:12,fontWeight:700}}>👁 View</button>}
                  <button type="button" onClick={()=>downloadResume(entry)} className="btn" style={{background:BG,border:"1px solid rgba(52,211,153,.25)",borderRadius:10,padding:"7px 14px",color:"#fff",fontSize:12,fontWeight:700}}>⬇ Download</button>
                </div>
              </div>
            </div>
            :entry.resume_text
              ?<div style={{background:"rgba(52,211,153,.03)",borderRadius:12,padding:"13px 16px",marginBottom:12,border:"1px solid rgba(52,211,153,.08)"}}>
                <div style={{fontFamily:"'Caveat',cursive",fontSize:13,fontWeight:700,color:"#34d399",marginBottom:8}}>📋 Resume Summary</div>
                <p style={{color:"rgba(255,255,255,.65)",fontSize:13,lineHeight:1.75,margin:0,whiteSpace:"pre-line"}}>{entry.resume_text}</p>
              </div>
              :null}

          {/* Details */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}} className="g2">
            {[{l:"Experience",v:`${entry.experience_years} yr${entry.experience_years!==1?"s":""}`},{l:"Availability",v:entry.availability}].map(x=><div key={x.l} style={{background:"rgba(52,211,153,.03)",borderRadius:10,padding:"10px 13px",border:"1px solid rgba(52,211,153,.06)"}}>
              <div style={{color:"rgba(110,231,183,.4)",fontSize:10,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",marginBottom:3}}>{x.l}</div>
              <div style={{color:"#e2fdf5",fontSize:13,fontWeight:600}}>{x.v||"—"}</div>
            </div>)}
          </div>
          {[{l:"Background Notes",v:entry.background_notes,e:"📝"},{l:"Online Presence",v:entry.digital_footprint,e:"🔗"}].filter(x=>x.v).map(x=><div key={x.l} style={{background:"rgba(255,255,255,.02)",borderRadius:12,padding:"13px 16px",marginBottom:10,border:"1px solid rgba(255,255,255,.04)"}}>
            <div style={{fontFamily:"'Caveat',cursive",fontSize:13,fontWeight:700,color:"#34d399",marginBottom:6}}>{x.e} {x.l}</div>
            <p style={{color:"rgba(255,255,255,.6)",fontSize:13,lineHeight:1.75,margin:0,whiteSpace:"pre-line"}}>{x.v}</p>
          </div>)}

          {/* Status update */}
          <div style={{background:"rgba(52,211,153,.03)",borderRadius:16,padding:"16px 20px",marginTop:4,border:"1px solid rgba(52,211,153,.08)"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <div style={{fontFamily:"'Caveat',cursive",fontSize:14,fontWeight:700,color:"#34d399"}}>Update Status</div>
              {statusMsg&&<div style={{fontSize:12,color:"#10b981",fontWeight:600,animation:"fadeUp .3s ease both"}}>{statusMsg}</div>}
            </div>
            <div style={{background:"rgba(96,165,250,.05)",borderRadius:10,padding:"9px 13px",marginBottom:12,border:"1px solid rgba(96,165,250,.12)"}}>
              <p style={{color:"rgba(96,165,250,.75)",fontSize:12,margin:0,lineHeight:1.6}}>📧 <strong>Auto-email:</strong> Moving to Interview, Hired, or Rejected automatically emails the applicant.</p>
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>
              {[{l:"Interview",s:"Interview",g:"linear-gradient(165deg,#b45309,#78350f)",sh:"rgba(180,83,9,.35)"},{l:"Hired",s:"Hired",g:"linear-gradient(165deg,#047857,#022c22)",sh:"rgba(4,120,87,.35)"},{l:"Reject",s:"Rejected",g:"linear-gradient(165deg,#b91c1c,#7f1d1d)",sh:"rgba(185,28,28,.35)"},{l:"Reset",s:"New",g:"linear-gradient(165deg,#1d4ed8,#1e3a8a)",sh:"rgba(29,78,216,.35)"}].map(b=>{
                const act=entry.status===b.s;
                return<button key={b.s} type="button" onClick={()=>changeStatus(entry.id,b.s)} disabled={act} className="btn" style={{padding:"9px 16px",borderRadius:10,background:act?"rgba(255,255,255,.04)":b.g,color:act?"rgba(255,255,255,.25)":"#fff",fontSize:12,fontWeight:700,cursor:act?"default":"pointer",boxShadow:act?"none":`0 4px 16px ${b.sh}`,border:`1px solid ${act?"rgba(255,255,255,.05)":"transparent"}`}}>
                  {act?"✓ ":""}{b.l}
                </button>;
              })}
            </div>
            <div style={{borderTop:"1px solid rgba(52,211,153,.06)",paddingTop:12}}>
              {!confirmDel
                ?<button type="button" onClick={()=>setConfirmDel(true)} className="btn" style={{padding:"7px 14px",borderRadius:9,border:"1px solid rgba(239,68,68,.2)",background:"rgba(239,68,68,.04)",color:"rgba(239,68,68,.65)",fontSize:12,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>Delete from View
                </button>
                :<div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                  <p style={{color:"rgba(239,68,68,.65)",fontSize:12,fontWeight:600,margin:0}}>Remove from your dashboard?</p>
                  <div style={{display:"flex",gap:7}}>
                    <button type="button" onClick={()=>{onDelete(entry.id);setSel(null);setConfirmDel(false);}} className="btn" style={{padding:"6px 14px",borderRadius:9,background:"linear-gradient(165deg,#b91c1c,#7f1d1d)",color:"#fff",fontSize:12,fontWeight:700}}>Yes, Delete</button>
                    <button type="button" onClick={()=>setConfirmDel(false)} className="btn" style={{padding:"6px 14px",borderRadius:9,border:"1px solid rgba(52,211,153,.15)",background:"transparent",color:"rgba(110,231,183,.55)",fontSize:12,fontWeight:600}}>Cancel</button>
                  </div>
                </div>}
            </div>
          </div>
        </div>}
    </div>
  </div>);
}

/* ─── ROOT ────────────────────────────────────────────────────────────── */
export default function App(){
  const[page,setPage]=useState("apply");
  const[applicants,setApplicants]=useState([]);
  const[loaded,setLoaded]=useState(false);
  const[mgrEmail,setMgrEmail]=useState(null);

  useEffect(()=>{
    if(EJS_KEY)emailjs.init(EJS_KEY);
    const q=query(collection(db,"applicants"),orderBy("created_at","desc"));
    const unsub=onSnapshot(q,snap=>{setApplicants(snap.docs.map(d=>({id:d.id,...d.data()})));setLoaded(true);},err=>{console.error("Firestore:",err);setLoaded(true);});
    return()=>unsub();
  },[]);

  const addApp=useCallback(async e=>{await addDoc(collection(db,"applicants"),e);},[]);
  const changeSt=useCallback(async(id,ns)=>{await updateDoc(doc(db,"applicants",id),{status:ns});},[]);
  const delApp=useCallback(async id=>{await updateDoc(doc(db,"applicants",id),{deleted_by_manager:true});},[]);

  if(!loaded)return(<div style={{height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#040d0a"}}><style>{CSS}</style><div style={{textAlign:"center",display:"flex",flexDirection:"column",alignItems:"center",gap:16}}><div className="fl"><Logo s={50}/></div><p style={{fontFamily:"'Playfair Display',serif",fontSize:22,color:"#6ee7b7"}}>Loading Hire4Hope…</p><div style={{width:40,height:3,borderRadius:2,background:"rgba(52,211,153,.15)",overflow:"hidden"}}><div style={{height:"100%",background:"linear-gradient(90deg,transparent,#34d399,transparent)",backgroundSize:"200% 100%",animation:"shimmer 1.5s linear infinite"}}/></div></div></div>);

  const navItems=[
    {id:"apply",l:"Apply",ic:<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-2"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>},
    {id:"status",l:"My Status",ic:<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>},
    {id:"about",l:"About",ic:<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>},
  ];

  return(<div style={{height:"100vh",display:"flex",flexDirection:"column"}}>
    <style>{CSS}</style>
    <div style={{flexShrink:0,background:"#060f0b",borderBottom:"1px solid rgba(52,211,153,.07)",padding:"0 20px",display:"flex",alignItems:"center",height:54,gap:4,boxShadow:"0 4px 24px rgba(0,0,0,.3)"}}>
      <button type="button" onClick={()=>setPage("apply")} className="btn" style={{display:"flex",alignItems:"center",gap:9,marginRight:14,background:"none",border:"none",padding:"4px 8px",borderRadius:10,cursor:"pointer"}}>
        <div className="fl"><Logo s={28}/></div>
        <div><div style={{fontFamily:"'Playfair Display',serif",fontSize:15,fontWeight:700,lineHeight:1,background:"linear-gradient(135deg,#34d399,#6ee7b7)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Hire4Hope</div><div style={{fontFamily:"'Caveat',cursive",color:"rgba(52,211,153,.4)",fontSize:10,lineHeight:1,marginTop:1}}>by Hope Coffee Melissa</div></div>
      </button>
      <div style={{width:1,height:20,background:"rgba(52,211,153,.1)",marginRight:8}}/>
      {navItems.map(p=><button key={p.id} type="button" onClick={()=>setPage(p.id)} className="btn" style={{display:"flex",alignItems:"center",gap:6,padding:"6px 14px",borderRadius:10,border:"none",background:page===p.id?"rgba(52,211,153,.08)":"transparent",color:page===p.id?"#34d399":"rgba(52,211,153,.38)",fontSize:13,fontWeight:page===p.id?700:500,cursor:"pointer",borderBottom:`2px solid ${page===p.id?"#34d399":"transparent"}`}}>{p.ic}<span className="nl">{p.l}</span></button>)}
      <button type="button" onClick={()=>setPage("manager")} className="btn" style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:5,padding:"5px 10px",borderRadius:9,border:`1px solid ${page==="manager"?"rgba(52,211,153,.3)":"rgba(52,211,153,.07)"}`,background:page==="manager"?"rgba(52,211,153,.08)":"transparent",color:page==="manager"?"#34d399":"rgba(52,211,153,.2)",fontSize:11,fontWeight:500,cursor:"pointer"}}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        {page==="manager"&&mgrEmail&&<span className="nl" style={{fontSize:11}}>Dashboard</span>}
      </button>
    </div>
    <div style={{flex:1,overflow:page==="manager"?"hidden":"auto"}}>
      {page==="apply"   &&<ApplyPage onSubmit={addApp}/>}
      {page==="status"  &&<StatusPage applicants={applicants.filter(a=>!a.deleted_by_manager)}/>}
      {page==="about"   &&<AboutPage/>}
      {page==="manager" &&(mgrEmail?<ManagerDashboard applicants={applicants} onStatusChange={changeSt} onDelete={delApp} mgrEmail={mgrEmail}/>:<ManagerAuthGate onAuth={e=>setMgrEmail(e)}/>)}
    </div>
  </div>);
}
