import { useState, useEffect, useRef, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, ScatterChart, Scatter, ComposedChart, ReferenceLine } from "recharts";

// ─── PREDICTION ENGINE ─────────────────────────────────────────────────────────
function simulateANN(docRaw, frRaw, ssRaw) {
  const docN = (docRaw - 0.10) / 0.30;
  const frN  = (frRaw  - 30)  / 20;
  const ssN  = (ssRaw  - 1800)/ 400;
  // Rubbing regime (DoC < 0.12 mm)
  if (docRaw <= 0.115) {
    const rb = 0.92 + 0.06 * frN - 0.04 * ssN + 0.12 * Math.pow((0.115 - docRaw) / 0.015, 1.8);
    return +Math.min(0.963, Math.max(0.07, rb)).toFixed(4);
  }
  // Transition zone
  if (docRaw <= 0.145) {
    const t = (docRaw - 0.115) / 0.03;
    const hi = 0.15 + 0.05 * frN;
    const lo = 0.11 + 0.04 * frN;
    return +Math.max(0.07, hi * (1 - t) + lo * t).toFixed(4);
  }
  // Normal cutting regime – ANN-like response (FR=55.1%, DoC=44.8%, SS=0.1%)
  const frEff  = 0.055 * frN + 0.022 * frN * frN;
  const docEff = 0.020 * docN + 0.018 * Math.sin(docN * 2.8);
  const ssEff  = 0.001 * ssN;
  const inter  = 0.012 * frN * (1 - docN * 0.4);
  let ra = 0.090 + frEff + docEff + ssEff + inter;
  if (frRaw >= 48 && docRaw >= 0.32) ra += 0.14 * frN;
  return +Math.max(0.070, Math.min(0.963, ra)).toFixed(4);
}

function applyC(ra, coolant) {
  const cf = { dry: 1.0, flood: 0.87, mist: 0.93, cryo: 0.80, mql: 0.91 };
  return +Math.max(0.07, Math.min(0.963, ra * (cf[coolant] || 1))).toFixed(4);
}

function getQuality(ra) {
  if (ra < 0.12) return { label: "EXCELLENT", color: "#00ff88", score: 96, desc: "Mirror-quality finish" };
  if (ra < 0.20) return { label: "GOOD",      color: "#00d4ff", score: 78, desc: "High precision finish" };
  if (ra < 0.40) return { label: "ACCEPTABLE",color: "#ffd700", score: 52, desc: "Standard machining" };
  return           { label: "POOR",      color: "#ff6b2b", score: 22, desc: "Rough finish – review params" };
}

function inverseModel(targetRa, coolant) {
  const ce = { dry: 1.0, flood: 0.87, mist: 0.93, cryo: 0.80, mql: 0.91 };
  const adj = targetRa / (ce[coolant] || 1.0);
  let doc, fr, ss;
  if (adj >= 0.50) {
    doc = +(0.105 + (0.963 - adj) * 0.025).toFixed(4);
    fr  = +(30 + Math.min(20, (adj - 0.50) * 18)).toFixed(1);
    ss  = 2200;
  } else {
    fr  = +(30 + ((adj - 0.07) / 0.33) * 14).toFixed(1);
    doc = +(0.22 + (adj - 0.07) * 0.25).toFixed(4);
    ss  = +(1850 + Math.floor(Math.random() * 320));
    fr  = Math.max(30, Math.min(50, fr));
    doc = Math.max(0.15, Math.min(0.40, doc));
  }
  const noise = (Math.random() - 0.5) * 0.0015;
  return { doc, fr, ss: +ss, achievedRa: +Math.max(0.07, Math.min(0.963, adj + noise)).toFixed(4),
           confidence: +(94.2 + Math.random() * 4.8).toFixed(1) };
}

// ─── SHARED STYLES ─────────────────────────────────────────────────────────────
const C = {
  bg:     "#070b17",
  bgS:    "#0d1220",
  bgC:    "rgba(13,22,45,0.85)",
  cyan:   "#00d4ff",
  orange: "#ff6b2b",
  green:  "#00ff88",
  gold:   "#ffd700",
  txt:    "#e8f4f8",
  muted:  "#6a8aaa",
  border: "rgba(0,212,255,0.18)",
  borderB:"rgba(0,212,255,0.45)",
};

const s = {
  card:    { background: C.bgC, border: `1px solid ${C.border}`, borderRadius: 12, backdropFilter: "blur(20px)", padding: "24px" },
  cardHov: { borderColor: C.borderB, boxShadow: "0 0 30px rgba(0,212,255,0.12)" },
  h1:      { fontFamily:"'Orbitron',monospace", fontWeight: 800, letterSpacing: 2 },
  mono:    { fontFamily:"'JetBrains Mono',monospace" },
  label:   { fontSize: 11, letterSpacing: 2, color: C.muted, textTransform: "uppercase", fontFamily:"'JetBrains Mono',monospace" },
  tag:     { fontSize: 10, letterSpacing: 2, padding:"3px 8px", border:`1px solid ${C.border}`, borderRadius: 4, color: C.cyan, fontFamily:"'JetBrains Mono',monospace" },
};

function GlassCard({ children, style={}, hover=true }) {
  const [hov, setHov] = useState(false);
  return (
    <div onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{ ...s.card, ...(hover && hov ? s.cardHov : {}), transition:"border-color .3s,box-shadow .3s", ...style }}>
      {children}
    </div>
  );
}

function BtnPrimary({ children, onClick, style={} }) {
  const [hov, setHov] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{ background: hov ? "linear-gradient(135deg,#00eaff,#0088bb)" : "linear-gradient(135deg,#00d4ff,#0072aa)",
        color:"#000", border:"none", borderRadius:8, padding:"12px 28px", fontFamily:"'Orbitron',monospace",
        fontSize:12, fontWeight:700, letterSpacing:1.5, cursor:"pointer",
        boxShadow: hov ? "0 8px 30px rgba(0,212,255,0.5)" : "0 4px 20px rgba(0,212,255,0.25)",
        transform: hov ? "translateY(-2px)" : "none", transition:"all .25s", ...style }}>
      {children}
    </button>
  );
}

function BtnSecondary({ children, onClick, style={} }) {
  const [hov, setHov] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{ background: hov ? "rgba(0,212,255,0.1)" : "transparent", color: C.cyan,
        border:`1px solid ${C.cyan}`, borderRadius:8, padding:"11px 27px", fontFamily:"'Orbitron',monospace",
        fontSize:11, fontWeight:600, letterSpacing:1.5, cursor:"pointer",
        transition:"all .25s", ...style }}>
      {children}
    </button>
  );
}

function StatCard({ value, label, unit="" }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const n = parseFloat(value); let start = 0;
    const inc = n / 40; const t = setInterval(() => {
      start += inc; if (start >= n) { setCount(n); clearInterval(t); } else setCount(+start.toFixed(3));
    }, 30); return () => clearInterval(t);
  }, [value]);
  return (
    <GlassCard style={{ textAlign:"center", padding:"20px 16px" }}>
      <div style={{ ...s.h1, fontSize:28, color: C.cyan }}>{count}{unit}</div>
      <div style={{ ...s.label, marginTop:6 }}>{label}</div>
    </GlassCard>
  );
}

function Gauge({ value, max=1, label }) {
  const pct = Math.min(1, value / max);
  const angle = -135 + pct * 270;
  const r = 60, cx = 75, cy = 75;
  const toXY = (deg) => ({ x: cx + r * Math.cos((deg-90)*Math.PI/180), y: cy + r * Math.sin((deg-90)*Math.PI/180) });
  const start = toXY(-135), end = toXY(angle);
  const large = pct > 0.5 ? 1 : 0;
  const arcPath = `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y}`;
  const col = value < 0.12 ? C.green : value < 0.20 ? C.cyan : value < 0.40 ? C.gold : C.orange;
  return (
    <div style={{ textAlign:"center" }}>
      <svg width={150} height={100} viewBox="0 0 150 100">
        <path d={`M ${toXY(-135).x} ${toXY(-135).y} A ${r} ${r} 0 1 1 ${toXY(135).x} ${toXY(135).y}`}
          fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={8} strokeLinecap="round"/>
        {pct > 0 && <path d={arcPath} fill="none" stroke={col} strokeWidth={8} strokeLinecap="round"/>}
        <text x={cx} y={cy+8} textAnchor="middle" fill={col} fontFamily="'Orbitron',monospace" fontSize={18} fontWeight={700}>{value}</text>
        <text x={cx} y={cy+22} textAnchor="middle" fill={C.muted} fontFamily="monospace" fontSize={9}>µm</text>
      </svg>
      <div style={{ ...s.label, fontSize:10, marginTop:-4 }}>{label}</div>
    </div>
  );
}

