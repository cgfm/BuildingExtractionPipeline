// ==========================================================================
// ViewerWidget \u2014 shared viewer logic for sidebar, map overlay, popups
// ==========================================================================
/**
 * @namespace ViewerWidget
 * @description Shared IIFE providing a factory for viewer instances (sidebar + SVG map + popups).
 * Static utilities: buildGroupHierarchy, sortGroupNames, getAllGroupIds.
 * Factory: create(options) returns an instance with highlight, unhighlight, showPopup, hidePopup, renderSidebar, renderMap.
 */
const ViewerWidget = (function() {

    // ---- Shared static utilities ----

    /**
     * Build a nested group hierarchy from buildings' "gruppe" field (supports "A > B > C" nesting).
     * @param {Array} buildings - Array of building objects
     * @param {boolean} filterDisabled - If true, exclude buildings with disabled=true
     * @returns {Object} Nested hierarchy { groupName: { buildings: [], subgroups: {} } }
     */
    function buildGroupHierarchy(buildings, filterDisabled) {
        const list = filterDisabled ? buildings.filter(b => !b.disabled) : buildings;
        const hierarchy = {};
        list.forEach(b => {
            const g = b.gruppe || 'Sonstige';
            const parts = g.split(' > ').map(p => p.trim());
            let level = hierarchy;
            parts.forEach((part, i) => {
                if (!level[part]) level[part] = { buildings: [], subgroups: {} };
                if (i === parts.length - 1) level[part].buildings.push(b);
                level = level[part].subgroups;
            });
        });
        return hierarchy;
    }

    /**
     * Preserve insertion order (from buildings array), with "Unbekannt"/"Sonstige" always last.
     * @param {string[]} names
     * @returns {string[]} Ordered names
     */
    function sortGroupNames(names) {
        const last = new Set(['Unbekannt', 'Sonstige']);
        return names.filter(n => !last.has(n)).concat(names.filter(n => last.has(n)));
    }

    /**
     * Recursively collect all building IDs from a group and its subgroups.
     * @param {{buildings: Array, subgroups: Object}} groupData
     * @returns {string[]} Array of building IDs
     */
    function getAllGroupIds(groupData) {
        const ids = groupData.buildings.map(b => b.id);
        Object.values(groupData.subgroups).forEach(sg => ids.push(...getAllGroupIds(sg)));
        return ids;
    }

    // ---- Factory ----

    /**
     * Create a new ViewerWidget instance.
     * @param {Object} options
     * @param {string} options.prefix - CSS class prefix ('vp', 'ed', 'vo')
     * @param {number} [options.highlightOpacity=0.35] - Polygon highlight fill opacity
     * @param {number} [options.highlightStroke=3] - Highlighted stroke width
     * @param {number} [options.normalStroke=2] - Normal stroke width
     * @param {boolean} [options.filterDisabled=true] - Hide disabled buildings
     * @param {Function} [options.onBuildingClick] - Callback when a building is clicked
     * @param {Function} [options.onPolygonClick] - Callback when a polygon is clicked (receives building + event)
     * @param {Function} [options.buildingItemRenderer] - Custom sidebar item renderer fn(building, paddingLeft) => HTMLElement
     * @param {Function} [options.sidebarHeaderRenderer] - Custom header renderer fn(buildingsData) => HTML string
     * @param {Function} options.getBuildingsData - Getter returning current buildingsData
     * @param {string} options.imageContainerId - DOM ID of the image container for popup positioning
     * @returns {{highlight, unhighlight, hidePopup, showPopup, renderSidebar, renderMap, filterSidebar, getSelectedId, setSelectedId}}
     */
    function create(options) {
        const prefix = options.prefix;                          // 'vp', 'ed', 'vo'
        const highlightOpacity = options.highlightOpacity || 0.35;
        const highlightStroke = options.highlightStroke || 3;
        const normalStroke = options.normalStroke || 2;
        const selectionStroke = options.selectionStroke || 4;
        const aspectRatio = options.aspectRatio || 'xMidYMid meet';
        const modalGap = options.modalGap || 16;
        const modalMargin = options.modalMargin || 10;
        const filterDisabled = options.filterDisabled !== false;
        const onBuildingClick = options.onBuildingClick;        // callback(building)
        const onPolygonClick = options.onPolygonClick;          // callback(building, event)
        const buildingItemRenderer = options.buildingItemRenderer; // optional custom fn(building, paddingLeft) => HTMLElement
        const sidebarHeaderRenderer = options.sidebarHeaderRenderer; // optional fn(buildingsData) => HTML string
        const getBuildingsData = options.getBuildingsData;       // () => buildingsData
        const imageContainerId = options.imageContainerId;      // e.g. 'vpImageContainer'

        let selectedBuildingId = null;
        const currentHighlighted = new Set();

        function highlight(buildingId) {
            currentHighlighted.add(buildingId);
            const bd = getBuildingsData();
            const building = bd.buildings.find(b => b.id === buildingId);
            const hc = building?.highlightColor || '#FFC107';
            const rgb = hexToRgb(hc);
            document.querySelectorAll('.' + prefix + '-building-polygon[data-building-id="' + buildingId + '"]').forEach(p => {
                p.style.fill = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + highlightOpacity + ')';
                p.style.stroke = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.7)';
            });
            const item = document.querySelector('.' + prefix + '-building-item[data-building-id="' + buildingId + '"]');
            if (item) { item.classList.add('highlighted'); item.style.borderLeftColor = hc; }
        }

        function unhighlight(buildingId) {
            currentHighlighted.delete(buildingId);
            if (buildingId === selectedBuildingId) return;
            document.querySelectorAll('.' + prefix + '-building-polygon[data-building-id="' + buildingId + '"]').forEach(p => {
                p.style.fill = 'rgba(255,255,0,0)';
                p.style.stroke = 'none';
            });
            const item = document.querySelector('.' + prefix + '-building-item[data-building-id="' + buildingId + '"]');
            if (item) { item.classList.remove('highlighted'); item.style.borderLeftColor = ''; }
        }

        function hidePopup() {
            if (selectedBuildingId) { const prev = selectedBuildingId; selectedBuildingId = null; unhighlight(prev); }
            const c = document.querySelector('.' + prefix + '-selection-circle'); if (c) c.remove();
            const d = document.querySelector('.' + prefix + '-dim-overlay'); if (d) d.remove();
            const m = document.getElementById(prefix + '-selection-mask'); if (m) m.remove();
            const mo = document.getElementById(prefix + '-modal-overlay'); if (mo) mo.classList.remove('active');
        }

        function showPopup(building) {
            hidePopup();
            selectedBuildingId = building.id;
            highlight(building.id);

            const polygon = document.querySelector('.' + prefix + '-building-polygon[data-building-id="' + building.id + '"]');
            if (!polygon) return;

            const polys = building.polygons || [building.polygon];
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            polys.forEach(poly => poly.forEach(([x, y]) => {
                minX = Math.min(minX, x); maxX = Math.max(maxX, x);
                minY = Math.min(minY, y); maxY = Math.max(maxY, y);
            }));
            const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
            const radius = Math.max(Math.max(maxX - minX, maxY - minY) / 2 * 1.8, 0.04);

            const svg = polygon.closest('svg');
            const vb = svg.getAttribute('viewBox').split(' ');
            const svgW = parseFloat(vb[2]), svgH = parseFloat(vb[3]);

            let defs = svg.querySelector('defs');
            if (!defs) { defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs'); svg.insertBefore(defs, svg.firstChild); }

            const mask = document.createElementNS('http://www.w3.org/2000/svg', 'mask');
            mask.setAttribute('id', prefix + '-selection-mask');
            const mr = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            mr.setAttribute('width', svgW); mr.setAttribute('height', svgH); mr.setAttribute('fill', 'white');
            mask.appendChild(mr);
            const mc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            mc.setAttribute('cx', centerX * svgW); mc.setAttribute('cy', centerY * svgH);
            mc.setAttribute('r', radius * Math.max(svgW, svgH)); mc.setAttribute('fill', 'black');
            mask.appendChild(mc);
            defs.appendChild(mask);

            const dr = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            dr.setAttribute('class', prefix + '-dim-overlay');
            dr.setAttribute('width', svgW); dr.setAttribute('height', svgH);
            dr.setAttribute('mask', 'url(#' + prefix + '-selection-mask)');
            svg.appendChild(dr);

            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('class', prefix + '-selection-circle');
            circle.setAttribute('cx', centerX * svgW); circle.setAttribute('cy', centerY * svgH);
            circle.setAttribute('r', radius * Math.max(svgW, svgH));
            svg.appendChild(circle);

            // Modal
            const modal = document.getElementById(prefix + '-modal-overlay');
            const modalContent = modal.querySelector('.' + prefix + '-modal-content');
            const ne = document.getElementById(prefix + '-modal-nummer');
            if (building.nummer && building.nummer.trim()) { ne.textContent = building.nummer; ne.style.display = 'block'; } else { ne.style.display = 'none'; }
            document.getElementById(prefix + '-modal-title').textContent = building.name;
            const bc = document.getElementById(prefix + '-modal-breadcrumb');
            const gruppe = (building.gruppe || '').trim();
            if (gruppe) { bc.innerHTML = gruppe.split(/\s*>\s*/).map(p => '<span>' + escapeHtml(p) + '</span>').join(''); bc.style.display = 'block'; } else { bc.style.display = 'none'; }
            const bd = document.getElementById(prefix + '-modal-beschreibung');
            if (building.beschreibung && building.beschreibung.trim()) { bd.innerHTML = building.beschreibung; bd.style.display = 'block'; } else { bd.style.display = 'none'; }
            modal.classList.add('active');

            requestAnimationFrame(() => {
                const ic = document.getElementById(imageContainerId);
                if (!ic) return;
                const img = ic.querySelector('img');
                if (!img) return;
                const iw = img.offsetWidth, ih = img.offsetHeight;
                const mR = modalContent.getBoundingClientRect();
                const bx = centerX * iw, by = centerY * ih;
                const crPx = radius * Math.max(iw, ih);
                const gap = modalGap, margin = modalMargin;
                let left, top;
                if (centerX > 0.5) {
                    const tl = (bx - crPx) - gap - mR.width;
                    if (tl >= margin) { left = tl; top = by - mR.height / 2; }
                    else { left = bx - mR.width / 2; top = by + crPx + gap; }
                } else {
                    const tl = (bx + crPx) + gap;
                    if (tl + mR.width <= iw - margin) { left = tl; top = by - mR.height / 2; }
                    else { left = bx - mR.width / 2; top = by + crPx + gap; }
                }
                if (left === bx - mR.width / 2 && top + mR.height > ih - margin) {
                    const ta = by - crPx - gap - mR.height;
                    if (ta >= margin) top = ta;
                }
                left = Math.max(margin, Math.min(left, iw - mR.width - margin));
                top = Math.max(margin, Math.min(top, ih - mR.height - margin));
                modalContent.style.left = left + 'px';
                modalContent.style.top = top + 'px';
            });
        }

        // Build sidebar DOM in a DocumentFragment, then apply in a single container update
        function renderSidebar(container, buildingsData) {
            const fragment = document.createDocumentFragment();

            // Header
            if (sidebarHeaderRenderer) {
                const header = document.createElement('div');
                header.className = prefix + '-sidebar-header';
                header.innerHTML = sidebarHeaderRenderer(buildingsData);
                fragment.appendChild(header);
            }

            // Search bar
            const searchBar = document.createElement('div');
            searchBar.className = prefix + '-search-bar';
            searchBar.innerHTML = '<input type="text" class="' + prefix + '-search-input" placeholder="Geb\u00e4ude suchen...">';
            fragment.appendChild(searchBar);

            // Build group hierarchy (ungrouped buildings go into "Sonstige")
            const buildings = filterDisabled ? buildingsData.buildings.filter(b => !b.disabled) : buildingsData.buildings;
            const groupHierarchy = buildGroupHierarchy(buildings, false);

            function firstBuildingIndex(gd) {
                for (const b of gd.buildings) { const i = buildings.indexOf(b); if (i !== -1) return i; }
                for (const sn of Object.keys(gd.subgroups)) { const i = firstBuildingIndex(gd.subgroups[sn]); if (i !== -1) return i; }
                return Infinity;
            }

            function createBuildingEl(b, paddingLeft) {
                let item;
                if (buildingItemRenderer) {
                    item = buildingItemRenderer(b, paddingLeft);
                } else {
                    item = document.createElement('div');
                    item.className = prefix + '-building-item' + (b.isArea ? ' ed-area-item' : '');
                    item.style.paddingLeft = paddingLeft + 'px';
                    item.setAttribute('data-building-id', b.id);
                    item.setAttribute('data-search-text', [b.name, b.nummer, b.gruppe].filter(Boolean).join(' ').toLowerCase());
                    item.innerHTML = '<div class="' + prefix + '-building-name">' + escapeHtml(b.name) + '</div>';
                    item.addEventListener('mouseenter', () => highlight(b.id));
                    item.addEventListener('mouseleave', () => unhighlight(b.id));
                    item.addEventListener('click', () => { if (onBuildingClick) onBuildingClick(b); });
                }
                return item;
            }

            function renderGroup(groupName, groupData, level) {
                const g = document.createElement('div');
                g.className = prefix + '-group collapsed';
                g.style.marginLeft = (level * 12) + 'px';
                const bids = getAllGroupIds(groupData);
                const nameMatch = groupData.buildings.find(b => b.name === groupName);

                const h = document.createElement('div');
                h.className = prefix + '-group-header';
                if (nameMatch) h.classList.add(prefix + '-group-header-building');
                h.style.paddingLeft = (16 - level * 4) + 'px';
                h.setAttribute('data-search-text', nameMatch ? [nameMatch.name, nameMatch.nummer, nameMatch.gruppe].filter(Boolean).join(' ').toLowerCase() : '');
                h.innerHTML = '<h4>' + escapeHtml(groupName) + '</h4><span class="' + prefix + '-group-toggle">\u25BC</span>';
                h.addEventListener('click', () => {
                    g.classList.toggle('collapsed');
                    if (nameMatch && onBuildingClick) onBuildingClick(nameMatch);
                });
                h.addEventListener('mouseenter', () => bids.forEach(id => highlight(id)));
                h.addEventListener('mouseleave', () => bids.forEach(id => unhighlight(id)));
                g.appendChild(h);

                const ct = document.createElement('div');
                ct.className = prefix + '-group-buildings';
                // Interleave direct buildings and subgroups by array position
                const contentItems = [];
                groupData.buildings.filter(b => b !== nameMatch).forEach(b => {
                    contentItems.push({ type: 'b', building: b, sortKey: buildings.indexOf(b) });
                });
                sortGroupNames(Object.keys(groupData.subgroups)).forEach(sn => {
                    contentItems.push({ type: 'g', name: sn, data: groupData.subgroups[sn], sortKey: firstBuildingIndex(groupData.subgroups[sn]) });
                });
                contentItems.sort((a, b) => a.sortKey - b.sortKey);
                contentItems.forEach(item => {
                    if (item.type === 'b') ct.appendChild(createBuildingEl(item.building, 28 + level * 12));
                    else ct.appendChild(renderGroup(item.name, item.data, level + 1));
                });
                g.appendChild(ct);
                return g;
            }

            const sidebarContent = document.createElement('div');
            // Render top-level groups ordered by first building position in array
            const topItems = [];
            sortGroupNames(Object.keys(groupHierarchy)).forEach(gn => {
                topItems.push({ name: gn, data: groupHierarchy[gn], sortKey: firstBuildingIndex(groupHierarchy[gn]) });
            });
            topItems.sort((a, b) => a.sortKey - b.sortKey);
            topItems.forEach(item => sidebarContent.appendChild(renderGroup(item.name, item.data, 0)));
            fragment.appendChild(sidebarContent);

            // Single DOM update: clear and append fragment
            container.innerHTML = '';
            container.appendChild(fragment);

            // Bind search after DOM insertion
            container.querySelector('.' + prefix + '-search-input').addEventListener('input', function() {
                filterSidebar(container, this.value);
            });
        }

        function renderMap(container, buildingsData) {
            const { width, height } = buildingsData.image;
            const buildings = filterDisabled ? buildingsData.buildings.filter(b => !b.disabled) : buildingsData.buildings;

            const img = document.createElement('img');
            img.src = buildingsData.image.dataUrl || buildingsData.image.filename;
            img.alt = (buildingsData.title || 'Geb\u00e4udekarte') + ' Karte';

            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', prefix + '-svg-overlay');
            svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
            svg.setAttribute('preserveAspectRatio', aspectRatio);

            // Render areas first (behind), then regular buildings on top
            const sortedBuildings = [...buildings.filter(b => b.isArea), ...buildings.filter(b => !b.isArea)];
            sortedBuildings.forEach(b => {
                const polys = b.polygons || [b.polygon];
                polys.forEach(poly => {
                    if (!poly) return;
                    const p = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                    p.setAttribute('points', poly.map(([x, y]) => (x * width) + ',' + (y * height)).join(' '));
                    p.setAttribute('class', prefix + '-building-polygon' + (b.isArea ? ' ' + prefix + '-area-polygon' : ''));
                    p.setAttribute('data-building-id', b.id);
                    if (b.isArea) {
                        const hc = b.highlightColor || '#2196F3';
                        const m = hc.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
                        if (m) {
                            const r = parseInt(m[1], 16), g = parseInt(m[2], 16), bl = parseInt(m[3], 16);
                            p.style.fill = 'rgba(' + r + ',' + g + ',' + bl + ',0.15)';
                            p.style.stroke = 'rgba(' + r + ',' + g + ',' + bl + ',0.5)';
                        }
                    }
                    p.addEventListener('mouseenter', () => highlight(b.id));
                    p.addEventListener('mouseleave', () => unhighlight(b.id));
                    p.addEventListener('click', (e) => {
                        if (onPolygonClick) onPolygonClick(b, e);
                        else if (onBuildingClick) onBuildingClick(b);
                    });
                    svg.appendChild(p);
                });
            });

            // Modal overlay
            const mo = document.createElement('div');
            mo.className = prefix + '-modal-overlay';
            mo.id = prefix + '-modal-overlay';
            mo.innerHTML = '<div class="' + prefix + '-modal-content">' +
                '<button class="' + prefix + '-modal-close" id="' + prefix + '-modal-close">&times;</button>' +
                '<div class="' + prefix + '-modal-header">' +
                '<div class="' + prefix + '-modal-nummer" id="' + prefix + '-modal-nummer" style="display:none"></div>' +
                '<h5 id="' + prefix + '-modal-title"></h5>' +
                '<div class="' + prefix + '-modal-breadcrumb" id="' + prefix + '-modal-breadcrumb"></div>' +
                '</div>' +
                '<div class="' + prefix + '-modal-beschreibung" id="' + prefix + '-modal-beschreibung" style="display:none"></div>' +
                '</div>';

            container.innerHTML = '';
            container.appendChild(img);
            container.appendChild(svg);
            container.appendChild(mo);

            document.getElementById(prefix + '-modal-close').addEventListener('click', hidePopup);
        }

        function filterSidebar(container, query) {
            const q = query.toLowerCase().trim();
            container.querySelectorAll('.' + prefix + '-building-item').forEach(it => {
                it.style.display = (!q || it.getAttribute('data-search-text').includes(q)) ? '' : 'none';
            });
            container.querySelectorAll('.' + prefix + '-group').forEach(g => {
                const headerMatch = q && g.querySelector(':scope>.' + prefix + '-group-header').getAttribute('data-search-text')?.includes(q);
                const childMatch = Array.from(g.querySelectorAll('.' + prefix + '-building-item')).some(it => it.style.display !== 'none');
                g.style.display = (!q || headerMatch || childMatch) ? '' : 'none';
                if (q && (headerMatch || childMatch)) g.classList.remove('collapsed');
                if (!q) g.classList.add('collapsed');
            });
        }

        return {
            highlight,
            unhighlight,
            hidePopup,
            showPopup,
            renderSidebar,
            renderMap,
            filterSidebar,
            getSelectedId: () => selectedBuildingId,
            setSelectedId: (id) => { selectedBuildingId = id; }
        };
    }

    return { create, buildGroupHierarchy, sortGroupNames, getAllGroupIds };
})();
