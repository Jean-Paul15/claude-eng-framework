/**
 * Feuille de style du tableau de bord. Les couleurs sont des rôles (variables) : surface, encre, grille, séries, états.
 * Palette catégorielle et états de la référence dataviz ; le thème sombre a ses propres pas (pas une inversion), sous les deux portées
 * (réglage du système et attribut `data-theme`) pour qu'un choix explicite l'emporte dans les deux sens.
 */

const LIGHT = `--page:#f9f9f7;--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--muted:#898781;--grid:#e1e0d9;--axis:#c3c2b7;--ring:rgba(11,11,11,.10);
--s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--good:#0ca30c;--good-ink:#006300;--warn:#fab219;--crit:#d03b3b;--idle:#b9b7ae;--on-fill:#fff`;
const DARK = `--page:#0d0d0d;--surface:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--muted:#898781;--grid:#2c2c2a;--axis:#383835;--ring:rgba(255,255,255,.10);
--s1:#3987e5;--s2:#d95926;--s3:#199e70;--good:#0ca30c;--good-ink:#0ca30c;--warn:#fab219;--crit:#d03b3b;--idle:#4a4945;--on-fill:#fff`;

export const CSS = `:root{color-scheme:light;${LIGHT}}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])){color-scheme:dark;${DARK}}}
:root[data-theme="dark"]{color-scheme:dark;${DARK}}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1080px;margin:0 auto;padding:20px 16px 64px}
header{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;margin-bottom:14px}
h1{font-size:1.35rem;margin:0}h2{font-size:.95rem;margin:0 0 12px;font-weight:600}.sub{color:var(--ink2);font-size:.85rem}
.grid{display:grid;gap:12px;margin:12px 0}.kpis{grid-template-columns:repeat(4,1fr)}.two{grid-template-columns:1fr 1fr}
.card{background:var(--surface);border:1px solid var(--ring);border-radius:14px;padding:16px;min-width:0}
.kpi b{display:block;font-size:1.9rem;line-height:1.1;font-variant-numeric:tabular-nums}.kpi span{color:var(--ink2);font-size:.85rem}
a.kpi{color:inherit;text-decoration:none}a.kpi:hover{border-color:var(--axis)}
.hero{display:grid;grid-template-columns:auto 1fr;gap:20px;align-items:center}
.donut{width:116px;height:116px}.donut .t{stroke:var(--grid)}.donut .v{stroke:var(--good)}.donut text{fill:var(--ink);font-size:22px;font-weight:600;text-anchor:middle}
.stack{display:flex;gap:2px;height:14px;margin:4px 0 10px}.stack i{display:block;min-width:3px}.stack i:first-child,.seg:first-child{border-radius:4px 0 0 4px}.stack i:last-child,.seg:last-child{border-radius:0 4px 4px 0}.stack i:only-child,.seg:only-child{border-radius:4px}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:.82rem;color:var(--ink2)}.legend b{color:var(--ink);font-variant-numeric:tabular-nums}
.dot{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}
.done{background:var(--good)}.in_progress,.s1{background:var(--s1)}.pending,.other{background:var(--idle)}.blocked,.waived{background:var(--warn)}.failed,.fail{background:var(--crit)}.pass{background:var(--good)}.s2{background:var(--s2)}.s3{background:var(--s3)}
svg.chart{width:100%;height:auto;display:block}.chart .g{stroke:var(--grid);stroke-width:1}.chart .ax{stroke:var(--axis);stroke-width:1}.chart text{fill:var(--muted);font-size:11px}
.chart .bar{fill:var(--s1)}.chart .col:hover .bar{opacity:.75}.chart .hit{fill:transparent}
.rows{display:grid;gap:9px}.row{display:grid;grid-template-columns:minmax(70px,170px) 1fr auto;gap:10px;align-items:center;font-size:.85rem}
.row .lab{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.row .val{color:var(--ink2);font-variant-numeric:tabular-nums;min-width:44px;text-align:right}
.track{display:flex;gap:2px;height:12px;background:var(--grid);border-radius:4px;overflow:hidden}.track.bare{background:none;overflow:visible}.track i,.seg{display:block;min-width:3px}.track>i:not([class]){background:var(--good)}
.more{margin-top:10px}details{margin-top:10px}summary{cursor:pointer;font-size:.85rem;color:var(--ink2);padding:6px 0}summary:hover{color:var(--ink)}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}.chip{font-size:.8rem;border:1px solid var(--ring);border-radius:99px;padding:2px 10px;color:var(--ink2)}.chip b{color:var(--ink)}
.wait{display:grid;grid-template-columns:150px 1fr;gap:4px 12px;padding:9px 0;border-top:1px solid var(--grid);font-size:.88rem}
.wait .lv{font-size:.78rem;color:var(--ink2)}.wait .lv b{color:var(--ink)}.wait .tx{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
code{font:.85em ui-monospace,Consolas,monospace;background:var(--page);border:1px solid var(--ring);border-radius:4px;padding:0 4px}
table{width:100%;border-collapse:collapse;font-size:.82rem}th{text-align:left;color:var(--ink2);font-weight:500;padding:6px 8px;border-bottom:1px solid var(--axis)}td{padding:6px 8px;border-bottom:1px solid var(--grid);vertical-align:top}td.n{font-variant-numeric:tabular-nums;white-space:nowrap}
.pill{font-size:.75rem;border-radius:99px;padding:1px 8px;border:1px solid var(--ring);white-space:nowrap}
.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;margin:8px 0}.shots img{width:100%;border-radius:8px;border:1px solid var(--ring)}
.tip{position:fixed;z-index:9;pointer-events:none;background:var(--ink);color:var(--surface);font-size:.78rem;padding:4px 8px;border-radius:6px;max-width:260px;opacity:0;transition:opacity .08s}
.empty{color:var(--ink2);font-size:.88rem}.scroll{overflow-x:auto}
@media (max-width:760px){.kpis{grid-template-columns:repeat(2,1fr)}.two{grid-template-columns:1fr}.hero{grid-template-columns:1fr;justify-items:start}.wait{grid-template-columns:1fr}.row{grid-template-columns:minmax(60px,110px) 1fr auto}}
@media (prefers-reduced-motion:reduce){.tip{transition:none}}
.hero3d{padding:0;overflow:hidden;background:radial-gradient(120% 90% at 50% 0%,color-mix(in srgb,var(--s1) 14%,var(--surface)),var(--surface) 70%)}
.hero3d .head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:16px 16px 0}.hero3d h2{margin:0}.hint{font-size:.78rem;color:var(--ink2)}
canvas.relief{display:block;width:100%;height:340px;cursor:grab;touch-action:pan-y}canvas.relief:active{cursor:grabbing}
.kpi{position:relative;overflow:hidden}.kpi:before{content:"";position:absolute;inset:0 auto 0 0;width:4px;background:var(--accent,var(--s1))}
.stack i{transform-origin:left;animation:grow .7s cubic-bezier(.2,.7,.2,1) both}.track>i,.track .seg{transform-origin:left;animation:grow .8s cubic-bezier(.2,.7,.2,1) both}
.chart .bar{transform-box:fill-box;transform-origin:bottom;animation:rise .7s cubic-bezier(.2,.7,.2,1) both}
.donut .v{animation:sweep 1s cubic-bezier(.2,.7,.2,1) both}
@keyframes grow{from{transform:scaleX(0)}}@keyframes rise{from{transform:scaleY(0)}}@keyframes sweep{from{stroke-dasharray:0 100}}
@media (prefers-reduced-motion:reduce){.stack i,.track>i,.track .seg,.chart .bar,.donut .v{animation:none}}
@media (forced-colors:active){.track i,.seg,.stack i{outline:1px solid CanvasText}}`;
