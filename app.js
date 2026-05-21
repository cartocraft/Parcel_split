// Global Variables
let map, geojsonData;
let currentParcelLayer = null;
let mapSheetLayer = L.layerGroup(); 
let lengthLabelsLayer = L.layerGroup();
let splitResultsLayer = L.layerGroup(); 
let isLabelsVisible = false;
let activeFeatureData = null; 
let parcelLabelsLayer = L.layerGroup(); 
let currentSheetFeatures = []; // Stores features for dynamic zoom labeling

// 1. Define Base Layers
const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' });
const googleSat = L.tileLayer('http://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',{ maxZoom: 20, subdomains:['mt0','mt1','mt2','mt3'] });
const googleHybrid = L.tileLayer('http://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',{ maxZoom: 20, subdomains:['mt0','mt1','mt2','mt3'] });

// ESRI World Imagery Reference
const esriSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: '&copy; Esri &mdash; Source: Esri'
});

// Initialize Map Control
map = L.map('map', {
    center: [26.79, 86.69],
    zoom: 12,
    layers: [googleHybrid, mapSheetLayer], 
    zoomControl: true 
});

map._controlCorners.bottomcenter = L.DomUtil.create('div', 'leaflet-bottom leaflet-center', map._controlContainer);

// Layer Switching UI Config (Fixed Syntax Error & Added Length Controls)
L.control.layers({
    "Google Hybrid (Sat + Labels)": googleHybrid,
    "Google Satellite (Imagery Only)": googleSat,
    "ESRI World Imagery": esriSat,
    "OpenStreetMap (Standard)": osmLayer
}, {
    "Map Sheet": mapSheetLayer,
    "Parcel Labels (कित्ता नं)": parcelLabelsLayer,
    "Boundary Lengths (जग्गाको नाप)": lengthLabelsLayer
}, { position: 'bottomright', collapsed: true }).addTo(map);

L.control.scale({ position: 'bottomcenter', imperial: false, maxWidth: 150 }).addTo(map);

const NumScaleControl = L.Control.extend({
    options: { position: 'bottomcenter' },
    onAdd: function (map) {
        this._div = L.DomUtil.create('div', 'numerical-scale');
        this.update(map);
        return this._div;
    },
    update: function (map) {
        const y = map.getCenter().lat;
        const res = 156543.03392 * Math.cos(y * Math.PI / 180) / Math.pow(2, map.getZoom());
        const scale = Math.round(res * 39.37 * 96);
        this._div.innerHTML = `Scale: 1:${scale.toLocaleString()}`;
    }
});
const numScale = new NumScaleControl();
map.addControl(numScale);
map.on('zoomend moveend', () => numScale.update(map));

splitResultsLayer.addTo(map);

// UI DOM Accessors
const vdcSelect = document.getElementById('vdc-select');
const wardSelect = document.getElementById('ward-select');
const sheetSelect = document.getElementById('sheet-select');
const parcelSelect = document.getElementById('parcel-select');
const searchBtn = document.getElementById('search-btn');
const sidebar = document.getElementById('sidebar');

// Advanced Splitter UI Accessors
const splitToggleBtn = document.getElementById('toggle-split-btn');
const splitForm = document.getElementById('split-form');
const splitAreaInput = document.getElementById('split-area');
const splitDirSelect = document.getElementById('split-direction');
const executeSplitBtn = document.getElementById('execute-split-btn');
const splitError = document.getElementById('split-error');
const errorDisplay = document.getElementById('error-message');

function toggleSidebar(show) { if(sidebar) sidebar.classList.toggle('-translate-x-full', !show); }
document.getElementById('toggle-sidebar-btn').addEventListener('click', () => toggleSidebar(true));
document.getElementById('close-sidebar-btn').addEventListener('click', () => toggleSidebar(false));
function closeSidebarOnMobile() { if (window.innerWidth < 768) toggleSidebar(false); }

if (splitToggleBtn && splitForm && splitError) {
    splitToggleBtn.addEventListener('click', () => {
        splitForm.classList.toggle('hidden');
        splitError.classList.add('hidden');
    });
}

