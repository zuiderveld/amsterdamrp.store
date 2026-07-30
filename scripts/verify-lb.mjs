import fs from "fs";
const s = fs.readFileSync(new URL("../public/assets/index-ChlEB3UH.js", import.meta.url), "utf8");
console.log({
  podium: s.includes("min-h-[280px]"),
  eur: s.includes('unit:"eur"'),
  weeklyGone: !s.includes('label:"Deze week"'),
});
