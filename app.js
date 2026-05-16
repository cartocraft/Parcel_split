// Global Variables
let map, geojsonData;
let currentParcelLayer = null;
let mapSheetLayer = L.layerGroup(); 
let lengthLabelsLayer = L.layerGroup();
let splitResultsLayer = L.layerGroup(); // NEW: Holds the severed polygon
let isLabelsVisible = false;
let activeFeatureData = null; 

// 1. Define Base Layers
const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' });
const googleSat = L.tileLayer('http://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',{ maxZoom: 20, subdomains:['mt0','mt1','mt2','mt3'] });
const googleHybrid = L.tileLayer('http://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',{ maxZoom: 20, subdomains:['mt0','mt1','mt2','mt3'] });

// Initialize Map
map = L.map('map', {
    center: [26.79, 86.69],
    zoom: 12,
    layers: [googleHybrid, mapSheetLayer], 
    zoomControl: true 
});

map._controlCorners.bottomcenter = L.DomUtil.create('div', 'leaflet-bottom leaflet-center', map._controlContainer);

L.control.layers({
    "Google Hybrid (Sat + Labels)": googleHybrid,
    "Google Satellite (Imagery Only)": googleSat,
    "OpenStreetMap (Standard)": osmLayer
}, {
    "Map Sheet": mapSheetLayer
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

lengthLabelsLayer.addTo(map);
splitResultsLayer.addTo(map);

// UI Elements
const vdcSelect = document.getElementById('vdc-select');
const wardSelect = document.getElementById('ward-select');
const sheetSelect = document.getElementById('sheet-select');
const parcelSelect = document.getElementById('parcel-select');
const searchBtn = document.getElementById('search-btn');
const toggleLabels = document.getElementById('toggle-labels');
const sidebar = document.getElementById('sidebar');

// NEW: Split Tool Elements
const splitToggleBtn = document.getElementById('toggle-split-btn');
const splitForm = document.getElementById('split-form');
const splitAreaInput = document.getElementById('split-area');
const splitDirSelect = document.getElementById('split-direction');
const executeSplitBtn = document.getElementById('execute-split-btn');
const splitError = document.getElementById('split-error');

function toggleSidebar(show) { sidebar.classList.toggle('-translate-x-full', !show); }
document.getElementById('toggle-sidebar-btn').addEventListener('click', () => toggleSidebar(true));
document.getElementById('close-sidebar-btn').addEventListener('click', () => toggleSidebar(false));
function closeSidebarOnMobile() { if (window.innerWidth < 768) toggleSidebar(false); }

splitToggleBtn.addEventListener('click', () => {
    splitForm.classList.toggle('hidden');
    splitError.classList.add('hidden');
});

// Load Data
fetch('./TriyugTopo_v4.json')
    .then(res => res.json())
    .then(topology => {
        const objectName = Object.keys(topology.objects)[0];
        geojsonData = topojson.feature(topology, topology.objects[objectName]).features;
        
        geojsonData.forEach(f => {
            if (f.properties && f.properties.WARD != null) {
                f.properties.WARD = parseInt(f.properties.WARD, 10).toString();
            }
        });
        initializeDropdowns();
    });

function initializeDropdowns() {
    const vdcs = [...new Set(geojsonData.map(f => f.properties.Rem))].filter(Boolean).sort();
    populateSelect(vdcSelect, vdcs, "Select Municipality (Rem)");
    vdcSelect.disabled = false;

    vdcSelect.addEventListener('change', () => {
        const wards = [...new Set(geojsonData.filter(f => f.properties.Rem === vdcSelect.value).map(f => f.properties.WARD))].filter(Boolean).sort((a,b) => a-b);
        populateSelect(wardSelect, wards, "Select Ward No.");
        wardSelect.disabled = false;
        resetSelects([sheetSelect, parcelSelect]);
    });

    wardSelect.addEventListener('change', () => {
        const sheets = [...new Set(geojsonData.filter(f => f.properties.Rem === vdcSelect.value && f.properties.WARD == wardSelect.value).map(f => f.properties.WD))].filter(Boolean).sort();
        populateSelect(sheetSelect, sheets, "Select Sheet No.");
        sheetSelect.disabled = false;
        resetSelects([parcelSelect]);
    });

    sheetSelect.addEventListener('change', () => {
        const parcels = [...new Set(geojsonData.filter(f => f.properties.Rem === vdcSelect.value && f.properties.WARD == wardSelect.value && f.properties.WD == sheetSelect.value).map(f => f.properties.PARCEL_NO))].filter(Boolean).sort((a,b) => a-b);
        populateSelect(parcelSelect, parcels, "Select Parcel No.");
        parcelSelect.disabled = false;
    });

    parcelSelect.addEventListener('change', () => searchBtn.disabled = !parcelSelect.value);
}

function populateSelect(el, items, placeholder) {
    el.innerHTML = `<option value="">${placeholder}</option>`;
    items.forEach(i => el.innerHTML += `<option value="${i}">${i}</option>`);
}
function resetSelects(els) { els.forEach(el => { el.innerHTML = `<option value="">Pending...</option>`; el.disabled = true; }); searchBtn.disabled = true; }

function convertToBKDK(sqMeters) {
    const sqFt = sqMeters * 10.7639104; 
    const totalDhur = sqFt / 182.25; 
    return `${Math.floor(totalDhur / 400)}-${Math.floor((totalDhur % 400) / 20)}-${Math.floor(totalDhur % 20)}-${Math.round((totalDhur - Math.floor(totalDhur)) * 16)}`;
}

// Search Logic
searchBtn.addEventListener('click', () => {
    activeFeatureData = geojsonData.find(f => 
        f.properties.Rem === vdcSelect.value && f.properties.WARD == wardSelect.value &&
        f.properties.WD == sheetSelect.value && f.properties.PARCEL_NO == parcelSelect.value
    );

    if (activeFeatureData) {
        generateSheetLayer(); 
        renderMap(activeFeatureData);
        
        splitForm.classList.add('hidden');
        splitResultsLayer.clearLayers();
        splitAreaInput.value = '';

        document.getElementById('results-panel').classList.remove('hidden');
        document.getElementById('res-area').innerText = convertToBKDK(turf.area(activeFeatureData));
        document.getElementById('res-lu').innerText = activeFeatureData.properties.LU_ZONE_082 || 'N/A';
        closeSidebarOnMobile();
    }
});

function generateSheetLayer() {
    mapSheetLayer.clearLayers();
    const sheetFeatures = geojsonData.filter(f => 
        f.properties.Rem === vdcSelect.value && f.properties.WARD == wardSelect.value && f.properties.WD == sheetSelect.value
    );

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
// NEW: Advanced Parcel Split Algorithm 
// ==========================================

function parseBKDKToSqM(input) {
    const parts = input.split('-').map(p => parseFloat(p.trim()));
    if (parts.length < 3 || parts.some(isNaN)) return null;
    const b = parts[0] || 0, k = parts[1] || 0, d = parts[2] || 0, kan = parts[3] || 0;
    return (b * 6772.63) + (k * 338.63) + (d * 16.93) + (kan * 1.058);
}

executeSplitBtn.addEventListener('click', () => {
    splitError.classList.add('hidden');
    splitResultsLayer.clearLayers();

    if (!activeFeatureData) return;

    const targetAreaSqM = parseBKDKToSqM(splitAreaInput.value);
    if (!targetAreaSqM) {
        splitError.innerText = "Invalid format. Use B-K-D or B-K-D-K (e.g. 0-1-5-0)";
        splitError.classList.remove('hidden');
        return;
    }

    const totalAreaSqM = turf.area(activeFeatureData);
    if (targetAreaSqM >= totalAreaSqM || targetAreaSqM <= 0) {
        splitError.innerText = `Target area must be between 0 and total area (${convertToBKDK(totalAreaSqM)}).`;
        splitError.classList.remove('hidden');
        return;
    }

    // Execute the split
    const direction = splitDirSelect.value;
    const cutPoly = performSplit(activeFeatureData, targetAreaSqM, direction);

    if (cutPoly) {
        // Fade the original parcel
        if (currentParcelLayer) {
            currentParcelLayer.setStyle({ color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.1, weight: 2 });
        }

        // Render the cut portion in distinct orange
        L.geoJSON(cutPoly, {
            style: { color: '#FF5722', weight: 3, fillColor: '#FF9800', fillOpacity: 0.6 }
        }).bindPopup(`
            <div class="font-bold text-orange-700 text-xs">Severed Parcel</div>
            <div class="text-xs">Area: ${convertToBKDK(turf.area(cutPoly))}</div>
        `).addTo(splitResultsLayer);
        
        // Re-draw labels if toggled
        if (isLabelsVisible) {
            drawBoundaryLengths(activeFeatureData);
            drawBoundaryLengths(cutPoly);
        }
        closeSidebarOnMobile();
    } else {
        splitError.innerText = "Mathematical split failed on this complex geometry.";
        splitError.classList.remove('hidden');
    }
});

function performSplit(feature, targetArea, dir) {
    let rotation = 0;
    let sweepDir = dir;

    // To perform diagonal cuts, we temporarily rotate the geographic bounds
    if (dir === 'NE') { rotation = -45; sweepDir = 'N'; }
    if (dir === 'NW') { rotation = 45; sweepDir = 'N'; }
    if (dir === 'SE') { rotation = -45; sweepDir = 'S'; }
    if (dir === 'SW') { rotation = 45; sweepDir = 'S'; }

    let workingPoly = feature;
    const center = turf.centerOfMass(feature);
    
    if (rotation !== 0) {
        workingPoly = turf.transformRotate(feature, rotation, {pivot: center});
    }

    const bbox = turf.bbox(workingPoly); // [minX, minY, maxX, maxY]
    const minX = bbox[0], minY = bbox[1], maxX = bbox[2], maxY = bbox[3];

    let low, high, mid;
    if (sweepDir === 'E' || sweepDir === 'W') { low = minX; high = maxX; }
    else { low = minY; high = maxY; }

    let resultPoly = null;
    let iter = 0;
    
    // Sweeping Line Binary Search
    while(iter < 50) {
        mid = (low + high) / 2;
        let cutBox;
        const pad = 0.005; // Geodesic padding

        if (sweepDir === 'E') cutBox = [mid, minY-pad, maxX+pad, maxY+pad];
        else if (sweepDir === 'W') cutBox = [minX-pad, minY-pad, mid, maxY+pad];
        else if (sweepDir === 'N') cutBox = [minX-pad, mid, maxX+pad, maxY+pad];
        else if (sweepDir === 'S') cutBox = [minX-pad, minY-pad, maxX+pad, mid];

        const intersection = turf.bboxClip(workingPoly, cutBox);
        if (!intersection || intersection.geometry.coordinates.length === 0) {
            if (sweepDir === 'E' || sweepDir === 'N') high = mid; else low = mid;
            iter++; continue;
        }

        const currentArea = turf.area(intersection);
        if (Math.abs(currentArea - targetArea) <= 1.0) { // 1 sq meter tolerance
            resultPoly = intersection;
            break;
        }

        // Adjust bounds to shrink/grow the box
        if (sweepDir === 'E') currentArea > targetArea ? low = mid : high = mid;
        else if (sweepDir === 'W') currentArea > targetArea ? high = mid : low = mid;
        else if (sweepDir === 'N') currentArea > targetArea ? low = mid : high = mid;
        else if (sweepDir === 'S') currentArea > targetArea ? high = mid : low = mid;
        
        resultPoly = intersection;
        iter++;
    }

    if (rotation !== 0 && resultPoly) {
        resultPoly = turf.transformRotate(resultPoly, -rotation, {pivot: center});
    }

    return resultPoly;
}

// Rotated Boundary Lengths
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

toggleLabels.addEventListener('change', (e) => {
    isLabelsVisible = e.target.checked;
    lengthLabelsLayer.clearLayers();
    if (isLabelsVisible && activeFeatureData) {
        drawBoundaryLengths(activeFeatureData);
        // If there are split layers currently on the map, draw their labels too
        splitResultsLayer.eachLayer(layer => {
            drawBoundaryLengths(layer.toGeoJSON());
        });
    }
});