// Database Connection Fetch Pipeline
console.log("Attempting to fetch data...");
fetch('./TriyugTopo_v4.json')
    .then(res => {
        if (!res.ok) throw new Error(`HTTP error! Status: ${res.status}`);
        return res.json();
    })
    .then(topology => {
        const objectName = Object.keys(topology.objects)[0];
        geojsonData = topojson.feature(topology, topology.objects[objectName]).features;
        
        geojsonData.forEach(f => {
            if (f.properties && f.properties.WARD != null) {
                f.properties.WARD = parseInt(f.properties.WARD, 10).toString(); 
            }
        });
        initializeDropdowns();
    })
    .catch(err => {
        console.error("FATAL ERROR loading JSON:", err);
        if (errorDisplay) {
            errorDisplay.textContent = `Data Fetch Error: ${err.message}`;
            errorDisplay.classList.remove('hidden');
        }
        if (vdcSelect) vdcSelect.innerHTML = '<option>Error loading data</option>';
    });

function initializeDropdowns() {
    if (!vdcSelect || !geojsonData) return;

    const vdcs = [...new Set(geojsonData.map(f => f.properties.Rem))].filter(Boolean).sort();
    populateSelect(vdcSelect, vdcs, "Select Municipality");
    vdcSelect.disabled = false;

    vdcSelect.addEventListener('change', () => {
        if (!wardSelect) return;
        const wards = [...new Set(geojsonData.filter(f => f.properties.Rem === vdcSelect.value).map(f => f.properties.WARD))].filter(Boolean).sort((a,b) => a-b);
        populateSelect(wardSelect, wards, "साविक वडा नं");
        wardSelect.disabled = false;
        resetSelects([sheetSelect, parcelSelect]);
    });

    if (wardSelect) {
        wardSelect.addEventListener('change', () => {
            if (!sheetSelect) return;
            const sheets = [...new Set(geojsonData.filter(f => f.properties.Rem === vdcSelect.value && f.properties.WARD == wardSelect.value).map(f => f.properties.WD))].filter(Boolean).sort();
            populateSelect(sheetSelect, sheets, "सिट नं");
            sheetSelect.disabled = false;
            resetSelects([parcelSelect]);
        });
    }

    if (sheetSelect) {
        sheetSelect.addEventListener('change', () => {
            if (!parcelSelect) return;
            
            const parcels = [...new Set(geojsonData
                .filter(f => f.properties.Rem === vdcSelect.value && f.properties.WARD == wardSelect.value && f.properties.WD == sheetSelect.value)
                .map(f => f.properties.PARCEL_NO))]
                .filter(p => p !== null && p !== undefined && p !== '')
                .sort((a, b) => String(a).localeCompare(String(b), undefined, {numeric: true}));
            
            const dataList = document.getElementById('parcel-datalist');
            if (dataList) {
                dataList.innerHTML = ''; 
                parcels.forEach(p => {
                    const option = document.createElement('option');
                    option.value = p;
                    dataList.appendChild(option);
                });
            }
            parcelSelect.value = ''; 
            parcelSelect.disabled = false;
        });
    }

    if (parcelSelect && searchBtn) {
        parcelSelect.addEventListener('input', () => searchBtn.disabled = !parcelSelect.value.trim());
    }
}

function populateSelect(el, items, placeholder) {
    if (!el) return;
    el.innerHTML = `<option value="">${placeholder}</option>`;
    items.forEach(i => el.innerHTML += `<option value="${i}">${i}</option>`);
}

function resetSelects(els) { 
    els.forEach(el => { 
        if (el) { 
            if (el.tagName === 'INPUT') {
                el.value = ''; 
                el.disabled = true;
                const dataList = document.getElementById(el.getAttribute('list'));
                if (dataList) dataList.innerHTML = ''; 
            } else {
                el.innerHTML = `<option value="">Pending...</option>`; 
                el.disabled = true; 
            }
        }
    }); 
    if (searchBtn) searchBtn.disabled = true; 
}

function convertToBKDK(sqMeters) {
    const sqFt = sqMeters * 10.7639104; 
    const totalDhur = sqFt / 182.25; 
    return `${Math.floor(totalDhur / 400)}-${Math.floor((totalDhur % 400) / 20)}-${Math.floor(totalDhur % 20)}-${Math.round((totalDhur - Math.floor(totalDhur)) * 16)}`;
}

