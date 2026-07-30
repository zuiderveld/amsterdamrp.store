import fs from "fs";

const file = new URL("../public/assets/index-ChlEB3UH.js", import.meta.url);
let s = fs.readFileSync(file, "utf8");

const start = s.indexOf('const Rn=[{key:"coins"');
if (start < 0) {
  console.error("leaderboard start not found");
  process.exit(1);
}
const endMarker = 'const $o="modulepreload"';
const end = s.indexOf(endMarker, start);
if (end < 0) {
  console.error("leaderboard end not found");
  process.exit(1);
}

const replacement = `const Rn=[{key:"coins",label:"Coins",unit:"coins"},{key:"spent",label:"Uitgegeven",unit:"eur"}];
const In=["#3b82f6","#8b5cf6","#f59e0b","#10b981","#ef4444","#ec4899"];
function arpFmt(v,unit){
  const n=Number(v)||0;
  if(unit==="eur")return"€"+n.toLocaleString("nl-NL",{minimumFractionDigits:2,maximumFractionDigits:2});
  return n.toLocaleString("nl-NL");
}
function arpInitial(name){return((String(name||"?").trim().charAt(0)||"?").toUpperCase())}
function arpColor(name){return In[(String(name||"").length)%In.length]}
function arpAvatar(name,size){
  const c=arpColor(name);
  return e.jsx("div",{className:size+" rounded-full flex items-center justify-center shrink-0 font-bold",style:{background:c+"22",border:"1px solid "+c+"66",color:c},children:arpInitial(name)});
}
function Bo({rows:t,unit:r}){
  if(!t.length)return e.jsx("div",{className:"rounded-xl border border-border bg-card/60 p-8 text-center text-sm text-foreground/50",children:"Nog geen spelers op dit leaderboard."});
  const top=t.slice(0,3);
  const rest=t.slice(3);
  const slot=(row,rank,height)=>{
    if(!row)return e.jsx("div",{className:"flex-1"});
    const medal=rank===1?"👑":rank===2?"🥈":"🥉";
    const block=rank===1?"from-yellow-500/80 to-amber-700/70 shadow-[0_0_40px_rgba(234,179,8,.18)]":rank===2?"from-slate-300/50 to-slate-600/50":"from-orange-600/60 to-amber-900/50";
    return e.jsxs("div",{className:"flex-1 flex flex-col items-center justify-end gap-3",children:[
      e.jsx("div",{className:"text-2xl leading-none",children:medal}),
      arpAvatar(row.name,rank===1?"w-16 h-16 text-lg":"w-12 h-12 text-sm"),
      e.jsx("div",{className:"text-sm font-semibold truncate max-w-full px-1",children:row.name}),
      e.jsx("div",{className:"text-blue-400 font-mono font-bold text-sm",children:arpFmt(row.value,r)}),
      e.jsx("div",{className:\`w-full rounded-t-xl bg-gradient-to-b \${block} \${height} border border-white/10\`})
    ]});
  };
  return e.jsxs("div",{className:"flex flex-col gap-8",children:[
    e.jsxs("div",{className:"flex items-end justify-center gap-3 sm:gap-5 pt-4 min-h-[280px]",children:[
      slot(top[1],2,"h-28 sm:h-32"),
      slot(top[0],1,"h-40 sm:h-48"),
      slot(top[2],3,"h-24 sm:h-28")
    ]}),
    rest.length?e.jsx("div",{className:"rounded-xl border border-border bg-card/60 divide-y divide-border overflow-hidden",children:rest.map((i,a)=>{
      const rank=a+4;
      return e.jsxs("div",{className:"flex items-center gap-4 px-4 py-3",children:[
        e.jsxs("div",{className:"w-8 text-sm font-mono text-foreground/45",children:["#",rank]}),
        arpAvatar(i.name,"w-10 h-10 text-sm"),
        e.jsxs("div",{className:"flex-1 min-w-0",children:[
          e.jsx("div",{className:"text-sm font-semibold truncate",children:i.name||"Onbekend"}),
          e.jsx("div",{className:"text-xs font-mono text-blue-400/90",children:arpFmt(i.value,r)})
        ]})
      ]},rank);
    })}):null
  ]});
}
function Wo(){
  const t=Wr();
  const[r,i]=g.useState("coins");
  g.useEffect(()=>{document.title="Leaderboard | Amsterdam Roleplay"},[]);
  return e.jsxs("div",{className:"container w-full min-w-0 flex-1 py-10 max-w-4xl mx-auto",children:[
    e.jsxs("div",{className:"flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4",children:[
      e.jsxs("div",{className:"flex flex-col gap-2",children:[
        e.jsxs("h1",{className:"text-3xl font-bold tracking-tight sm:text-4xl flex items-center gap-3",children:[
          e.jsx("span",{className:"text-yellow-400 text-3xl",children:"🏆"}),
          "Leaderboard"
        ]}),
        e.jsx("p",{className:"text-foreground/65 text-sm",children:"Wie heeft de meeste coins verdiend en uitgegeven."})
      ]}),
      e.jsx("div",{className:"inline-flex items-center rounded-full border border-border/60 bg-muted/40 p-1 w-fit",children:Rn.map(a=>e.jsx("button",{type:"button",onClick:()=>i(a.key),className:\`px-4 py-1.5 text-sm font-semibold rounded-full transition-all \${r===a.key?"bg-blue-500 text-white shadow":"text-foreground/55 hover:text-foreground"}\`,children:a.label},a.key))})
    ]}),
    e.jsx("div",{className:"mt-8",children:t?e.jsx(Bo,{rows:t[r]??[],unit:Rn.find(a=>a.key===r).unit}):e.jsx("div",{className:"rounded-xl border border-border bg-card/60 p-8 text-center text-sm text-foreground/50",children:"Laden…"})})
  ]});
}
`;