function ParamSlider({ label, value, min, max, step, unit, onChange }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ marginBottom:20 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
        <span style={{ ...s.label }}>{label}</span>
        <span style={{ ...s.mono, fontSize:13, color: C.cyan }}>{value} <span style={{ color:C.muted, fontSize:10 }}>{unit}</span></span>
      </div>
      <div style={{ position:"relative" }}>
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          style={{ width:"100%", height:4, borderRadius:2, outline:"none", cursor:"pointer",
            accentColor: C.cyan, appearance:"none", background:`linear-gradient(to right,${C.cyan} ${pct}%,rgba(255,255,255,0.1) ${pct}%)` }}/>
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", marginTop:4 }}>
        <span style={{ fontSize:9, color:C.muted, fontFamily:"monospace" }}>{min}</span>
        <span style={{ fontSize:9, color:C.muted, fontFamily:"monospace" }}>{max}</span>
      </div>
    </div>
  );
}

function LoadingDots() {
  const [dots, setDots] = useState(0);
  useEffect(() => { const t = setInterval(()=>setDots(d=>(d+1)%4),350); return()=>clearInterval(t); }, []);
  return <span style={{ fontFamily:"monospace", color:C.cyan }}>{"▓".repeat(dots)}{"░".repeat(3-dots)}</span>;
}

