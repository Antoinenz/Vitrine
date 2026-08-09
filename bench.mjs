import { chromium } from 'playwright';
const N = 6;
const b = await chromium.launch();
const ctx = await b.newContext({viewport:{width:1200,height:900}});
const totals = [], worsts = [];
for (let i = 0; i < N; i++) {
  const p = await ctx.newPage();
  await p.goto('http://localhost:5174/', { waitUntil: 'load' });
  await p.waitForTimeout(700);
  await p.evaluate(() => { const w=window; w.__g=[]; w.__t0=performance.now(); w.__last=w.__t0;
    const t=()=>{const n=performance.now(); const d=n-w.__last; w.__last=n;
      if(d>30) w.__g.push(+d.toFixed(0)); w.__r=requestAnimationFrame(t);}; t(); });
  await p.locator('.stack-link').first().click();
  await p.waitForTimeout(2000);
  const g = await p.evaluate(()=>{cancelAnimationFrame(window.__r);return window.__g;});
  totals.push(g.reduce((a,c)=>a+c,0)); worsts.push(g.length?Math.max(...g):0);
  await p.close();
}
const med = a => a.slice().sort((x,y)=>x-y)[Math.floor(a.length/2)];
console.log(`${process.argv[2]||''} median total-stall ${med(totals)}ms | median worst-frame ${med(worsts)}ms | totals ${JSON.stringify(totals)}`);
await b.close();