// The replacement uses template literals with escaped backticks for className - but we're in a JS file writing a string.
// Simpler: use string concatenation in the replacement without nested template literals.

const replacement2 = `const Rn=[{key:"coins",label:"Coins",unit:"coins"},{key:"spent",label:"Uitgegeven",unit:"eur"}];
const In=["#3b82f6","#8b5cf6","#f59e0b","#10b981","#ef4444","#ec4899"];
function arpFmt(v,unit){const n=Number(v)||0;return unit==="eur"?"€"+n.toLocaleString("nl-NL",{minimumFractionDigits:2,maximumFractionDigits:2}):n.toLocaleString("nl-NL")}
function arpInitial(name){return((String(name||"?").trim().charAt(0)||"?").toUpperCase())}
function arpColor(name){return In[(String(name||"").length)%In.length]}
function arpAvatar(name,size){const c=arpColor(name);return e.jsx("div",{className:size+" rounded-full flex items-center justify-center shrink-0 font-bold",style:{background:c+"22",border:"1px solid "+c+"66",color:c},children:arpInitial(name)})}
function Bo({rows:t,unit:r}){if(!t.length)return e.jsx("div",{className:"rounded-xl border border-border bg-card/60 p-8 text-center text-sm text-foreground/50",children:"Nog geen spelers op dit leaderboard."});const top=t.slice(0,3),rest=t.slice(3);const slot=(row,rank,height)=>{if(!row)return e.jsx("div",{className:"flex-1"});const medal=rank===1?"👑":rank===2?"🥈":"🥉";const block=rank===1?"from-yellow-500/80 to-amber-700/70 shadow-[0_0_40px_rgba(234,179,8,.18)]":rank===2?"from-slate-300/50 to-slate-600/50":"from-orange-600/60 to-amber-900/50";return e.jsxs("div",{className:"flex-1 flex flex-col items-center justify-end gap-3",children:[e.jsx("div",{className:"text-2xl leading-none",children:medal}),arpAvatar(row.name,rank===1?"w-16 h-16 text-lg":"w-12 h-12 text-sm"),e.jsx("div",{className:"text-sm font-semibold truncate max-w-full px-1",children:row.name}),e.jsx("div",{className:"text-blue-400 font-mono font-bold text-sm",children:arpFmt(row.value,r)}),e.jsx("div",{className:"w-full rounded-t-xl bg-gradient-to-b "+block+" "+height+" border border-white/10"})]})};return e.jsxs("div",{className:"flex flex-col gap-8",children:[e.jsxs("div",{className:"flex items-end justify-center gap-3 sm:gap-5 pt-4 min-h-[280px]",children:[slot(top[1],2,"h-28 sm:h-32"),slot(top[0],1,"h-40 sm:h-48"),slot(top[2],3,"h-24 sm:h-28")]}),rest.length?e.jsx("div",{className:"rounded-xl border border-border bg-card/60 divide-y divide-border overflow-hidden",children:rest.map((i,a)=>{const rank=a+4;return e.jsxs("div",{className:"flex items-center gap-4 px-4 py-3",children:[e.jsxs("div",{className:"w-8 text-sm font-mono text-foreground/45",children:["#",rank]}),arpAvatar(i.name,"w-10 h-10 text-sm"),e.jsxs("div",{className:"flex-1 min-w-0",children:[e.jsx("div",{className:"text-sm font-semibold truncate",children:i.name||"Onbekend"}),e.jsx("div",{className:"text-xs font-mono text-blue-400/90",children:arpFmt(i.value,r)})]})]},rank)})}):null]})}
function Wo(){const t=Wr(),[r,i]=g.useState("coins");return g.useEffect(()=>{document.title="Leaderboard | Amsterdam Roleplay"},[]),e.jsxs("div",{className:"container w-full min-w-0 flex-1 py-10 max-w-4xl mx-auto",children:[e.jsxs("div",{className:"flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4",children:[e.jsxs("div",{className:"flex flex-col gap-2",children:[e.jsxs("h1",{className:"text-3xl font-bold tracking-tight sm:text-4xl flex items-center gap-3",children:[e.jsx("span",{className:"text-yellow-400 text-3xl",children:"🏆"}),"Leaderboard"]}),e.jsx("p",{className:"text-foreground/65 text-sm",children:"Wie heeft de meeste coins verdiend en uitgegeven."})]}),e.jsx("div",{className:"inline-flex items-center rounded-full border border-border/60 bg-muted/40 p-1 w-fit",children:Rn.map(a=>e.jsx("button",{type:"button",onClick:()=>i(a.key),className:"px-4 py-1.5 text-sm font-semibold rounded-full transition-all "+(r===a.key?"bg-blue-500 text-white shadow":"text-foreground/55 hover:text-foreground"),children:a.label},a.key))})]}),e.jsx("div",{className:"mt-8",children:t?e.jsx(Bo,{rows:t[r]??[],unit:Rn.find(a=>a.key===r).unit}):e.jsx("div",{className:"rounded-xl border border-border bg-card/60 p-8 text-center text-sm text-foreground/50",children:"Laden…"})})]})}
`;

s = s.slice(0, start) + replacement2 + s.slice(end);
fs.writeFileSync(file, s);
console.log("patched leaderboard", { before: end - start, after: replacement2.length });