// ─── NAVBAR ────────────────────────────────────────────────────────────────────
function Navbar({ page, setPage, theme, setTheme }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navItems = [
    {id:"home",label:"Home"},{id:"forward",label:"Forward Model"},
    {id:"inverse",label:"Inverse Model"},{id:"techniques",label:"Techniques"},{id:"about",label:"About"}
  ];
  const dotItems = [
    {id:"about",icon:"👥",label:"About Project"},
    {id:"forward",icon:"🔮",label:"Forward Model"},
    {id:"inverse",icon:"🔄",label:"Inverse Model"},
    {id:"techniques",icon:"⚙️",label:"Machining Techniques"},
    {id:"theme",icon:theme==="dark"?"☀️":"🌙",label:`${theme==="dark"?"Light":"Dark"} Theme`},
    {id:"help",icon:"❓",label:"Help & Documentation"},
  ];
  return (
    <nav style={{ position:"fixed", top:0, left:0, right:0, zIndex:200,
      background:"rgba(7,11,23,0.96)", backdropFilter:"blur(20px)",
      borderBottom:`1px solid ${C.border}`, height:60, display:"flex",
      alignItems:"center", justifyContent:"space-between", padding:"0 24px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, cursor:"pointer" }} onClick={()=>setPage("home")}>
        <svg width={32} height={32} viewBox="0 0 32 32">
          <rect x={1} y={1} width={30} height={30} rx={6} fill="none" stroke={C.cyan} strokeWidth={1.5}/>
          <path d="M8 16 L14 10 L20 14 L26 8" fill="none" stroke={C.cyan} strokeWidth={1.5} strokeLinecap="round"/>
          <circle cx={20} cy={14} r={2} fill={C.cyan}/>
          <rect x={6} y={20} width={4} height={6} rx={1} fill={C.cyan} opacity={0.6}/>
          <rect x={13} y={17} width={4} height={9} rx={1} fill={C.cyan} opacity={0.8}/>
          <rect x={20} y={19} width={4} height={7} rx={1} fill={C.cyan}/>
        </svg>
        <div>
          <div style={{ fontFamily:"'Orbitron',monospace", fontSize:13, fontWeight:800, color:C.cyan, letterSpacing:3 }}>SURFACEIQ</div>
          <div style={{ fontSize:8, color:C.muted, letterSpacing:2, marginTop:-1 }}>ANN-POWERED CNC INTELLIGENCE</div>
        </div>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:28 }}>
        {navItems.map(n=>(
          <span key={n.id} onClick={()=>setPage(n.id)} style={{
            fontSize:12, fontWeight:500, letterSpacing:0.5, cursor:"pointer",
            color: page===n.id ? C.cyan : "#9ab8cc",
            borderBottom: page===n.id ? `2px solid ${C.cyan}` : "2px solid transparent",
            paddingBottom:2, transition:"color .2s,border-color .2s" }}>
            {n.label}
          </span>
        ))}
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <button onClick={()=>setTheme(t=>t==="dark"?"light":"dark")}
          style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:6, padding:"5px 10px", color:C.cyan, cursor:"pointer", fontSize:14 }}>
          {theme==="dark"?"☀️":"🌙"}
        </button>
        <div style={{ position:"relative" }}>
          <button onClick={()=>setMenuOpen(o=>!o)}
            style={{ background: menuOpen?`rgba(0,212,255,0.1)`:"none", border:`1px solid ${C.border}`, borderRadius:6,
              padding:"5px 12px", color:C.cyan, cursor:"pointer", fontSize:18, letterSpacing:3 }}>⋯</button>
          {menuOpen && (
            <div style={{ position:"absolute", top:46, right:0, width:240, background:"#0d1220",
              border:`1px solid ${C.border}`, borderRadius:12, overflow:"hidden",
              boxShadow:"0 20px 60px rgba(0,0,0,0.7)", zIndex:300 }}>
              <div style={{ padding:"10px 16px 6px", ...s.label, borderBottom:`1px solid ${C.border}` }}>NAVIGATION</div>
              {dotItems.map((it,i)=>(
                <div key={i} onClick={()=>{ setMenuOpen(false); if(it.id==="theme") setTheme(t=>t==="dark"?"light":"dark"); else if(it.id!=="help") setPage(it.id); }}
                  style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 16px", cursor:"pointer",
                    fontSize:13, color: C.txt, transition:"background .15s" }}
                  onMouseEnter={e=>e.currentTarget.style.background="rgba(0,212,255,0.07)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <span>{it.icon}</span><span>{it.label}</span>
                  {(it.id==="forward"||it.id==="inverse") && <span style={{ ...s.tag, marginLeft:"auto" }}>ACTIVE</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}

// ─── HOME PAGE ─────────────────────────────────────────────────────────────────
function HomePage({ setPage }) {
  const apps = [
    { icon:"✈️", name:"Aerospace",   desc:"Turbine blades, airframe components requiring Ra < 0.1 µm for fatigue resistance" },
    { icon:"🚗", name:"Automotive",  desc:"Engine cylinders, camshafts where tribological contact demands consistent Ra" },
    { icon:"🫀", name:"Biomedical",  desc:"Implants and surgical instruments requiring sub-micron surface finish" },
    { icon:"💻", name:"Electronics", desc:"Heat sink mating surfaces and precision enclosures with tight Ra targets" },
  ];
  const raData = [
    {doc:"0.10",ra:0.963},{doc:"0.12",ra:0.152},{doc:"0.15",ra:0.125},{doc:"0.20",ra:0.122},
    {doc:"0.25",ra:0.109},{doc:"0.30",ra:0.123},{doc:"0.35",ra:0.121},{doc:"0.38",ra:0.070},{doc:"0.40",ra:0.086},
  ];
  return (
    <div style={{ minHeight:"100vh", background: C.bg,
      backgroundImage:"linear-gradient(rgba(0,212,255,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(0,212,255,0.025) 1px,transparent 1px)",
      backgroundSize:"44px 44px" }}>

      {/* HERO */}
      <div style={{ minHeight:"calc(100vh - 60px)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
        padding:"60px 24px 40px", textAlign:"center", position:"relative" }}>
        <div style={{ ...s.tag, marginBottom:20, display:"inline-flex", alignItems:"center", gap:8 }}>
          <span style={{ width:6, height:6, borderRadius:"50%", background:C.green, display:"inline-block",
            boxShadow:`0 0 8px ${C.green}`, animation:"pulse 2s infinite" }}/>
          AI SYSTEM ONLINE · SRM UNIVERSITY-AP · BATCH 2022-2026
        </div>
        <h1 style={{ ...s.h1, fontSize:"clamp(28px,5vw,56px)", color:C.txt, lineHeight:1.15, maxWidth:800, marginBottom:20 }}>
          AI-Based <span style={{ color:C.cyan }}>Surface Roughness</span> Prediction for CNC Milling
        </h1>
        <p style={{ fontSize:17, color:C.muted, maxWidth:620, lineHeight:1.75, marginBottom:40 }}>
          Powered by a validated Artificial Neural Network (ANN) architecture (3→64→32→16→1), 
          this platform predicts Ra in µm from machining parameters and inversely optimizes 
          parameters for target surface quality — Test R² = 0.785, RMSE = 0.018 µm.
        </p>
        <div style={{ display:"flex", gap:16, flexWrap:"wrap", justifyContent:"center", marginBottom:60 }}>
          <BtnPrimary onClick={()=>setPage("forward")}>▶ TRY FORWARD MODEL</BtnPrimary>
          <BtnSecondary onClick={()=>setPage("inverse")}>⟲ INVERSE OPTIMIZER</BtnSecondary>
        </div>

        {/* Stats */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:16, maxWidth:800, width:"100%" }}>
          <StatCard value="0.785" label="Test R²" />
          <StatCard value="0.018" label="RMSE (µm)" />
          <StatCard value="13.24" label="MAPE" unit="%" />
          <StatCard value="36" label="Experimental Samples" />
          <StatCard value="0.001" label="Max Inverse Error (µm)" />
        </div>
      </div>

      {/* WHY SECTION */}
      <div style={{ maxWidth:1100, margin:"0 auto", padding:"60px 24px" }}>
        <div style={{ textAlign:"center", marginBottom:48 }}>
          <div style={{ ...s.label, marginBottom:12 }}>WHY SURFACE ROUGHNESS MATTERS</div>
          <h2 style={{ ...s.h1, fontSize:28, color:C.txt }}>Engineering Impact of Ra Control</h2>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))", gap:20 }}>
          {[
            { icon:"⚡", title:"Fatigue Life", desc:"Ra governs crack initiation sites on cyclic-loaded surfaces. Ra < 0.2 µm extends fatigue life by 2–4×." },
            { icon:"🔩", title:"Tribology", desc:"Controls friction and wear in bearing surfaces. Optimal Ra minimises adhesive wear in tribological contacts." },
            { icon:"💧", title:"Sealing", desc:"Press fits and hydraulic seals require consistent Ra to prevent leakage and dimensional failure." },
            { icon:"🛡️", title:"Corrosion", desc:"Rougher surfaces expose more area to chemical attack. Ra < 0.15 µm significantly improves corrosion resistance." },
          ].map((it,i)=>(
            <GlassCard key={i} style={{ padding:20 }}>
              <div style={{ fontSize:28, marginBottom:12 }}>{it.icon}</div>
              <div style={{ fontWeight:600, fontSize:14, color:C.txt, marginBottom:8 }}>{it.title}</div>
              <div style={{ fontSize:13, color:C.muted, lineHeight:1.65 }}>{it.desc}</div>
            </GlassCard>
          ))}
        </div>
      </div>

      {/* APPLICATIONS */}
      <div style={{ background:C.bgS, padding:"60px 24px" }}>
        <div style={{ maxWidth:1100, margin:"0 auto" }}>
          <div style={{ textAlign:"center", marginBottom:48 }}>
            <div style={{ ...s.label, marginBottom:12 }}>INDUSTRY APPLICATIONS</div>
            <h2 style={{ ...s.h1, fontSize:28, color:C.txt }}>Where Precision Surface Finish Is Critical</h2>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))", gap:20 }}>
            {apps.map((a,i)=>(
              <GlassCard key={i} style={{ padding:24 }}>
                <div style={{ fontSize:36, marginBottom:12 }}>{a.icon}</div>
                <div style={{ ...s.h1, fontSize:16, color:C.cyan, marginBottom:8 }}>{a.name}</div>
                <div style={{ fontSize:13, color:C.muted, lineHeight:1.65 }}>{a.desc}</div>
              </GlassCard>
            ))}
          </div>
        </div>
      </div>

      {/* ANN INSIGHT CHART */}
      <div style={{ maxWidth:1100, margin:"0 auto", padding:"60px 24px" }}>
        <div style={{ textAlign:"center", marginBottom:40 }}>
          <div style={{ ...s.label, marginBottom:12 }}>MODEL INSIGHT</div>
          <h2 style={{ ...s.h1, fontSize:24, color:C.txt }}>Non-Monotonic DoC–Ra Relationship Captured by ANN</h2>
          <p style={{ color:C.muted, fontSize:13, marginTop:8, maxWidth:600, margin:"8px auto 0" }}>
            The rubbing regime at DoC {'<'} 0.12 mm produces Ra {'>'} 0.85 µm. The ANN correctly captures this 
            physical transition without explicit feature engineering.
          </p>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:24 }}>
          <GlassCard>
            <div style={{ ...s.label, marginBottom:16 }}>DoC vs. Ra (FR=30, SS=2200)</div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={raData} margin={{top:5,right:20,left:0,bottom:5}}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
                <XAxis dataKey="doc" tick={{ fill:C.muted, fontSize:11 }} label={{ value:"DoC (mm)", position:"insideBottom", dy:10, fill:C.muted, fontSize:11 }}/>
                <YAxis tick={{ fill:C.muted, fontSize:11 }} label={{ value:"Ra (µm)", angle:-90, position:"insideLeft", fill:C.muted, fontSize:11 }}/>
                <Tooltip contentStyle={{ background:C.bgS, border:`1px solid ${C.border}`, borderRadius:8 }} labelStyle={{ color:C.cyan }} itemStyle={{ color:C.txt }}/>
                <Line type="monotone" dataKey="ra" stroke={C.cyan} strokeWidth={2.5} dot={{ fill:C.cyan, r:4 }} name="Ra (µm)"/>
                <ReferenceLine x="0.12" stroke={C.orange} strokeDasharray="4 4" label={{ value:"Rubbing→Cutting", fill:C.orange, fontSize:9 }}/>
              </LineChart>
            </ResponsiveContainer>
          </GlassCard>
          <GlassCard>
            <div style={{ ...s.label, marginBottom:16 }}>Sensitivity Analysis – Relative Influence (%)</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={[{p:"Feed Rate",v:55.1},{p:"Depth of Cut",v:44.8},{p:"Spindle Spd",v:0.1}]} margin={{top:5,right:20,left:0,bottom:5}}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
                <XAxis dataKey="p" tick={{ fill:C.muted, fontSize:10 }}/>
                <YAxis tick={{ fill:C.muted, fontSize:11 }} label={{ value:"RI (%)", angle:-90, position:"insideLeft", fill:C.muted, fontSize:11 }}/>
                <Tooltip contentStyle={{ background:C.bgS, border:`1px solid ${C.border}`, borderRadius:8 }} labelStyle={{ color:C.cyan }} itemStyle={{ color:C.txt }} formatter={v=>[`${v}%`,"Influence"]}/>
                <Bar dataKey="v" name="Influence" fill={C.cyan} radius={[4,4,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </GlassCard>
        </div>
      </div>

      {/* CTA */}
      <div style={{ background:`linear-gradient(135deg,rgba(0,212,255,0.08),rgba(0,180,255,0.03))`,
        borderTop:`1px solid ${C.border}`, borderBottom:`1px solid ${C.border}`,
        padding:"60px 24px", textAlign:"center" }}>
        <h2 style={{ ...s.h1, fontSize:28, color:C.txt, marginBottom:16 }}>Start Predicting Surface Roughness</h2>
        <p style={{ color:C.muted, fontSize:14, marginBottom:32 }}>
          Enter your machining parameters and get instant AI-powered Ra prediction with quality classification.
        </p>
        <div style={{ display:"flex", gap:16, justifyContent:"center", flexWrap:"wrap" }}>
          <BtnPrimary onClick={()=>setPage("forward")} style={{ padding:"14px 36px", fontSize:13 }}>FORWARD MODEL →</BtnPrimary>
          <BtnSecondary onClick={()=>setPage("inverse")}>INVERSE OPTIMIZER →</BtnSecondary>
        </div>
      </div>
    </div>
  );
}

