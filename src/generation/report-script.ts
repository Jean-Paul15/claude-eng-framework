/**
 * Script embarqué du tableau de bord (aucune bibliothèque, aucune requête) : infobulles au survol et au focus, compteurs animés,
 * et le relief 3D des chantiers — des tours dessinées sur un canvas en projection isométrique, que l'on fait tourner en les glissant.
 * Sans JavaScript, tout reste lisible : les tableaux et les barres 2D portent les mêmes chiffres.
 */
export const SCRIPT = String.raw`(function(){
var reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
var tip=document.createElement('div');tip.className='tip';tip.setAttribute('role','tooltip');document.body.appendChild(tip);
function place(x,y){tip.style.left=Math.max(4,Math.min(x+12,innerWidth-tip.offsetWidth-8))+'px';tip.style.top=Math.max(y-tip.offsetHeight-10,4)+'px'}
function showTip(text,x,y){tip.textContent=text;tip.style.opacity=1;place(x,y)}
function hideTip(){tip.style.opacity=0}
document.addEventListener('pointermove',function(e){var el=e.target.closest&&e.target.closest('[data-tip]');if(el)showTip(el.getAttribute('data-tip'),e.clientX,e.clientY);else if(!e.target.closest||!e.target.closest('canvas.relief'))hideTip()});
document.addEventListener('focusin',function(e){var el=e.target.closest&&e.target.closest('[data-tip]');if(el){var r=el.getBoundingClientRect();showTip(el.getAttribute('data-tip'),r.left,r.top)}});
document.addEventListener('focusout',hideTip);

document.querySelectorAll('[data-count]').forEach(function(el){var to=+el.getAttribute('data-count'),suffix=el.getAttribute('data-suffix')||'';
if(reduce||!isFinite(to)){el.textContent=to+suffix;return}var t0=performance.now();
(function step(t){var k=Math.min(1,(t-t0)/800),e=1-Math.pow(1-k,3);el.textContent=Math.round(to*e)+suffix;if(k<1)requestAnimationFrame(step)})(t0)});

var cv=document.querySelector('canvas.relief');if(!cv||!cv.getContext)return;
var data=JSON.parse(cv.getAttribute('data-towers')||'[]');if(!data.length)return;
var ctx=cv.getContext('2d'),W=0,H=0,dpr=Math.min(devicePixelRatio||1,2);
var angle=-0.6,auto=!reduce,hover=-1,drag=null,grow=reduce?1:0,polys=[];
var cols=Math.ceil(Math.sqrt(data.length)),gap=1.5,size=1,max=Math.max.apply(null,data.map(function(d){return d.t}));
function css(n){return getComputedStyle(document.documentElement).getPropertyValue(n).trim()}
function resize(){W=cv.clientWidth;H=cv.clientHeight;cv.width=W*dpr;cv.height=H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0)}
function proj(x,y,z,sc,ca,sa){var rx=x*ca-y*sa,ry=x*sa+y*ca;return[W/2+rx*sc,H*0.62+ry*sc*0.5-z*sc*0.9,ry]}
function shade(c,a){ctx.fillStyle=c;ctx.fill();ctx.fillStyle='rgba(0,0,0,'+a+')';ctx.fill()}
function poly(p){ctx.beginPath();ctx.moveTo(p[0][0],p[0][1]);for(var i=1;i<p.length;i++)ctx.lineTo(p[i][0],p[i][1]);ctx.closePath()}
function box(x0,y0,z0,w,h,sc,ca,sa,color,idx,tipText,lit){
  var X=[x0,x0+w],Y=[y0,y0+w],Z=[z0,z0+h];
  function P(i,j,k){return proj(X[i],Y[j],Z[k],sc,ca,sa)}
  var faces=[[[0,0,0],[1,0,0],[1,0,1],[0,0,1],0,-1],[[0,1,0],[1,1,0],[1,1,1],[0,1,1],0,1],[[0,0,0],[0,1,0],[0,1,1],[0,0,1],-1,0],[[1,0,0],[1,1,0],[1,1,1],[1,0,1],1,0]];
  faces.forEach(function(f){var ny=f[4]*sa+f[5]*ca;if(ny<=0)return;var pts=[0,1,2,3].map(function(i){return P(f[i][0],f[i][1],f[i][2])});poly(pts);shade(color,Math.abs(f[4]*ca-f[5]*sa)>0.7?0.30:0.16);
    if(lit){ctx.fillStyle='rgba(255,255,255,.18)';ctx.fill()}polys.push({pts:pts,idx:idx,tip:tipText})});
  var top=[P(0,0,1),P(1,0,1),P(1,1,1),P(0,1,1)];poly(top);ctx.fillStyle=color;ctx.fill();ctx.fillStyle='rgba(255,255,255,'+(lit?0.32:0.14)+')';ctx.fill();polys.push({pts:top,idx:idx,tip:tipText})}
function draw(){
  ctx.clearRect(0,0,W,H);polys=[];var sc=Math.min(W/(cols*(size+gap)*1.55),H/10),ca=Math.cos(angle),sa=Math.sin(angle),span=cols*(size+gap);
  var good=css('--good'),idle=css('--idle'),grid=css('--grid'),ink=css('--ink2');
  var order=data.map(function(d,i){var gx=(i%cols)*(size+gap)-span/2+gap/2,gy=Math.floor(i/cols)*(size+gap)-span/2+gap/2;return{d:d,i:i,gx:gx,gy:gy,depth:proj(gx+size/2,gy+size/2,0,sc,ca,sa)[2]}}).sort(function(a,b){return a.depth-b.depth});
  var fl=[proj(-span/2-1,-span/2-1,0,sc,ca,sa),proj(span/2,-span/2-1,0,sc,ca,sa),proj(span/2,span/2,0,sc,ca,sa),proj(-span/2-1,span/2,0,sc,ca,sa)];poly(fl);ctx.fillStyle=grid;ctx.globalAlpha=.55;ctx.fill();ctx.globalAlpha=1;
  order.forEach(function(o){var d=o.d,hAll=Math.max(0.25,d.t/max*5.2)*grow,hDone=hAll*(d.t?d.d/d.t:0),lit=o.i===hover;var t=d.d+' sur '+d.t+' terminées · '+d.n;
    if(hDone>0)box(o.gx,o.gy,0,size,hDone,sc,ca,sa,good,o.i,t,lit);
    if(hAll-hDone>0.001)box(o.gx,o.gy,hDone,size,hAll-hDone,sc,ca,sa,idle,o.i,t,lit)});
  if(hover>=0){var d=data[hover],p=proj(order.filter(function(o){return o.i===hover})[0].gx+size/2,order.filter(function(o){return o.i===hover})[0].gy+size/2,Math.max(0.25,d.t/max*5.2)*grow+0.2,sc,ca,sa);
    ctx.font='600 12px system-ui,sans-serif';ctx.textAlign='center';var w=ctx.measureText(d.n).width+14;ctx.fillStyle=css('--ink');ctx.beginPath();ctx.roundRect?ctx.roundRect(p[0]-w/2,p[1]-26,w,22,6):ctx.rect(p[0]-w/2,p[1]-26,w,22);ctx.fill();ctx.fillStyle=css('--surface');ctx.fillText(d.n,p[0],p[1]-11)}
  ctx.fillStyle=ink;ctx.font='11px system-ui,sans-serif';ctx.textAlign='left';
}
function inside(pts,x,y){var c=false;for(var i=0,j=pts.length-1;i<pts.length;j=i++){var a=pts[i],b=pts[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])c=!c}return c}
function pick(x,y){for(var i=polys.length-1;i>=0;i--)if(inside(polys[i].pts,x,y))return polys[i];return null}
cv.addEventListener('pointerdown',function(e){drag={x:e.clientX,a:angle};auto=false;cv.setPointerCapture(e.pointerId)});
cv.addEventListener('pointerup',function(){drag=null});cv.addEventListener('pointercancel',function(){drag=null});
cv.addEventListener('pointermove',function(e){var r=cv.getBoundingClientRect();if(drag){angle=drag.a+(e.clientX-drag.x)*0.01;hideTip();return}
  var h=pick(e.clientX-r.left,e.clientY-r.top);hover=h?h.idx:-1;if(h)showTip(h.tip,e.clientX,e.clientY);else hideTip()});
cv.addEventListener('pointerleave',function(){hover=-1;hideTip()});
cv.addEventListener('keydown',function(e){if(e.key==='ArrowLeft'){angle-=0.15;auto=false}if(e.key==='ArrowRight'){angle+=0.15;auto=false}});
addEventListener('resize',resize);resize();
var t0=performance.now();
(function loop(t){if(grow<1)grow=Math.min(1,(t-t0)/900),grow=1-Math.pow(1-grow,3);if(auto&&!drag)angle+=0.003;draw();requestAnimationFrame(loop)})(t0);
})();`;