// Map Query Activation Hub
if (searchBtn) {
    searchBtn.addEventListener('click', () => {
        activeFeatureData = geojsonData.find(f => 
            f.properties.Rem === vdcSelect.value && f.properties.WARD == wardSelect.value &&
            f.properties.WD == sheetSelect.value && f.properties.PARCEL_NO == parcelSelect.value
        );

        if (activeFeatureData) {
            generateSheetLayer(); 
            renderMap(activeFeatureData);
            
            if (splitForm) splitForm.classList.add('hidden');
            splitResultsLayer.clearLayers();
            if (splitAreaInput) splitAreaInput.value = '';

            const resPanel = document.getElementById('results-panel');
            const resArea = document.getElementById('res-area');
            const resLu = document.getElementById('res-lu');

            if (resPanel) resPanel.classList.remove('hidden');
            if (resArea) resArea.innerText = convertToBKDK(turf.area(activeFeatureData));
            if (resLu) resLu.innerText = activeFeatureData.properties.LU_ZONE_082 || 'N/A';
            
            closeSidebarOnMobile();
        }
    });
}

function generateSheetLayer() {
    mapSheetLayer.clearLayers();
    const sheetFeatures = geojsonData.filter(f => 
        f.properties.Rem === vdcSelect.value && f.properties.WARD == wardSelect.value && f.properties.WD == sheetSelect.value
    );
    
    currentSheetFeatures = sheetFeatures; 
    renderSmartLabels();
    
    L.geoJSON({ "type": "FeatureCollection", "features": sheetFeatures }, {
        style: { color: '#FFEA00', weight: 1.5, fillColor: '#FFEA00', fillOpacity: 0.05 },
        onEachFeature: function (feature, layer) {
            layer.on('click', function(e) {
                const area = convertToBKDK(turf.area(feature));
                L.popup().setLatLng(e.latlng).setContent(`
                    <div class="min-w-[120px]">
                        <h3 class="font-bold text-gray-800 border-b pb-1 mb-2 text-xs uppercase">Parcel: ${feature.properties.PARCEL_NO || 'N/A'}</h3>
                        <p class="text-xs"><b>Area:</b> ${area}</p>
                    </div>
                `).openOn(map);
            });
        }
    }).addTo(mapSheetLayer);
}

function renderMap(feature) {
    if (currentParcelLayer) map.removeLayer(currentParcelLayer);
    lengthLabelsLayer.clearLayers();

    currentParcelLayer = L.geoJSON(feature, {
        style: { color: '#00FFFF', weight: 4, fillColor: '#00FFFF', fillOpacity: 0.25 }
    }).addTo(map);

    currentParcelLayer.bringToFront();
    map.fitBounds(currentParcelLayer.getBounds(), { padding: [50, 50], maxZoom: 19 });

    if (isLabelsVisible) drawBoundaryLengths(feature);
}

// ==========================================
// Advanced Parcel Split Algorithm (Parallel Edge & L-Shape Sweep)
// ==========================================
function parseBKDKToSqM(input) {
    const parts = input.split('-').map(p => parseFloat(p.trim()));
    if (parts.length < 3 || parts.some(isNaN)) return null;
    const b = parts[0] || 0, k = parts[1] || 0, d = parts[2] || 0, kan = parts[3] || 0;
    return (b * 6772.63) + (k * 338.63) + (d * 16.93) + (kan * 1.058);
}

if (executeSplitBtn) {
    executeSplitBtn.addEventListener('click', () => {
        if(splitError) splitError.classList.add('hidden');
        splitResultsLayer.clearLayers();

        if (!activeFeatureData) return;

        const targetAreaSqM = parseBKDKToSqM(splitAreaInput.value);
        if (!targetAreaSqM) {
            if(splitError) {
                splitError.innerText = "Invalid format. Use B-K-D or B-K-D-K (e.g. 0-1-5-0)";
                splitError.classList.remove('hidden');
            }
            return;
        }

        const totalAreaSqM = turf.area(activeFeatureData);
        if (targetAreaSqM >= totalAreaSqM || targetAreaSqM <= 0) {
            if(splitError) {
                splitError.innerText = `Target area must be between 0 and total area (${convertToBKDK(totalAreaSqM)}).`;
                splitError.classList.remove('hidden');
            }
            return;
        }

        const direction = splitDirSelect.value;
        const cutPoly = performSplit(activeFeatureData, targetAreaSqM, direction);

        if (cutPoly) {
            if (currentParcelLayer) {
                currentParcelLayer.setStyle({ color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.1, weight: 2 });
            }

            L.geoJSON(cutPoly, {
                style: { color: '#FF5722', weight: 3, fillColor: '#FF9800', fillOpacity: 0.6 }
            }).bindPopup(`
                <div class="font-bold text-orange-700 text-xs">Severed Parcel</div>
                <div class="text-xs">Area: ${convertToBKDK(turf.area(cutPoly))}</div>
            `).addTo(splitResultsLayer);
            
            if (isLabelsVisible) {
                lengthLabelsLayer.clearLayers();
                drawBoundaryLengths(activeFeatureData);
                drawBoundaryLengths(cutPoly);
            }
            closeSidebarOnMobile();
        } else {
            if(splitError) {
                splitError.innerText = "Mathematical split failed on this complex geometry.";
                splitError.classList.remove('hidden');
            }
        }
    });
}