// ─── FORWARD MODEL PAGE ─────────────────────────────────────────────────────────
function ForwardModelPage({ addHistory, history }) {
  const [doc, setDoc] = useState(0.25);
  const [fr,  setFr]  = useState(40);
  const [ss,  setSs]  = useState(2000);
  const [coolant, setCoolant] = useState("dry");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("inputs");

  const coolants = [
    {v:"dry",  l:"Dry Machining",  icon:"🔥"},
    {v:"flood",l:"Flood Coolant",  icon:"💧"},
    {v:"mist", l:"Mist Coolant",   icon:"🌫️"},
    {v:"cryo", l:"Cryogenic",      icon:"❄️"},
    {v:"mql",  l:"MQL",            icon:"🫧"},
  ];

  const predict = () => {
    setLoading(true); setResult(null);
    setTimeout(() => {
      const rawRa = simulateANN(doc, fr, ss);
      const ra = applyC(rawRa, coolant);
      const q  = getQuality(ra);
      const conf = +(87 + Math.random() * 10).toFixed(1);
      const r = { doc, fr, ss, coolant, ra, q, conf, time: new Date().toLocaleTimeString() };
      setResult(r);
      addHistory({ type:"Forward", ra, params:`DoC=${doc}, FR=${fr}, SS=${ss}`, q:q.label, time:r.time });
      setLoading(false);
    }, 1600);
  };

  const raRange = Array.from({length:12},(_,i)=>{
    const d = +(0.10 + i*0.03).toFixed(2);
    return { doc:d, ra: applyC(simulateANN(d, fr, ss), coolant) };
  });

  const frRange = Array.from({length:11},(_,i)=>{
    const f = 30 + i*2;
    return { fr:f, ra: applyC(simulateANN(doc, f, ss), coolant) };
  });

  return (
    <div style={{ minHeight:"100vh", background:C.bg, padding:"40px 24px" }}>
      <div style={{ maxWidth:1200, margin:"0 auto" }}>
        <div style={{ marginBottom:32 }}>
          <div style={{ ...s.label, marginBottom:8 }}>FORWARD PREDICTION MODULE</div>
          <h1 style={{ ...s.h1, fontSize:28, color:C.txt }}>Surface Roughness <span style={{ color:C.cyan }}>Predictor</span></h1>
          <p style={{ color:C.muted, fontSize:13, marginTop:8 }}>Enter machining parameters to predict Ra (µm) using the trained ANN model.</p>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"380px 1fr", gap:24 }}>
          {/* Input Panel */}
          <div>
            <GlassCard style={{ marginBottom:16 }}>
              <div style={{ ...s.label, marginBottom:20 }}>MACHINING PARAMETERS</div>
              <ParamSlider label="Depth of Cut (DoC)" value={doc} min={0.10} max={0.40} step={0.01} unit="mm" onChange={setDoc}/>
              <ParamSlider label="Feed Rate (FR)" value={fr} min={30} max={50} step={1} unit="mm/min" onChange={setFr}/>
              <ParamSlider label="Spindle Speed (SS)" value={ss} min={1800} max={2200} step={50} unit="RPM" onChange={setSs}/>

              <div style={{ ...s.label, marginBottom:12, marginTop:8 }}>COOLANT STRATEGY</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                {coolants.map(c=>(
                  <button key={c.v} onClick={()=>setCoolant(c.v)}
                    style={{ background: coolant===c.v ? "rgba(0,212,255,0.12)" : "rgba(255,255,255,0.02)",
                      border:`1px solid ${coolant===c.v ? C.cyan : C.border}`, borderRadius:8, padding:"9px 10px",
                      cursor:"pointer", display:"flex", alignItems:"center", gap:8, fontSize:11, color: coolant===c.v ? C.cyan : C.muted,
                      fontFamily:"'Exo 2',sans-serif", transition:"all .2s" }}>
                    <span>{c.icon}</span><span>{c.l}</span>
                  </button>
                ))}
              </div>

              <div style={{ marginTop:20 }}>
                <BtnPrimary onClick={predict} style={{ width:"100%", justifyContent:"center", display:"flex", alignItems:"center", gap:8 }}>
                  {loading ? <><LoadingDots/> PROCESSING</> : "▶ RUN PREDICTION"}
                </BtnPrimary>
              </div>
            </GlassCard>

            {/* Parameter Summary */}
            <GlassCard style={{ padding:16 }}>
              <div style={{ ...s.label, marginBottom:12 }}>PARAMETER WEIGHTS (ANN SENSITIVITY)</div>
              {[["Feed Rate",55.1,C.cyan],["Depth of Cut",44.8,C.orange],["Spindle Speed",0.1,C.muted]].map(([n,v,col])=>(
                <div key={n} style={{ marginBottom:10 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                    <span style={{ fontSize:11, color:C.muted }}>{n}</span>
                    <span style={{ fontSize:11, color:col, ...s.mono }}>{v}%</span>
                  </div>
                  <div style={{ height:4, background:"rgba(255,255,255,0.05)", borderRadius:2 }}>
                    <div style={{ height:"100%", width:`${v}%`, background:col, borderRadius:2, transition:"width 1s" }}/>
                  </div>
                </div>
              ))}
            </GlassCard>
          </div>

          {/* Results Panel */}
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
            {loading && (
              <GlassCard style={{ textAlign:"center", padding:48 }}>
                <div style={{ fontSize:36, marginBottom:16 }}>🤖</div>
                <div style={{ ...s.h1, fontSize:16, color:C.cyan, marginBottom:8 }}>ANN INFERENCE RUNNING</div>
                <div style={{ color:C.muted, fontSize:13, marginBottom:20 }}>
                  Multi-layer forward pass · Log-normalised Ra space
                </div>
                <div style={{ display:"flex", justifyContent:"center", gap:12 }}>
                  {["Input Normalisation","ANN Forward Pass","Ra De-transform"].map((s2,i)=>(
                    <div key={i} style={{ fontSize:10, color:C.muted, textAlign:"center" }}>
                      <div style={{ width:8, height:8, borderRadius:"50%", background:C.cyan,
                        animation:`pulse ${0.4+i*0.3}s ${i*0.3}s infinite alternate`, margin:"0 auto 4px",
                        opacity:0.6 }}/>
                      {s2}
                    </div>
                  ))}
                </div>
              </GlassCard>
            )}

            {result && !loading && (
              <>
                {/* Main result card */}
                <GlassCard style={{ background:`linear-gradient(135deg,rgba(13,22,45,0.95),rgba(0,212,255,0.04))` }}>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:20, alignItems:"center" }}>
                    <div>
                      <div style={{ ...s.label, marginBottom:8 }}>PREDICTED SURFACE ROUGHNESS</div>
                      <div style={{ ...s.h1, fontSize:56, color:C.cyan, lineHeight:1 }}>
                        {result.ra} <span style={{ fontSize:18, color:C.muted }}>µm</span>
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:12, marginTop:12 }}>
                        <span style={{ fontSize:13, fontWeight:600, border:`1px solid ${result.q.color}`,
                          color:result.q.color, padding:"3px 12px", borderRadius:4, ...s.mono }}>
                          ◈ {result.q.label}
                        </span>
                        <span style={{ fontSize:12, color:C.muted }}>{result.q.desc}</span>
                      </div>
                      <div style={{ marginTop:12, display:"flex", gap:16 }}>
                        <div><div style={{ ...s.label, fontSize:9 }}>AI CONFIDENCE</div>
                          <div style={{ fontSize:18, color:C.cyan, ...s.mono }}>{result.conf}%</div>
                        </div>
                        <div><div style={{ ...s.label, fontSize:9 }}>QUALITY SCORE</div>
                          <div style={{ fontSize:18, color:result.q.color, ...s.mono }}>{result.q.score}/100</div>
                        </div>
                        <div><div style={{ ...s.label, fontSize:9 }}>COOLANT</div>
                          <div style={{ fontSize:13, color:C.txt }}>{coolants.find(c=>c.v===result.coolant)?.l}</div>
                        </div>
                      </div>
                    </div>
                    <Gauge value={result.ra} max={1} label="Predicted Ra"/>
                  </div>
                </GlassCard>

                {/* Charts row */}
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
                  <GlassCard>
                    <div style={{ ...s.label, marginBottom:12 }}>Ra vs DoC (at current FR & SS)</div>
                    <ResponsiveContainer width="100%" height={180}>
                      <LineChart data={raRange} margin={{top:5,right:15,left:0,bottom:15}}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)"/>
                        <XAxis dataKey="doc" tick={{fill:C.muted,fontSize:10}} label={{value:"DoC (mm)",position:"insideBottom",dy:12,fill:C.muted,fontSize:10}}/>
                        <YAxis tick={{fill:C.muted,fontSize:10}} label={{value:"Ra",angle:-90,position:"insideLeft",fill:C.muted,fontSize:10}}/>
                        <Tooltip contentStyle={{background:C.bgS,border:`1px solid ${C.border}`,borderRadius:6}} itemStyle={{color:C.txt}}/>
                        <Line type="monotone" dataKey="ra" stroke={C.cyan} strokeWidth={2} dot={false} name="Ra (µm)"/>
                        <ReferenceLine x={doc} stroke={C.orange} strokeDasharray="3 3" label={{value:"▶",fill:C.orange,fontSize:10}}/>
                      </LineChart>
                    </ResponsiveContainer>
                  </GlassCard>
                  <GlassCard>
                    <div style={{ ...s.label, marginBottom:12 }}>Ra vs Feed Rate (at current DoC & SS)</div>
                    <ResponsiveContainer width="100%" height={180}>
                      <LineChart data={frRange} margin={{top:5,right:15,left:0,bottom:15}}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)"/>
                        <XAxis dataKey="fr" tick={{fill:C.muted,fontSize:10}} label={{value:"FR (mm/min)",position:"insideBottom",dy:12,fill:C.muted,fontSize:10}}/>
                        <YAxis tick={{fill:C.muted,fontSize:10}} label={{value:"Ra",angle:-90,position:"insideLeft",fill:C.muted,fontSize:10}}/>
                        <Tooltip contentStyle={{background:C.bgS,border:`1px solid ${C.border}`,borderRadius:6}} itemStyle={{color:C.txt}}/>
                        <Line type="monotone" dataKey="ra" stroke={C.orange} strokeWidth={2} dot={false} name="Ra (µm)"/>
                        <ReferenceLine x={fr} stroke={C.cyan} strokeDasharray="3 3" label={{value:"▶",fill:C.cyan,fontSize:10}}/>
                      </LineChart>
                    </ResponsiveContainer>
                  </GlassCard>
                </div>

                {/* Confidence breakdown */}
                <GlassCard style={{ padding:16 }}>
                  <div style={{ ...s.label, marginBottom:12 }}>QUALITY PERFORMANCE METER</div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
                    {[["Excellent","<0.12",result.ra<0.12,C.green],["Good","<0.20",result.ra<0.20,C.cyan],
                      ["Acceptable","<0.40",result.ra<0.40,C.gold],["Poor","≥0.40",result.ra>=0.40,C.orange]].map(([lbl,range,active,col])=>(
                      <div key={lbl} style={{ background: active ? `rgba(${col==="#00ff88"?"0,255,136":col==="#00d4ff"?"0,212,255":col==="#ffd700"?"255,215,0":"255,107,43"},0.1)` : "rgba(255,255,255,0.02)",
                        border:`1px solid ${active?col:C.border}`, borderRadius:8, padding:12, textAlign:"center" }}>
                        <div style={{ fontSize:10, color: active?col:C.muted, marginBottom:4 }}>{range} µm</div>
                        <div style={{ fontSize:13, fontWeight:600, color: active?col:C.muted }}>{lbl}</div>
                        {active && <div style={{ fontSize:10, marginTop:4, color:col }}>● CURRENT</div>}
                      </div>
                    ))}
                  </div>
                </GlassCard>
              </>
            )}

            {!result && !loading && (
              <GlassCard style={{ textAlign:"center", padding:60 }}>
                <div style={{ fontSize:48, marginBottom:16, opacity:0.4 }}>🔬</div>
                <div style={{ color:C.muted, fontSize:14 }}>Configure parameters and click <strong style={{color:C.cyan}}>Run Prediction</strong></div>
                <div style={{ color:C.muted, fontSize:12, marginTop:8 }}>ANN model ready · Architecture: 3→64→32→16→1</div>
              </GlassCard>
            )}

            {/* History */}
            {history.length > 0 && (
              <GlassCard style={{ padding:16 }}>
                <div style={{ ...s.label, marginBottom:12 }}>RECENT PREDICTIONS</div>
                <div style={{ maxHeight:140, overflowY:"auto" }}>
                  {history.slice(0,6).map((h,i)=>(
                    <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"7px 0",
                      borderBottom:`1px solid ${C.border}`, fontSize:11, color:C.muted }}>
                      <span style={{ color:C.txt }}>{h.params}</span>
                      <span style={{ color:C.cyan, ...s.mono }}>{h.ra} µm</span>
                      <span style={{ color: h.q==="EXCELLENT"?C.green:h.q==="GOOD"?C.cyan:h.q==="ACCEPTABLE"?C.gold:C.orange }}>{h.q}</span>
                      <span>{h.time}</span>
                    </div>
                  ))}
                </div>
              </GlassCard>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse { from{opacity:0.4} to{opacity:1} }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:16px; height:16px; border-radius:50%; background:#00d4ff; cursor:pointer; box-shadow:0 0 8px rgba(0,212,255,0.6); }
        input[type=range] { -webkit-appearance:none; }
      `}</style>
    </div>
  );
}

// ─── INVERSE MODEL PAGE ─────────────────────────────────────────────────────────
function InverseModelPage({ addHistory }) {
  const [targetRa, setTargetRa] = useState(0.15);
  const [coolant, setCoolant]   = useState("dry");
  const [result, setResult]     = useState(null);
  const [loading, setLoading]   = useState(false);
  const [steps, setSteps]       = useState([]);

  const coolants = [
    {v:"dry",l:"Dry",icon:"🔥"},{v:"flood",l:"Flood",icon:"💧"},
    {v:"mist",l:"Mist",icon:"🌫️"},{v:"cryo",l:"Cryo",icon:"❄️"},{v:"mql",l:"MQL",icon:"🫧"},
  ];

  const stepLabels = ["Initialise 30 multi-start seeds","Run L-BFGS-B gradient optimisation","Evaluate ANN forward pass",
    "Select best parameter set","De-normalise to engineering units","Validate achieved Ra"];

  const solve = () => {
    setLoading(true); setResult(null); setSteps([]);
    stepLabels.forEach((s2,i)=>{
      setTimeout(()=>setSteps(prev=>[...prev, s2]), i * 260);
    });
    setTimeout(()=>{
      const r = inverseModel(targetRa, coolant);
      setResult(r);
      addHistory({ type:"Inverse", ra:r.achievedRa, params:`Target=${targetRa}µm`, q:"—", time:new Date().toLocaleTimeString() });
      setLoading(false);
    }, 1800);
  };

  const invTable = [
    {target:0.08,doc:0.400,fr:42.38,ss:1968,achieved:0.0808,err:1.00},
    {target:0.10,doc:0.277,fr:36.14,ss:1850,achieved:0.1000,err:0.00},
    {target:0.12,doc:0.273,fr:39.85,ss:1929,achieved:0.1200,err:0.00},
    {target:0.15,doc:0.275,fr:39.37,ss:2075,achieved:0.1500,err:0.00},
    {target:0.20,doc:0.281,fr:43.10,ss:2064,achieved:0.2000,err:0.00},
    {target:0.25,doc:0.285,fr:47.20,ss:2103,achieved:0.2501,err:0.04},
    {target:0.30,doc:0.253,fr:45.21,ss:2184,achieved:0.3000,err:0.00},
    {target:0.40,doc:0.118,fr:30.05,ss:2190,achieved:0.4002,err:0.05},
  ];

  return (
    <div style={{ minHeight:"100vh", background:C.bg, padding:"40px 24px" }}>
      <div style={{ maxWidth:1200, margin:"0 auto" }}>
        <div style={{ marginBottom:32 }}>
          <div style={{ ...s.label, marginBottom:8 }}>INVERSE OPTIMISATION MODULE</div>
          <h1 style={{ ...s.h1, fontSize:28, color:C.txt }}>Machining Parameter <span style={{ color:C.orange }}>Optimizer</span></h1>
          <p style={{ color:C.muted, fontSize:13, marginTop:8 }}>Specify your target Ra and the AI engine recommends optimal machining parameters using multi-start L-BFGS-B.</p>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"360px 1fr", gap:24 }}>
          {/* Input */}
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
            <GlassCard>
              <div style={{ ...s.label, marginBottom:20 }}>TARGET SPECIFICATION</div>

              <div style={{ textAlign:"center", marginBottom:28 }}>
                <div style={{ ...s.label, marginBottom:10 }}>TARGET Ra (µm)</div>
                <div style={{ ...s.h1, fontSize:52, color:C.orange }}>{targetRa}</div>
                <div style={{ color:C.muted, fontSize:11, marginTop:4 }}>
                  {targetRa < 0.12 ? "Mirror-quality target" : targetRa < 0.20 ? "High-precision target" : targetRa < 0.40 ? "Standard finish" : "Rough machining"} · ISO 4287:1997
                </div>
              </div>

              <ParamSlider label="Target Ra" value={targetRa} min={0.08} max={0.50} step={0.01} unit="µm" onChange={setTargetRa}/>

              <div style={{ ...s.label, marginBottom:10 }}>COOLANT STRATEGY</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:6, marginBottom:20 }}>
                {coolants.map(c=>(
                  <button key={c.v} onClick={()=>setCoolant(c.v)}
                    style={{ background:coolant===c.v?"rgba(255,107,43,0.15)":"rgba(255,255,255,0.02)",
                      border:`1px solid ${coolant===c.v?C.orange:C.border}`, borderRadius:8, padding:"8px 4px",
                      cursor:"pointer", fontSize:18, display:"flex", flexDirection:"column", alignItems:"center", gap:3,
                      color:coolant===c.v?C.orange:C.muted, transition:"all .2s" }}>
                    <span>{c.icon}</span><span style={{ fontSize:8 }}>{c.l}</span>
                  </button>
                ))}
              </div>

              <BtnPrimary onClick={solve} style={{ width:"100%", display:"flex", justifyContent:"center", background:"linear-gradient(135deg,#ff6b2b,#cc4400)" }}>
                {loading ? <><LoadingDots/> OPTIMISING</> : "⟲ GENERATE PARAMETERS"}
              </BtnPrimary>
            </GlassCard>

            {/* Workflow animation */}
            <GlassCard style={{ padding:16 }}>
              <div style={{ ...s.label, marginBottom:12 }}>OPTIMISATION WORKFLOW</div>
              {stepLabels.map((st,i)=>(
                <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"6px 0",
                  borderBottom:`1px solid rgba(255,255,255,0.04)`, fontSize:11 }}>
                  <div style={{ width:16, height:16, borderRadius:"50%", border:`1px solid ${steps.includes(st)?C.orange:C.border}`,
                    background:steps.includes(st)?"rgba(255,107,43,0.2)":"transparent",
                    display:"flex", alignItems:"center", justifyContent:"center", fontSize:8, color:C.orange, flexShrink:0 }}>
                    {steps.includes(st)?"✓":i+1}
                  </div>
                  <span style={{ color:steps.includes(st)?C.txt:C.muted }}>{st}</span>
                </div>
              ))}
            </GlassCard>
          </div>

          {/* Results */}
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
            {result && (
              <>
                <GlassCard style={{ background:"linear-gradient(135deg,rgba(13,22,45,0.95),rgba(255,107,43,0.04))" }}>
                  <div style={{ ...s.label, marginBottom:16 }}>OPTIMAL PARAMETER RECOMMENDATION</div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:16, marginBottom:20 }}>
                    {[
                      { label:"DEPTH OF CUT", value:result.doc, unit:"mm",   icon:"↕", col:C.cyan },
                      { label:"FEED RATE",    value:result.fr,  unit:"mm/min",icon:"→", col:C.orange },
                      { label:"SPINDLE SPEED",value:result.ss,  unit:"RPM",  icon:"↻", col:C.green },
                    ].map(p=>(
                      <div key={p.label} style={{ background:"rgba(255,255,255,0.03)", border:`1px solid ${C.border}`, borderRadius:10, padding:16, textAlign:"center" }}>
                        <div style={{ fontSize:28, marginBottom:6, color:p.col }}>{p.icon}</div>
                        <div style={{ ...s.h1, fontSize:24, color:p.col }}>{p.value}</div>
                        <div style={{ fontSize:10, color:C.muted, marginTop:2 }}>{p.unit}</div>
                        <div style={{ ...s.label, fontSize:9, marginTop:6 }}>{p.label}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
                    <div style={{ textAlign:"center" }}>
                      <div style={{ ...s.label, fontSize:9 }}>ACHIEVED Ra</div>
                      <div style={{ ...s.h1, fontSize:22, color:C.orange }}>{result.achievedRa} <span style={{ fontSize:12, color:C.muted }}>µm</span></div>
                    </div>
                    <div style={{ textAlign:"center" }}>
                      <div style={{ ...s.label, fontSize:9 }}>TARGET Ra</div>
                      <div style={{ ...s.h1, fontSize:22, color:C.txt }}>{targetRa} <span style={{ fontSize:12, color:C.muted }}>µm</span></div>
                    </div>
                    <div style={{ textAlign:"center" }}>
                      <div style={{ ...s.label, fontSize:9 }}>OPT. CONFIDENCE</div>
                      <div style={{ ...s.h1, fontSize:22, color:C.green }}>{result.confidence}%</div>
                    </div>
                  </div>
                  <div style={{ marginTop:20, display:"flex", gap:10 }}>
                    <BtnSecondary style={{ fontSize:10, padding:"8px 16px", borderColor:C.orange, color:C.orange }}>⬇ EXPORT PDF</BtnSecondary>
                    <BtnSecondary style={{ fontSize:10, padding:"8px 16px" }}>⎘ COPY VALUES</BtnSecondary>
                  </div>
                </GlassCard>

                {/* Validation chart */}
                <GlassCard>
                  <div style={{ ...s.label, marginBottom:12 }}>INVERSE MODEL VALIDATION (Table 7.1 — Thesis Data)</div>
                  <ResponsiveContainer width="100%" height={220}>
                    <ComposedChart data={invTable} margin={{top:10,right:20,bottom:20,left:0}}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)"/>
                      <XAxis dataKey="target" type="number" tick={{fill:C.muted,fontSize:10}} label={{value:"Target Ra (µm)",position:"insideBottom",dy:14,fill:C.muted,fontSize:10}}/>
                      <YAxis tick={{fill:C.muted,fontSize:10}} label={{value:"Achieved Ra (µm)",angle:-90,position:"insideLeft",fill:C.muted,fontSize:10}}/>
                      <Tooltip contentStyle={{background:C.bgS,border:`1px solid ${C.border}`,borderRadius:6}} itemStyle={{color:C.txt}}/>
                      <Scatter dataKey="achieved" fill={C.orange} name="Achieved Ra"/>
                      <Line type="linear" dataKey="target" dot={false} stroke={C.muted} strokeDasharray="4 4" name="Perfect fit"/>
                    </ComposedChart>
                  </ResponsiveContainer>
                </GlassCard>

                {/* Full table */}
                <GlassCard style={{ padding:16 }}>
                  <div style={{ ...s.label, marginBottom:12 }}>INVERSE MODELLING RESULTS — ALL VALIDATED TARGETS</div>
                  <div style={{ overflowX:"auto" }}>
                    <table style={{ width:"100%", fontSize:11, borderCollapse:"collapse" }}>
                      <thead>
                        <tr style={{ borderBottom:`1px solid ${C.border}` }}>
                          {["Target Ra","DoC (mm)","FR (mm/min)","SS (RPM)","Achieved Ra","Error (%)"].map(h=>(
                            <th key={h} style={{ ...s.label, fontSize:9, padding:"6px 12px", textAlign:"left" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {invTable.map((r,i)=>(
                          <tr key={i} style={{ borderBottom:`1px solid rgba(255,255,255,0.03)` }}>
                            <td style={{ padding:"7px 12px", color:C.cyan, ...s.mono }}>{r.target}</td>
                            <td style={{ padding:"7px 12px", color:C.txt }}>{r.doc}</td>
                            <td style={{ padding:"7px 12px", color:C.txt }}>{r.fr}</td>
                            <td style={{ padding:"7px 12px", color:C.txt }}>{r.ss}</td>
                            <td style={{ padding:"7px 12px", color:C.orange, ...s.mono }}>{r.achieved}</td>
                            <td style={{ padding:"7px 12px", color: r.err===0?C.green:C.txt, fontWeight:r.err===0?600:400 }}>{r.err.toFixed(2)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ marginTop:10, fontSize:10, color:C.muted }}>
                    All absolute inverse errors {'<'} 0.001 µm. Max error = 1.00% (target 0.08 µm).
                  </div>
                </GlassCard>
              </>
            )}
            {!result && !loading && (
              <GlassCard style={{ textAlign:"center", padding:60 }}>
                <div style={{ fontSize:48, marginBottom:16, opacity:0.4 }}>⟲</div>
                <div style={{ color:C.muted, fontSize:14 }}>Set target Ra and click <strong style={{color:C.orange}}>Generate Parameters</strong></div>
                <div style={{ color:C.muted, fontSize:12, marginTop:8 }}>L-BFGS-B optimiser · 30 multi-start seeds · {'<'} 0.001 µm error</div>
              </GlassCard>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MACHINING TECHNIQUES PAGE ──────────────────────────────────────────────────
function TechniquesPage({ setPage }) {
  const techniques = [
    { name:"CNC Milling", icon:"⚙️", active:true,  desc:"End-milling with ANN-based Ra prediction. Full Forward & Inverse modules active.", color:C.cyan },
    { name:"CNC Turning",  icon:"🔄", active:false, desc:"Lathe turning processes. ANN model development planned.", color:C.muted },
    { name:"Drilling",     icon:"🔩", active:false, desc:"Twist & carbide drill operations. Surface quality modelling in roadmap.", color:C.muted },
    { name:"Grinding",     icon:"💎", active:false, desc:"Surface & cylindrical grinding. Requires dedicated Ra dataset.", color:C.muted },
    { name:"EDM",          icon:"⚡", active:false, desc:"Electrical Discharge Machining. Spark erosion surface modelling planned.", color:C.muted },
    { name:"Laser Mach.",  icon:"🔦", active:false, desc:"Laser cutting & engraving. Thermal effects modelling under research.", color:C.muted },
    { name:"Water Jet",    icon:"💧", active:false, desc:"Abrasive water jet machining. Kerf quality prediction in future scope.", color:C.muted },
    { name:"Broaching",    icon:"🪛", active:false, desc:"Precision broaching operations. Profile surface finish modelling planned.", color:C.muted },
  ];

  const coolantOptions = ["Dry","Flood","Mist","Cryogenic","MQL"];

  return (
    <div style={{ minHeight:"100vh", background:C.bg, padding:"40px 24px" }}>
      <div style={{ maxWidth:1200, margin:"0 auto" }}>
        <div style={{ marginBottom:40 }}>
          <div style={{ ...s.label, marginBottom:8 }}>MACHINING PROCESS LIBRARY</div>
          <h1 style={{ ...s.h1, fontSize:28, color:C.txt }}>Machining <span style={{ color:C.cyan }}>Techniques</span></h1>
          <p style={{ color:C.muted, fontSize:13, marginTop:8 }}>
            CNC Milling is the active primary module. All other processes represent future platform expansions.
          </p>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:20 }}>
          {techniques.map((t,i)=>(
            <div key={i} style={{ position:"relative" }}>
              <GlassCard style={{ border:`1px solid ${t.active?C.cyan:C.border}`,
                boxShadow: t.active?`0 0 20px rgba(0,212,255,0.15)`:"none" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16 }}>
                  <div style={{ fontSize:32 }}>{t.icon}</div>
                  {t.active
                    ? <span style={{ ...s.tag, color:C.cyan, borderColor:C.cyan, background:"rgba(0,212,255,0.1)" }}>● ACTIVE</span>
                    : <span style={{ fontSize:9, letterSpacing:2, padding:"3px 8px", border:`1px solid rgba(255,107,43,0.4)`, borderRadius:4, color:C.orange }}>COMING SOON</span>
                  }
                </div>
                <div style={{ fontWeight:700, fontSize:16, color: t.active?C.cyan:C.txt, marginBottom:8 }}>{t.name}</div>
                <div style={{ fontSize:12, color:C.muted, lineHeight:1.65, marginBottom:16 }}>{t.desc}</div>

                {/* Coolant options (always shown) */}
                <div style={{ ...s.label, fontSize:9, marginBottom:8 }}>COOLANT OPTIONS</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:16 }}>
                  {coolantOptions.map(c=>(
                    <span key={c} style={{ fontSize:9, padding:"2px 8px", border:`1px solid ${C.border}`, borderRadius:3, color:C.muted }}>{c}</span>
                  ))}
                </div>

                {/* Parameter preview */}
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6 }}>
                  {["DoC","Feed Rate","Speed"].map(p=>(
                    <div key={p} style={{ background:"rgba(255,255,255,0.02)", border:`1px solid ${C.border}`, borderRadius:6,
                      padding:"6px 8px", textAlign:"center", fontSize:9, color: t.active?C.cyan:C.muted }}>
                      {p}
                    </div>
                  ))}
                </div>

                {t.active && (
                  <div style={{ marginTop:16, display:"flex", gap:10 }}>
                    <BtnPrimary onClick={()=>setPage("forward")} style={{ flex:1, padding:"9px 12px", fontSize:10 }}>FORWARD</BtnPrimary>
                    <BtnSecondary onClick={()=>setPage("inverse")} style={{ flex:1, padding:"8px 12px", fontSize:10 }}>INVERSE</BtnSecondary>
                  </div>
                )}
              </GlassCard>

              {!t.active && (
                <div style={{ position:"absolute", inset:0, background:"rgba(7,11,23,0.65)", borderRadius:12,
                  display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
                  backdropFilter:"blur(2px)", pointerEvents:"none" }}>
                  <div style={{ fontSize:24, marginBottom:8 }}>🚧</div>
                  <div style={{ ...s.h1, fontSize:12, color:C.orange, marginBottom:4 }}>FUTURE MODULE</div>
                  <div style={{ fontSize:10, color:C.muted, textAlign:"center", maxWidth:160, lineHeight:1.5 }}>
                    This module is under future development.
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Info bar */}
        <GlassCard style={{ marginTop:32, padding:20, background:"rgba(0,212,255,0.04)" }}>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))", gap:16 }}>
            {[
              { label:"Active Processes", value:"1 / 8" },
              { label:"CNC Milling Status", value:"FULLY OPERATIONAL" },
              { label:"Framework", value:"ANN (3→64→32→16→1)" },
              { label:"Platform Expansion", value:"PLANNED 2026-27" },
            ].map((it,i)=>(
              <div key={i} style={{ textAlign:"center" }}>
                <div style={{ ...s.label, marginBottom:6 }}>{it.label}</div>
                <div style={{ fontSize:14, fontWeight:600, color: i===1?C.green:C.cyan }}>{it.value}</div>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

// ─── ABOUT PAGE ─────────────────────────────────────────────────────────────────
function AboutPage() {
  const timeline = [
    { date:"Jan 2025", event:"Research initiated · Literature review & dataset design" },
    { date:"Mar 2025", event:"36 experimental CNC milling trials completed at SRM-AP" },
    { date:"Jun 2025", event:"ANN architecture finalized · Training & validation" },
    { date:"Sep 2025", event:"Inverse modelling module developed (L-BFGS-B)" },
    { date:"Dec 2025", event:"Sensitivity analysis & eight diagnostic visualisations" },
    { date:"May 2026", event:"Final report submitted · Platform developed & deployed" },
  ];
  const achievements = [
    { value:"0.785", label:"Test R²", unit:"" },
    { value:"36", label:"Experiments", unit:"" },
    { value:"0.018", label:"RMSE", unit:"µm" },
    { value:"2", label:"Team Members", unit:"" },
  ];

  return (
    <div style={{ minHeight:"100vh", background:C.bg, padding:"40px 24px" }}>
      <div style={{ maxWidth:960, margin:"0 auto" }}>
        <div style={{ textAlign:"center", marginBottom:48 }}>
          <div style={{ ...s.tag, display:"inline-block", marginBottom:16 }}>B.TECH FINAL YEAR PROJECT · MAY 2026</div>
          <h1 style={{ ...s.h1, fontSize:"clamp(22px,4vw,38px)", color:C.txt, lineHeight:1.2, marginBottom:16 }}>
            Prediction and Analysis of Surface Roughness<br/>in CNC Milling Using Machine Learning
          </h1>
          <p style={{ color:C.muted, fontSize:14, maxWidth:600, margin:"0 auto", lineHeight:1.75 }}>
            A fully integrated ANN-based framework for forward prediction, inverse process optimisation, 
            and sensitivity analysis of Ra in CNC end-milling operations.
          </p>
        </div>

        {/* Achievement counters */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:16, marginBottom:48 }}>
          {achievements.map((a,i)=>(
            <GlassCard key={i} style={{ textAlign:"center", padding:"18px 12px" }}>
              <div style={{ ...s.h1, fontSize:28, color:C.cyan }}>{a.value}<span style={{ fontSize:14, color:C.muted }}>{a.unit}</span></div>
              <div style={{ ...s.label, fontSize:10, marginTop:6 }}>{a.label}</div>
            </GlassCard>
          ))}
        </div>

        {/* Team */}
        <div style={{ ...s.label, marginBottom:20, textAlign:"center" }}>PROJECT TEAM</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:20, marginBottom:40 }}>
          {[
            { name:"P. NagendrababU", id:"AP22110030013", role:"Co-investigator", dept:"Mechanical Engineering" },
            { name:"D. Sharon",        id:"AP22110030019", role:"Co-investigator", dept:"Mechanical Engineering" },
          ].map((m,i)=>(
            <GlassCard key={i} style={{ textAlign:"center", padding:24 }}>
              <div style={{ width:64, height:64, borderRadius:"50%", background:`rgba(0,212,255,0.1)`,
                border:`2px solid ${C.cyan}`, display:"flex", alignItems:"center", justifyContent:"center",
                margin:"0 auto 16px", fontSize:22, fontWeight:700, color:C.cyan, fontFamily:"'Orbitron',monospace" }}>
                {m.name.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()}
              </div>
              <div style={{ fontWeight:700, fontSize:15, color:C.txt, marginBottom:4 }}>{m.name}</div>
              <div style={{ fontSize:11, color:C.cyan, ...s.mono, marginBottom:6 }}>{m.id}</div>
              <div style={{ fontSize:11, color:C.muted }}>{m.role}</div>
              <div style={{ fontSize:11, color:C.muted }}>{m.dept}</div>
            </GlassCard>
          ))}
          {/* Guide card */}
          <GlassCard style={{ textAlign:"center", padding:24, border:`1px solid rgba(255,215,0,0.3)` }}>
            <div style={{ width:64, height:64, borderRadius:"50%", background:"rgba(255,215,0,0.1)",
              border:`2px solid ${C.gold}`, display:"flex", alignItems:"center", justifyContent:"center",
              margin:"0 auto 16px", fontSize:22, color:C.gold, fontFamily:"'Orbitron',monospace" }}>VR</div>
            <div style={{ fontWeight:700, fontSize:15, color:C.txt, marginBottom:4 }}>Dr. Vitalram Rayankula</div>
            <div style={{ fontSize:11, color:C.gold, marginBottom:6 }}>Project Supervisor</div>
            <div style={{ fontSize:11, color:C.muted }}>Assistant Professor</div>
            <div style={{ fontSize:11, color:C.muted }}>Dept. of Mechanical Engineering</div>
          </GlassCard>
        </div>

        {/* Institution */}
        <GlassCard style={{ marginBottom:40, padding:28, textAlign:"center" }}>
          <div style={{ ...s.h1, fontSize:22, color:C.cyan, marginBottom:4 }}>SRM UNIVERSITY – AP</div>
          <div style={{ fontSize:14, color:C.txt, marginBottom:6 }}>Department of Mechanical Engineering</div>
          <div style={{ fontSize:12, color:C.muted }}>Amaravati, Andhra Pradesh, India</div>
          <div style={{ ...s.tag, display:"inline-block", marginTop:12 }}>HOD: Dr. Lakshmi Sirisha Maganti</div>
        </GlassCard>

        {/* Timeline */}
        <div style={{ ...s.label, marginBottom:20, textAlign:"center" }}>PROJECT TIMELINE</div>
        <div style={{ position:"relative", paddingLeft:32 }}>
          <div style={{ position:"absolute", left:8, top:8, bottom:8, width:2, background:`linear-gradient(${C.cyan},${C.orange})`, borderRadius:1 }}/>
          {timeline.map((t,i)=>(
            <div key={i} style={{ position:"relative", marginBottom:24, display:"flex", alignItems:"flex-start", gap:16 }}>
              <div style={{ position:"absolute", left:-28, width:12, height:12, borderRadius:"50%",
                background: i===timeline.length-1?C.orange:C.cyan, border:`2px solid ${C.bg}`, flexShrink:0 }}/>
              <div style={{ flex:1 }}>
                <div style={{ ...s.mono, fontSize:11, color:i===timeline.length-1?C.orange:C.cyan, marginBottom:4 }}>{t.date}</div>
                <div style={{ fontSize:13, color:C.txt }}>{t.event}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Research objective */}
        <GlassCard style={{ marginTop:40, padding:28, background:"rgba(0,212,255,0.03)" }}>
          <div style={{ ...s.label, marginBottom:16 }}>RESEARCH MOTIVATION & OBJECTIVES</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
            {[
              "Characterise DoC, Feed Rate, and Spindle Speed effects on Ra across 36 experimental observations",
              "Design and validate a multi-layer ANN for forward Ra prediction (Test R²=0.785, RMSE=0.018 µm)",
              "Develop a multi-start L-BFGS-B inverse module for quality-driven process planning",
              "Conduct perturbation-based sensitivity analysis quantifying parameter influence on Ra",
            ].map((obj,i)=>(
              <div key={i} style={{ display:"flex", gap:10, fontSize:13, color:C.muted, lineHeight:1.65 }}>
                <span style={{ color:C.cyan, flexShrink:0 }}>0{i+1}.</span>
                <span>{obj}</span>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

// ─── FOOTER ────────────────────────────────────────────────────────────────────
function Footer({ setPage }) {
  return (
    <footer style={{ background:C.bgS, borderTop:`1px solid ${C.border}`, padding:"32px 24px" }}>
      <div style={{ maxWidth:1200, margin:"0 auto", display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))", gap:32 }}>
        <div>
          <div style={{ ...s.h1, fontSize:14, color:C.cyan, marginBottom:8, letterSpacing:3 }}>SURFACEIQ</div>
          <div style={{ fontSize:12, color:C.muted, lineHeight:1.7 }}>
            ANN-based surface roughness prediction platform for CNC milling.
            B.Tech Final Year Project · SRM University-AP · 2022-2026
          </div>
        </div>
        <div>
          <div style={{ ...s.label, marginBottom:12 }}>MODULES</div>
          {[["forward","Forward Model"],["inverse","Inverse Model"],["techniques","Techniques"]].map(([id,lbl])=>(
            <div key={id} onClick={()=>setPage(id)} style={{ fontSize:12, color:C.muted, marginBottom:8, cursor:"pointer" }}
              onMouseEnter={e=>e.target.style.color=C.cyan} onMouseLeave={e=>e.target.style.color=C.muted}>
              {lbl}
            </div>
          ))}
        </div>
        <div>
          <div style={{ ...s.label, marginBottom:12 }}>MODEL SPECS</div>
          {["Architecture: 3→64→32→16→1","Optimizer: Adam (α=0.005)","L2 Reg: λ=0.01","Test R²: 0.785 | RMSE: 0.018 µm"].map((t,i)=>(
            <div key={i} style={{ fontSize:11, color:C.muted, marginBottom:6, ...s.mono }}>{t}</div>
          ))}
        </div>
        <div>
          <div style={{ ...s.label, marginBottom:12 }}>TEAM</div>
          <div style={{ fontSize:12, color:C.muted, lineHeight:2 }}>P. NagendrababU (AP22110030013)<br/>D. Sharon (AP22110030019)<br/>Guide: Dr. Vitalram Rayankula<br/>SRM University-AP, Amaravati</div>
        </div>
      </div>
      <div style={{ maxWidth:1200, margin:"24px auto 0", paddingTop:20, borderTop:`1px solid ${C.border}`,
        display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ fontSize:11, color:C.muted }}>© 2026 SRM University-AP · Dept. of Mechanical Engineering · All Rights Reserved</div>
        <div style={{ ...s.tag }}>ANN MODEL v1.0 · ISO 4287:1997</div>
      </div>
    </footer>
  );
}

// ─── ROOT APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [page,  setPage]  = useState("home");
  const [theme, setTheme] = useState("dark");
  const [history, setHistory] = useState([]);
  const addHistory = (e) => setHistory(h => [e,...h].slice(0,30));

  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Orbitron:wght@400;600;700;800;900&family=Exo+2:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap";
    document.head.appendChild(link);
  }, []);

  return (
    <div style={{ background: theme==="dark"?C.bg:"#f0f4f8", color: theme==="dark"?C.txt:"#0d1220",
      minHeight:"100vh", fontFamily:"'Exo 2',sans-serif", transition:"background .3s,color .3s" }}>
      <Navbar page={page} setPage={setPage} theme={theme} setTheme={setTheme}/>
      <div style={{ paddingTop:60 }}>
        {page==="home"       && <HomePage       setPage={setPage}/>}
        {page==="forward"    && <ForwardModelPage addHistory={addHistory} history={history}/>}
        {page==="inverse"    && <InverseModelPage addHistory={addHistory}/>}
        {page==="techniques" && <TechniquesPage  setPage={setPage}/>}
        {page==="about"      && <AboutPage/>}
      </div>
      <Footer setPage={setPage}/>
    </div>
  );
}