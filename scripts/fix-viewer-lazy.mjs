import fs from "fs";

const f = new URL("../public/assets/index-ChlEB3UH.js", import.meta.url);
let s = fs.readFileSync(f, "utf8");
const old =
  'qo=g.lazy(()=>Jo(()=>import("./WeaponViewer-eHKShDEB.js"),__vite__mapDeps([0,1,2])))';
const neu =
  'qo=g.lazy(()=>Jo(()=>import("./WeaponViewer-eHKShDEB.js"),__vite__mapDeps([0,1,2])).catch(()=>({default:()=>e.jsx("div",{className:"absolute inset-0 flex items-center justify-center text-sm text-foreground/50 p-4 text-center",children:"3D viewer niet beschikbaar"})})))';
if (!s.includes(old)) {
  console.log(s.includes("WeaponViewer-eHKShDEB.js") ? "pattern_changed" : "missing");
  process.exit(1);
}
fs.writeFileSync(f, s.replace(old, neu));
console.log("ok");