function getOuterRing(feature) {
    if (feature.geometry.type === 'Polygon') return feature.geometry.coordinates[0];
    if (feature.geometry.type === 'MultiPolygon') return feature.geometry.coordinates[0][0];
    return [];
}

function getCardinalSweeper(feature, dir, d) {
    const coords = getOuterRing(feature);
    let maxVal = -Infinity;
    let bestA = null, bestB = null;
    
    for (let i = 0; i < coords.length - 1; i++) {
        let A = coords[i], B = coords[i+1];
        let midX = (A[0] + B[0]) / 2, midY = (A[1] + B[1]) / 2;
        let val;
        
        if (dir === 'N') val = midY;
        if (dir === 'S') val = -midY;
        if (dir === 'E') val = midX;
        if (dir === 'W') val = -midX;
        
        if (val > maxVal) { maxVal = val; bestA = A; bestB = B; }
    }
    
    let dx = bestB[0] - bestA[0], dy = bestB[1] - bestA[1];
    let len = Math.sqrt(dx*dx + dy*dy);
    let ux = dx / len, uy = dy / len;
    
    let nx = -uy, ny = ux;
    const centroid = turf.centerOfMass(feature).geometry.coordinates;
    let cx = centroid[0] - bestA[0], cy = centroid[1] - bestA[1];
    if (nx * cx + ny * cy < 0) { nx = -nx; ny = -ny; }
    
    let P1 = [bestA[0] - 2 * ux, bestA[1] - 2 * uy]; 
    let P2 = [bestB[0] + 2 * ux, bestB[1] + 2 * uy]; 
    let P3 = [P2[0] + d * nx, P2[1] + d * ny];       
    let P4 = [P1[0] + d * nx, P1[1] + d * ny];
    
    return turf.polygon([[P1, P2, P3, P4, P1]]);
}

function getCornerSweeper(feature, dir, d) {
    const coords = getOuterRing(feature);
    let maxVal = -Infinity;
    let bestIdx = -1;
    
    for (let i = 0; i < coords.length - 1; i++) {
        let x = coords[i][0], y = coords[i][1];
        let val;
        if (dir === 'NE') val = x + y;
        if (dir === 'SW') val = -(x + y);
        if (dir === 'NW') val = -x + y;
        if (dir === 'SE') val = x - y;
        if (val > maxVal) { maxVal = val; bestIdx = i; }
    }
    
    let prevIdx = bestIdx === 0 ? coords.length - 2 : bestIdx - 1;
    let nextIdx = bestIdx === coords.length - 1 ? 1 : bestIdx + 1;
    
    let C = coords[bestIdx], A = coords[prevIdx], B = coords[nextIdx];
    let vA = [A[0] - C[0], A[1] - C[1]];
    let vB = [B[0] - C[0], B[1] - C[1]];
    
    let lenA = Math.sqrt(vA[0]*vA[0] + vA[1]*vA[1]);
    let lenB = Math.sqrt(vB[0]*vB[0] + vB[1]*vB[1]);
    let uA = [vA[0]/lenA, vA[1]/lenA];
    let uB = [vB[0]/lenB, vB[1]/lenB];
    
    let P1 = C;
    let P2 = [C[0] + d * uA[0], C[1] + d * uA[1]];
    let P3 = [C[0] + d * uA[0] + d * uB[0], C[1] + d * uA[1] + d * uB[1]];
    let P4 = [C[0] + d * uB[0], C[1] + d * uB[1]];
    
    return turf.polygon([[P1, P2, P3, P4, P1]]);
}

