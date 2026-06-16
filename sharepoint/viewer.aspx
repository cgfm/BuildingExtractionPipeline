<%@ Page Language="C#" %>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Geb&auml;udekarte</title>
    <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:"Segoe UI",system-ui,-apple-system,Arial,Helvetica,sans-serif;height:100vh;overflow:hidden;background:#d6d3c8}
        .container{display:flex;height:100vh}
        .sidebar{width:300px;background:#ffffff;color:#1a1a1a;overflow-y:auto;border-right:1px solid #c0bda8;border-left:3px solid #4b5320}
        .sidebar-header{padding:20px;border-bottom:1px solid #c0bda8}
        .sidebar-header h1{font-size:1.15rem;font-weight:700;color:#2d331a;margin-bottom:5px;text-transform:uppercase;letter-spacing:0.03em}
        .sidebar-header p{font-size:12px;color:#888}
        .group{border-bottom:1px solid #e8e6df}
        .group-header{padding:12px 20px;background:#f5f4ee;cursor:pointer;display:flex;justify-content:space-between;align-items:center;transition:background 0.2s}
        .group-header:hover{background:#e8e6df}
        .group-header h2{font-size:0.85rem;font-weight:700;color:#4b5320;text-transform:uppercase;letter-spacing:0.03em;flex:1}
        .group-header-building h2{text-decoration:underline;text-decoration-color:#b0ad98;text-underline-offset:3px}
        .group-toggle{font-size:12px;color:#b0ad98;transition:transform 0.3s;padding:6px 10px;margin:-6px -10px;border-radius:4px}
        .group-toggle:hover{color:#4b5320;background:rgba(75,83,32,0.12)}
        .group.collapsed .group-toggle{transform:rotate(-90deg)}
        .group-buildings{max-height:1000px;overflow:hidden;transition:max-height 0.3s ease}
        .group.collapsed .group-buildings{max-height:0}
        .building-item{padding:10px 20px 10px 35px;cursor:pointer;transition:background 0.2s;border-left:3px solid transparent}
        .building-item:hover{background:#f5f4ee;border-left-color:#6b7530}
        .building-item.highlighted{background:#e8e6df;border-left-color:#f39c12}
        .search-bar{padding:10px 20px;border-bottom:1px solid #c0bda8;background:#fff;position:sticky;top:0;z-index:10}
        .search-input{width:100%;padding:7px 10px;border:1px solid #c0bda8;border-radius:2px;font-size:0.85rem;background:#f5f4ee;font-family:inherit}
        .search-input:focus{outline:none;border-color:#4b5320}
        .building-name{font-size:14px;font-weight:500;color:#1a1a1a}
        .building-nummer{font-weight:700;color:#4b5320}
        .building-id{font-size:11px;color:#888;margin-top:2px}
        .main-content{flex:1;overflow:auto;background:#d6d3c8;display:flex;justify-content:center;align-items:center;padding:20px}
        .image-container{position:relative;display:inline-block;max-width:100%;max-height:100%;box-shadow:0 4px 6px rgba(0,0,0,0.15)}
        .image-container img{display:block;width:100%;height:auto}
        .svg-overlay{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none}
        .building-polygon{fill:rgba(255,255,0,0);stroke:rgba(255,255,0,0);stroke-width:2;pointer-events:auto;cursor:pointer;transition:fill 0.2s,stroke 0.2s}
        .selection-circle{fill:none;stroke:#4b5320;stroke-width:4;pointer-events:none}
        .dim-overlay{fill:rgba(0,0,0,0.6);pointer-events:none}
        .modal-overlay{display:none;position:absolute;top:0;left:0;width:100%;height:100%;z-index:200;pointer-events:none}
        .modal-overlay.active{display:block}
        .modal-content{position:absolute;background:#ffffff;border-radius:2px;border:1px solid #c0bda8;border-left:3px solid #4b5320;padding:25px 30px;min-width:280px;max-width:400px;box-shadow:0 10px 40px rgba(0,0,0,0.3);pointer-events:auto}
        .modal-close{position:absolute;top:10px;right:10px;background:none;border:none;font-size:28px;cursor:pointer;color:#b0ad98;width:35px;height:35px;display:flex;align-items:center;justify-content:center;border-radius:2px;transition:background 0.2s,color 0.2s;line-height:1}
        .modal-close:hover{background:#e8e6df;color:#2d331a}
        .modal-content h2{margin:0;color:#2d331a;font-size:22px}
        .modal-breadcrumb{font-size:12px;color:#6b7530;margin:4px 0 0 0}
        .modal-breadcrumb span::after{content:' \203A ';margin:0 2px}
        .modal-breadcrumb span:last-child::after{content:''}
        .modal-header{margin-bottom:20px}
        .modal-nummer{font-size:13px;font-weight:700;color:#4b5320;text-transform:uppercase;letter-spacing:0.03em;margin-bottom:2px}
        .modal-beschreibung{color:#1a1a1a;font-size:15px;line-height:1.5}
        .modal-beschreibung a{color:#4b5320;text-decoration:underline}
        .modal-beschreibung ul,.modal-beschreibung ol{margin:4px 0;padding-left:20px}
        .modal-beschreibung p{margin:4px 0}
        .error{text-align:center;padding:40px;color:#c0392b}
        .loading-state{text-align:center;padding:40px;color:#b0ad98}
        .edit-link{display:block;padding:10px 20px;background:#f5f4ee;color:#4b5320;text-decoration:none;border-top:1px solid #c0bda8;font-size:12px;text-align:center;transition:background 0.2s}
        .edit-link:hover{background:#e8e6df}
        .edit-link.hidden{display:none}
    </style>
</head>
<body>
    <div class="container">
        <aside class="sidebar">
            <div class="sidebar-header">
                <h1 id="sidebar-title">Geb&auml;udekarte</h1>
                <p>Interaktive Karte</p>
            </div>
            <div class="search-bar"><input type="text" class="search-input" id="search-input" placeholder="Geb&#228;ude suchen..."></div>
            <div id="sidebar-content" class="loading-state">Lade Geb&auml;udedaten...</div>
            <a id="edit-link" class="edit-link hidden" href="editor.aspx">Bearbeiten &rsaquo;</a>
        </aside>
        <main class="main-content">
            <div id="image-container-wrapper" class="loading-state">Lade Karte...</div>
        </main>
    </div>
    <div style="position:fixed;bottom:0;left:0;right:0;padding:4px 20px;font-size:11px;color:#888;background:#f5f4ee;border-top:1px solid #c0bda8;z-index:999">Daten: &copy; <a href="https://www.openstreetmap.org/copyright" style="color:#6b7530">OpenStreetMap</a> contributors</div>
    <script>
        let buildingsData=null;let currentHighlighted=new Set();let selectedBuildingId=null;
        function esc(s){if(typeof s!=='string')return '';return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}

        // Cache-buster: append folder ETag or just a timestamp to force fresh fetches
        const CB = '?t=' + Date.now();

        // ---- URL resolution -------------------------------------------------
        // SharePoint deployments live at custom paths (/sites/<n>/, /teams/<n>/,
        // /daten/<n>/, ...). Build absolute server-relative URLs from the page's
        // own location so a wrong-shaped relative fetch can't be misrouted.
        function webUrl() {
            if (window._spPageContextInfo && window._spPageContextInfo.webServerRelativeUrl) {
                return window._spPageContextInfo.webServerRelativeUrl.replace(/\/$/, '');
            }
            const m = location.pathname.match(/^(\/[^/]+\/[^/]+)/);
            return m ? m[1] : '';
        }
        function currentFolderUrl() {
            return decodeURIComponent(location.pathname).replace(/\/[^/]+\.aspx$/i, '');
        }
        function dataFolderUrl() { return currentFolderUrl() + '/data'; }
        function spStr(s) { return s.replace(/'/g, "''"); }

        // Try a fetch and return the raw text if the response looks legitimate.
        // Returns null on 404 or non-2xx; throws nothing.
        async function _tryFetchText(url, label) {
            try {
                const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
                const ct = r.headers.get('Content-Type') || '';
                console.log('[viewer]', label, url, '->', r.status, ct);
                if (!r.ok) return null;
                const text = await r.text();
                // Reject obvious HTML responses (SharePoint's friendly 404 page returns 200 + HTML)
                if (text.length > 0 && text.trimStart().slice(0, 1) === '<') {
                    console.warn('[viewer]', label, 'returned HTML (likely a SharePoint 404/login page). First 200 chars:', text.slice(0, 200));
                    return null;
                }
                return text;
            } catch (e) {
                console.warn('[viewer]', label, 'failed:', e.message);
                return null;
            }
        }

        // Build SharePoint REST URL that streams a file's bytes regardless of MIME map.
        function restFileUrl(serverRelPath) {
            return webUrl() + "/_api/web/GetFileByServerRelativeUrl('" + spStr(serverRelPath) + "')/$value?t=" + Date.now();
        }

        // Load building.json: relative URL first, then SharePoint REST fallback.
        async function loadJson() {
            const directUrl = 'data/building.json' + CB;
            let text = await _tryFetchText(directUrl, 'json/direct');
            let usedRest = false;
            if (text === null) {
                text = await _tryFetchText(restFileUrl(dataFolderUrl() + '/building.json'), 'json/rest');
                usedRest = true;
            }
            if (text === null) {
                throw new Error('building.json nicht erreichbar. Direkt: ' + directUrl + ' | Folder: ' + dataFolderUrl());
            }
            try { return { data: JSON.parse(text), usedRest }; }
            catch (e) {
                console.warn('[viewer] JSON.parse failed. Body preview:', text.slice(0, 200));
                throw new Error('data/building.json ist kein g\u00fcltiges JSON.');
            }
        }

        // Image URL: prefer the same access path that worked for the JSON.
        async function imageDataUrl(usedRest) {
            const direct = 'data/building.png' + CB;
            if (!usedRest) return direct;
            // REST fallback: fetch as blob and turn into an object URL
            const url = restFileUrl(dataFolderUrl() + '/building.png');
            try {
                const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
                console.log('[viewer] png/rest', url, '->', r.status, r.headers.get('Content-Type'));
                if (!r.ok) return direct; // best-effort fall-through
                return URL.createObjectURL(await r.blob());
            } catch (e) {
                console.warn('[viewer] png/rest failed:', e.message);
                return direct;
            }
        }

        async function init(){
            try {
                const { data, usedRest } = await loadJson();
                buildingsData = data;
                buildingsData.image = buildingsData.image || {};
                buildingsData.image.dataUrl = await imageDataUrl(usedRest);
                const title = buildingsData.title || 'Geb\u00e4udekarte';
                document.getElementById('sidebar-title').textContent = title;
                document.title = title;
                renderImage();
                renderSidebar();
                document.getElementById('sidebar-content').classList.remove('loading-state');
                document.getElementById('image-container-wrapper').classList.remove('loading-state');
                await checkEditPermission();
            } catch (e) {
                const el = document.getElementById('sidebar-content');
                el.textContent = '';
                const d = document.createElement('div');
                d.className = 'error';
                d.textContent = 'Fehler: ' + e.message;
                el.appendChild(d);
                document.getElementById('image-container-wrapper').innerHTML = '<div class="error">' + esc(e.message) + '</div>';
                console.error(e);
                // Still try to show edit link for designers, in case they need to create the map
                await checkEditPermission();
            }
        }

        // Show "Bearbeiten" link only if the user has write permission (site-level check).
        async function checkEditPermission() {
            try {
                const r = await fetch(webUrl() + '/_api/web/effectivebasepermissions', { headers: { Accept: 'application/json;odata=verbose' }, credentials: 'same-origin' });
                if (!r.ok) return;
                const ct = (r.headers.get('Content-Type') || '').toLowerCase();
                let low;
                if (ct.includes('json')) {
                    const j = await r.json();
                    // Response: { d: { EffectiveBasePermissions: { High: "...", Low: "..." } } }
                    const perms = j.d && j.d.EffectiveBasePermissions;
                    low = parseInt((perms && perms.Low) || '0', 10);
                } else {
                    const xml = new DOMParser().parseFromString(await r.text(), 'application/xml');
                    const el = xml.querySelector('Low');
                    low = parseInt(el ? el.textContent : '0', 10);
                }
                if (low & 0x4) document.getElementById('edit-link').classList.remove('hidden');
            } catch (e) { /* viewer-only, nothing to do */ }
        }

        function renderImage(){const w=document.getElementById('image-container-wrapper');const{width,height}=buildingsData.image;const c=document.createElement('div');c.className='image-container';const img=document.createElement('img');img.src=buildingsData.image.dataUrl;img.alt='Karte';c.appendChild(img);const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','svg-overlay');svg.setAttribute('viewBox','0 0 '+width+' '+height);svg.setAttribute('preserveAspectRatio','xMidYMid meet');buildingsData.buildings.filter(b=>!b.disabled).forEach(b=>{const polys=b.polygons||[b.polygon];polys.forEach(poly=>{const p=document.createElementNS('http://www.w3.org/2000/svg','polygon');p.setAttribute('points',poly.map(([x,y])=>(x*width)+','+(y*height)).join(' '));p.setAttribute('class','building-polygon');p.setAttribute('data-building-id',b.id);p.addEventListener('mouseenter',()=>highlightBuilding(b.id));p.addEventListener('mouseleave',()=>unhighlightBuilding(b.id));p.addEventListener('click',()=>showPopup(b));svg.appendChild(p)})});c.appendChild(svg);const mo=document.createElement('div');mo.className='modal-overlay';mo.id='modal-overlay';mo.innerHTML='<div class="modal-content"><button class="modal-close" id="modal-close">&times;</button><div class="modal-header"><div class="modal-nummer" id="modal-nummer" style="display:none"></div><h2 id="modal-title"></h2><div class="modal-breadcrumb" id="modal-breadcrumb"></div></div><div class="modal-beschreibung" id="modal-beschreibung" style="display:none"></div></div>';c.appendChild(mo);w.innerHTML='';w.appendChild(c);document.getElementById('modal-close').addEventListener('click',hidePopup)}

        function renderSidebar(){
            const sidebar=document.getElementById('sidebar-content');
            const buildings=buildingsData.buildings.filter(b=>!b.disabled);
            const gh={};
            buildings.forEach(b=>{const g=b.gruppe||'Sonstige';const parts=g.split(' > ').map(p=>p.trim());let cl=gh;parts.forEach((part,i)=>{if(!cl[part])cl[part]={buildings:[],subgroups:{}};if(i===parts.length-1)cl[part].buildings.push(b);cl=cl[part].subgroups})});
            function sn(n){const last=new Set(['Unbekannt','Sonstige']);return n.filter(x=>!last.has(x)).concat(n.filter(x=>last.has(x)))}
            function gbi(gd){const ids=gd.buildings.map(b=>b.id);Object.values(gd.subgroups).forEach(sg=>{ids.push(...gbi(sg))});return ids}
            function fbi(gd){for(const b of gd.buildings){const i=buildings.indexOf(b);if(i!==-1)return i}for(const s of Object.keys(gd.subgroups)){const i=fbi(gd.subgroups[s]);if(i!==-1)return i}return Infinity}
            function mkItem(b,pl){const it=document.createElement('div');it.className='building-item';it.style.paddingLeft=pl+'px';it.setAttribute('data-building-id',b.id);it.setAttribute('data-search-text',[b.name,b.nummer,b.gruppe].filter(Boolean).join(' ').toLowerCase());const nd=document.createElement('div');nd.className='building-name';nd.textContent=b.name;it.appendChild(nd);it.addEventListener('mouseenter',()=>highlightBuilding(b.id));it.addEventListener('mouseleave',()=>unhighlightBuilding(b.id));it.addEventListener('click',()=>showPopup(b));return it}
            function rg(gn,gd,l){
                const g=document.createElement('div');g.className='group collapsed';g.style.marginLeft=(l*15)+'px';
                const bids=gbi(gd);
                const nameMatch=gd.buildings.find(b=>b.name===gn);
                const h=document.createElement('div');h.className='group-header'+(nameMatch?' group-header-building':'');h.style.paddingLeft=(20-l*5)+'px';
                if(nameMatch)h.setAttribute('data-search-text',[nameMatch.name,nameMatch.nummer,nameMatch.gruppe].filter(Boolean).join(' ').toLowerCase());
                h.innerHTML='<h2>'+esc(gn)+'</h2><span class="group-toggle">\u25BC</span>';
                h.addEventListener('click',e=>{if(e.target.closest('.group-toggle')){g.classList.toggle('collapsed');return}g.classList.toggle('collapsed');if(nameMatch)showPopup(nameMatch)});
                h.addEventListener('mouseenter',()=>bids.forEach(id=>highlightBuilding(id)));
                h.addEventListener('mouseleave',()=>bids.forEach(id=>unhighlightBuilding(id)));
                g.appendChild(h);
                const ct=document.createElement('div');ct.className='group-buildings';
                const items=[];
                gd.buildings.filter(b=>b!==nameMatch).forEach(b=>{items.push({t:'b',b:b,k:buildings.indexOf(b)})});
                sn(Object.keys(gd.subgroups)).forEach(s=>{items.push({t:'g',n:s,d:gd.subgroups[s],k:fbi(gd.subgroups[s])})});
                items.sort((a,b)=>a.k-b.k);
                items.forEach(it=>{if(it.t==='b')ct.appendChild(mkItem(it.b,35+l*15));else ct.appendChild(rg(it.n,it.d,l+1))});
                g.appendChild(ct);return g
            }
            sidebar.innerHTML='';
            const top=[];sn(Object.keys(gh)).forEach(gn=>{top.push({n:gn,d:gh[gn],k:fbi(gh[gn])})});
            top.sort((a,b)=>a.k-b.k);
            top.forEach(it=>sidebar.appendChild(rg(it.n,it.d,0)))
        }

        function highlightBuilding(id){currentHighlighted.add(id);const b=buildingsData.buildings.find(x=>x.id===id);const hc=b?.highlightColor||'#FFC107';const rgb=hexToRgb(hc);document.querySelectorAll('.building-polygon[data-building-id="'+id+'"]').forEach(p=>{p.style.fill='rgba('+rgb.r+','+rgb.g+','+rgb.b+',0.35)';p.style.stroke=hc;p.style.strokeWidth='3'});const mi=document.querySelector('.building-item[data-building-id="'+id+'"]');if(mi){mi.classList.add('highlighted');mi.style.borderLeftColor=hc}}
        function unhighlightBuilding(id){currentHighlighted.delete(id);if(id===selectedBuildingId)return;document.querySelectorAll('.building-polygon[data-building-id="'+id+'"]').forEach(p=>{p.style.fill='rgba(255,255,0,0)';p.style.stroke='rgba(255,255,0,0)';p.style.strokeWidth='2'});const mi=document.querySelector('.building-item[data-building-id="'+id+'"]');if(mi){mi.classList.remove('highlighted');mi.style.borderLeftColor=''}}
        function hexToRgb(hex){const r=/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);return r?{r:parseInt(r[1],16),g:parseInt(r[2],16),b:parseInt(r[3],16)}:{r:255,g:193,b:7}}
        function showPopup(building){hidePopup();selectedBuildingId=building.id;highlightBuilding(building.id);const polygon=document.querySelector('.building-polygon[data-building-id="'+building.id+'"]');if(!polygon)return;const polys=building.polygons||[building.polygon];let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;polys.forEach(poly=>poly.forEach(([x,y])=>{minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y)}));const centerX=(minX+maxX)/2,centerY=(minY+maxY)/2;const bW=maxX-minX,bH=maxY-minY;const calcR=Math.max(bW,bH)/2*1.8;const radius=Math.max(calcR,0.04);const svg=polygon.closest('svg');const vb=svg.getAttribute('viewBox').split(' ');const svgW=parseFloat(vb[2]),svgH=parseFloat(vb[3]);let defs=svg.querySelector('defs');if(!defs){defs=document.createElementNS('http://www.w3.org/2000/svg','defs');svg.insertBefore(defs,svg.firstChild)}const mask=document.createElementNS('http://www.w3.org/2000/svg','mask');mask.setAttribute('id','selection-mask');const mr=document.createElementNS('http://www.w3.org/2000/svg','rect');mr.setAttribute('width',svgW);mr.setAttribute('height',svgH);mr.setAttribute('fill','white');mask.appendChild(mr);const mc=document.createElementNS('http://www.w3.org/2000/svg','circle');mc.setAttribute('cx',centerX*svgW);mc.setAttribute('cy',centerY*svgH);mc.setAttribute('r',radius*Math.max(svgW,svgH));mc.setAttribute('fill','black');mask.appendChild(mc);defs.appendChild(mask);const dr=document.createElementNS('http://www.w3.org/2000/svg','rect');dr.setAttribute('class','dim-overlay');dr.setAttribute('width',svgW);dr.setAttribute('height',svgH);dr.setAttribute('mask','url(#selection-mask)');svg.appendChild(dr);const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');circle.setAttribute('class','selection-circle');circle.setAttribute('cx',centerX*svgW);circle.setAttribute('cy',centerY*svgH);circle.setAttribute('r',radius*Math.max(svgW,svgH));svg.appendChild(circle);const modal=document.getElementById('modal-overlay');const modalContent=document.querySelector('.modal-content');const ne=document.getElementById('modal-nummer');if(building.nummer&&building.nummer.trim()){ne.textContent=building.nummer;ne.style.display='block'}else{ne.style.display='none'}document.getElementById('modal-title').textContent=building.name;const bc=document.getElementById('modal-breadcrumb');const gruppe=(building.gruppe||'').trim();if(gruppe){const parts=gruppe.split(/\s*>\s*/);bc.innerHTML=parts.map(p=>'<span>'+esc(p)+'</span>').join('');bc.style.display='block'}else{bc.style.display='none'}const bd=document.getElementById('modal-beschreibung');if(building.beschreibung&&building.beschreibung.trim()){bd.innerHTML=building.beschreibung;bd.style.display='block'}else{bd.style.display='none'}modal.classList.add('active');requestAnimationFrame(()=>{const ic=document.querySelector('.image-container');if(!ic)return;const img=ic.querySelector('img');const iw=img.offsetWidth,ih=img.offsetHeight;const mR=modalContent.getBoundingClientRect();const bx=centerX*iw,by=centerY*ih;const crPx=radius*Math.max(iw,ih);const gap=20,margin=15;let left,top;const isRight=centerX>0.5;const cle=bx-crPx,cre=bx+crPx;if(isRight){const tl=cle-gap-mR.width;if(tl>=margin){left=tl;top=by-(mR.height/2)}else{left=bx-(mR.width/2);top=by+crPx+gap}}else{const tl=cre+gap;if(tl+mR.width<=iw-margin){left=tl;top=by-(mR.height/2)}else{left=bx-(mR.width/2);top=by+crPx+gap}}if(left===bx-(mR.width/2)&&top!==undefined){if(top+mR.height>ih-margin){const ta=by-crPx-gap-mR.height;if(ta>=margin)top=ta}}left=Math.max(margin,Math.min(left,iw-mR.width-margin));top=Math.max(margin,Math.min(top,ih-mR.height-margin));modalContent.style.left=left+'px';modalContent.style.top=top+'px'})}
        function hidePopup(){if(selectedBuildingId){const prev=selectedBuildingId;selectedBuildingId=null;unhighlightBuilding(prev)}const c=document.querySelector('.selection-circle');const d=document.querySelector('.dim-overlay');const m=document.getElementById('selection-mask');const mo=document.getElementById('modal-overlay');if(c)c.remove();if(d)d.remove();if(m)m.remove();if(mo)mo.classList.remove('active')}
        document.addEventListener('keydown',e=>{if(e.key==='Escape')hidePopup()});
        document.addEventListener('click',e=>{if(!e.target.closest('.building-polygon')&&!e.target.closest('.building-item')&&!e.target.closest('.sidebar')&&!e.target.closest('.modal-content'))hidePopup()});
        document.getElementById('search-input').addEventListener('input',function(){const q=this.value.toLowerCase().trim();const sc=document.getElementById('sidebar-content');sc.querySelectorAll('.building-item').forEach(it=>{it.style.display=(!q||it.getAttribute('data-search-text').includes(q))?'':'none'});sc.querySelectorAll('.group').forEach(g=>{const hMatch=q&&(g.querySelector(':scope>.group-header')?.getAttribute('data-search-text')||'').includes(q);const childMatch=Array.from(g.querySelectorAll('.building-item')).some(it=>it.style.display!=='none');g.style.display=(!q||hMatch||childMatch)?'':'none';if(q&&(hMatch||childMatch))g.classList.remove('collapsed')})});
        init();
    </script>
</body>
</html>