function performSplit(feature, targetArea, dir) {
    let low = 0;
    let high = 0.05; 
    let resultPoly = null;
    
    for (let iter = 0; iter < 60; iter++) {
        let mid = (low + high) / 2;
        let sweeperBox;
        
        if (['N', 'S', 'E', 'W'].includes(dir)) {
            sweeperBox = getCardinalSweeper(feature, dir, mid);
        } else {
            sweeperBox = getCornerSweeper(feature, dir, mid);
        }
        
        let intersection = null;
        try { intersection = turf.intersect(feature, sweeperBox); } catch(e) { }
        let currentArea = intersection ? turf.area(intersection) : 0;
        
        if (Math.abs(currentArea - targetArea) <= 1.0 && intersection) { 
            resultPoly = intersection; 
            break; 
        }
        if (currentArea > targetArea) high = mid; else low = mid;
        if (intersection) resultPoly = intersection;
    }
    return resultPoly;
}

// Rotated Boundary Lengths Engine
function drawBoundaryLengths(feature) {
    const coordinates = turf.getCoords(feature);
    const rings = feature.geometry.type === 'MultiPolygon' ? coordinates.flat(1) : coordinates;

    rings.forEach(ring => {
        const groupedSides = groupSegments(ring, 10); 
        groupedSides.forEach(side => {
            if (side.length > 0.5) { 
                const startPt = turf.point(side.points[0]);
                const endPt = turf.point(side.points[side.points.length - 1]);
                const midpoint = turf.midpoint(startPt, endPt);
                
                const p1 = map.project([side.points[0][1], side.points[0][0]]);
                const p2 = map.project([side.points[side.points.length - 1][1], side.points[side.points.length - 1][0]]);
                
                let angle = Math.atan2(p2.y - p1.y, p2.x - p1.x) * (180 / Math.PI);
                if (angle > 90 || angle < -90) angle += 180;

                const coords = turf.getCoord(midpoint);
                const label = L.divIcon({
                    className: 'length-label-container',
                    html: `<div class="length-label" style="transform: rotate(${angle}deg);">${side.length.toFixed(2)}m</div>`,
                    iconSize: [60, 20],
                    iconAnchor: [30, 10]
                });

                L.marker([coords[1], coords[0]], { icon: label }).addTo(lengthLabelsLayer);
            }
        });
    });
}

function groupSegments(ring, tol) {
    if (ring.length < 2) return [];
    let sides = [];
    let currentSide = { length: 0, points: [ring[0]] };
    
    for (let i = 0; i < ring.length - 1; i++) {
        const pt1 = turf.point(ring[i]), pt2 = turf.point(ring[i+1]);
        currentSide.length += turf.distance(pt1, pt2, { units: 'meters' });
        currentSide.points.push(ring[i+1]);
        
        if (i < ring.length - 2) {
            let diff = Math.abs(turf.bearing(pt2, turf.point(ring[i+2])) - turf.bearing(pt1, pt2));
            if (diff > 180) diff = 360 - diff;
            if (diff > tol) { sides.push(currentSide); currentSide = { length: 0, points: [ring[i+1]] }; }
        } else { sides.push(currentSide); }
    }
    return sides;
}

// ==========================================
// Dynamic Smart Labeling Engine (With Arrowheads)
// ==========================================
function renderSmartLabels() {
    parcelLabelsLayer.clearLayers();
    if (!map.hasLayer(parcelLabelsLayer) || currentSheetFeatures.length === 0) return;

    let placedBoxes = []; 

    currentSheetFeatures.forEach(feature => {
        const pNo = feature.properties.PARCEL_NO;
        if (!pNo) return;

        const center = turf.centerOfMass(feature).geometry.coordinates;
        const centerScreen = map.project([center[1], center[0]]); 

        const coords = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates[0] : feature.geometry.coordinates[0][0];
        let maxLen = 0; 
        let angle = 0;
        
        for (let i = 0; i < coords.length - 1; i++) {
            let p1 = map.project([coords[i][1], coords[i][0]]);
            let p2 = map.project([coords[i+1][1], coords[i+1][0]]);
            let dist = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
            if (dist > maxLen) {
                maxLen = dist;
                angle = Math.atan2(p2.y - p1.y, p2.x - p1.x) * (180 / Math.PI);
            }
        }
        if (angle > 90 || angle < -90) angle += 180; 

        const bbox = turf.bbox(feature);
        const swScreen = map.project([bbox[1], bbox[0]]);
        const neScreen = map.project([bbox[3], bbox[2]]);
        const pixelWidth = Math.abs(neScreen.x - swScreen.x);
        const pixelHeight = Math.abs(swScreen.y - neScreen.y);
        
        const isSmall = pixelWidth < 35 || pixelHeight < 20; 
        let labelScreenPt = centerScreen;
        let needsLeader = false;
        
        const halfW = 15; 
        const halfH = 10; 
        let box = { minX: labelScreenPt.x - halfW, maxX: labelScreenPt.x + halfW, minY: labelScreenPt.y - halfH, maxY: labelScreenPt.y + halfH };
        let hasCollision = placedBoxes.some(b => !(box.maxX < b.minX || box.minX > b.maxX || box.maxY < b.minY || box.minY > b.maxY));

        if (hasCollision || isSmall) {
            labelScreenPt = L.point(centerScreen.x + 35, centerScreen.y - 35);
            box = { minX: labelScreenPt.x - halfW, maxX: labelScreenPt.x + halfW, minY: labelScreenPt.y - halfH, maxY: labelScreenPt.y + halfH };
            needsLeader = true;
            angle = 0; 
            
            let stillCollides = placedBoxes.some(b => !(box.maxX < b.minX || box.minX > b.maxX || box.maxY < b.minY || box.minY > b.maxY));
            if (stillCollides) return; 
        }
        
        placedBoxes.push(box); 
        const labelLatLng = map.unproject(labelScreenPt);
        const centerLatLng = map.unproject(centerScreen);

        if (needsLeader) {
            const lineAngle = Math.atan2(labelScreenPt.y - centerScreen.y, labelScreenPt.x - centerScreen.x);
            const tipScreen = L.point(labelScreenPt.x - 16 * Math.cos(lineAngle), labelScreenPt.y - 16 * Math.sin(lineAngle));
            const tipLatLng = map.unproject(tipScreen);

            L.polyline([centerLatLng, tipLatLng], { color: '#ffffff', weight: 4, opacity: 0.8, interactive: false }).addTo(parcelLabelsLayer);
            L.polyline([centerLatLng, tipLatLng], { color: '#374151', weight: 1.5, dashArray: '2, 4', interactive: false }).addTo(parcelLabelsLayer);
            L.circleMarker(centerLatLng, { radius: 2, color: '#374151', fillColor: '#fff', fillOpacity: 1, weight: 1, interactive: false }).addTo(parcelLabelsLayer);

            const arrowLen = 8; 
            const sweepAngle = Math.PI / 6; 
            const p1Screen = L.point(tipScreen.x - arrowLen * Math.cos(lineAngle - sweepAngle), tipScreen.y - arrowLen * Math.sin(lineAngle - sweepAngle));
            const p2Screen = L.point(tipScreen.x - arrowLen * Math.cos(lineAngle + sweepAngle), tipScreen.y - arrowLen * Math.sin(lineAngle + sweepAngle));

            L.polyline([map.unproject(p1Screen), tipLatLng, map.unproject(p2Screen)], { color: '#ffffff', weight: 4, opacity: 0.8, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(parcelLabelsLayer);
            L.polyline([map.unproject(p1Screen), tipLatLng, map.unproject(p2Screen)], { color: '#374151', weight: 1.5, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(parcelLabelsLayer);
        }

        const labelIcon = L.divIcon({
            className: 'length-label-container',
            html: `<div class="parcel-label" style="transform: rotate(${angle}deg);">${pNo}</div>`,
            iconSize: [30, 20],
            iconAnchor: [15, 10]
        });
        L.marker(labelLatLng, { icon: labelIcon, interactive: false }).addTo(parcelLabelsLayer);
    });
}

// Map Event Binding Pipelines
map.on('zoomend', () => renderSmartLabels()); 
parcelLabelsLayer.on('add', () => renderSmartLabels()); 

map.on('overlayadd', function(e) {
    if (e.layer === lengthLabelsLayer) {
        isLabelsVisible = true;
        lengthLabelsLayer.clearLayers(); 
        if (activeFeatureData) {
            drawBoundaryLengths(activeFeatureData); 
            splitResultsLayer.eachLayer(layer => {
                drawBoundaryLengths(layer.toGeoJSON()); 
            });
        }
    }
});

map.on('overlayremove', function(e) {
    if (e.layer === lengthLabelsLayer) {
        isLabelsVisible = false;
        lengthLabelsLayer.clearLayers(); 
    }
});
