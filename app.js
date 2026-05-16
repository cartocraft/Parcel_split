// Global Variables
let map, geojsonData;
let currentParcelLayer = null;
let lengthLabelsLayer = L.layerGroup();
let isLabelsVisible = false;

// Initialize Map
map = L.map('map').setView([26.79, 86.69], 12); // Centered near Triyuga
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);
lengthLabelsLayer.addTo(map);

// UI Elements
const vdcSelect = document.getElementById('vdc-select');
const wardSelect = document.getElementById('ward-select');
const sheetSelect = document.getElementById('sheet-select');
const parcelSelect = document.getElementById('parcel-select');
const searchBtn = document.getElementById('search-btn');
const toggleLabels = document.getElementById('toggle-labels');
const errorDisplay = document.getElementById('error-message');

function showError(message) {
    errorDisplay.textContent = message;
    errorDisplay.classList.remove('hidden');
    console.error(message);
}

// Load TopoJSON Data
fetch('./TriyugTopo_v4.json')
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}. Are you running this via file://?`);
        }
        return response.json();
    })
    .then(topology => {
        console.log("TopoJSON loaded successfully.", topology);
        
        // Dynamically find the object name inside the TopoJSON
        const objectName = Object.keys(topology.objects)[0];
        geojsonData = topojson.feature(topology, topology.objects[objectName]).features;
        
        // Debugging check: Log the properties of the first feature to verify attribute names
        if (geojsonData.length > 0) {
            console.log("Attributes of first parcel:", geojsonData[0].properties);
        } else {
            showError("The TopoJSON file contains no features.");
        }

        initializeDropdowns();
    })
    .catch(err => {
        showError(`Data Fetch Error: ${err.message}. Check console for details.`);
        vdcSelect.innerHTML = '<option>Error loading data</option>';
    });

// 1. Initialize Cascading Dropdowns
function initializeDropdowns() {
    // Extract unique VDCs using 'rem'
    const vdcs = [...new Set(geojsonData.map(f => f.properties.rem))].filter(Boolean).sort();
    
    if (vdcs.length === 0) {
        showError("No VDC (rem) data found in the file. Check attribute names.");
        return;
    }

    populateSelect(vdcSelect, vdcs, "Select VDC");
    vdcSelect.disabled = false;

    vdcSelect.addEventListener('change', () => {
        const selectedVDC = vdcSelect.value;
        const wards = [...new Set(geojsonData
            .filter(f => f.properties.rem === selectedVDC)
            .map(f => f.properties.ward))].filter(Boolean).sort((a,b) => a-b);
        
        populateSelect(wardSelect, wards, "Select Ward");
        wardSelect.disabled = false;
        resetSelects([sheetSelect, parcelSelect]);
    });

    wardSelect.addEventListener('change', () => {
        const sheets = [...new Set(geojsonData
            .filter(f => f.properties.rem === vdcSelect.value && f.properties.ward == wardSelect.value)
            .map(f => f.properties.wd))].filter(Boolean).sort();
        
        populateSelect(sheetSelect, sheets, "Select Sheet");
        sheetSelect.disabled = false;
        resetSelects([parcelSelect]);
    });

    sheetSelect.addEventListener('change', () => {
        const parcels = [...new Set(geojsonData
            .filter(f => f.properties.rem === vdcSelect.value && 
                         f.properties.ward == wardSelect.value && 
                         f.properties.wd == sheetSelect.value)
            .map(f => f.properties.parcel_no))].filter(Boolean).sort((a,b) => a-b);
        
        populateSelect(parcelSelect, parcels, "Select Parcel");
        parcelSelect.disabled = false;
    });

    parcelSelect.addEventListener('change', () => {
        searchBtn.disabled = !parcelSelect.value;
    });
}

// Utility: Populate Select Options
function populateSelect(element, items, defaultText) {
    element.innerHTML = `<option value="">${defaultText}</option>`;
    items.forEach(item => {
        const option = document.createElement('option');
        option.value = item;
        option.textContent = item;
        element.appendChild(option);
    });
}

function resetSelects(elements) {
    elements.forEach(el => {
        el.innerHTML = '<option value="">Pending...</option>';
        el.disabled = true;
    });
    searchBtn.disabled = true;
}

// 2. Nepali Area Conversion Math (Terai System)
function convertToBKDK(sqMeters) {
    const sqFt = sqMeters * 10.7639104; 
    const totalDhur = sqFt / 182.25; 
    
    const bigha = Math.floor(totalDhur / 400);
    const remainingDhur = totalDhur % 400;
    const katha = Math.floor(remainingDhur / 20);
    const dhur = Math.floor(remainingDhur % 20);
    const kanwa = Math.round((remainingDhur - Math.floor(remainingDhur)) * 16);

    return `${bigha} B - ${katha} K - ${dhur} D - ${kanwa} Kanwa`;
}

// 3. Search and Render Logic
searchBtn.addEventListener('click', () => {
    const targetFeature = geojsonData.find(f => 
        f.properties.rem === vdcSelect.value &&
        f.properties.ward == wardSelect.value &&
        f.properties.wd == sheetSelect.value &&
        f.properties.parcel_no == parcelSelect.value
    );

    if (targetFeature) {
        renderMap(targetFeature);
        updateDetailsPanel(targetFeature);
    } else {
        alert("Parcel not found in the loaded data.");
    }
});

function renderMap(feature) {
    if (currentParcelLayer) map.removeLayer(currentParcelLayer);
    lengthLabelsLayer.clearLayers();

    // Draw Polygon
    currentParcelLayer = L.geoJSON(feature, {
        style: {
            color: '#dc2626',
            weight: 3,
            fillColor: '#fca5a5',
            fillOpacity: 0.4
        }
    }).addTo(map);

    // Zoom to Parcel
    map.fitBounds(currentParcelLayer.getBounds(), { padding: [50, 50] });

    if (isLabelsVisible) {
        drawBoundaryLengths(feature);
    }
}

function updateDetailsPanel(feature) {
    document.getElementById('results-panel').classList.remove('hidden');
    
    const areaSqMeters = turf.area(feature);
    document.getElementById('res-area').innerText = convertToBKDK(areaSqMeters);
    
    const landUse = feature.properties.LU_ZONE_082 || 'N/A';
    document.getElementById('res-lu').innerText = landUse;
}

// 4. Boundary Length Calculation (Turf.js)
function drawBoundaryLengths(feature) {
    lengthLabelsLayer.clearLayers();
    const coordinates = turf.getCoords(feature);
    const rings = feature.geometry.type === 'MultiPolygon' ? coordinates.flat(1) : coordinates;

    rings.forEach(ring => {
        for (let i = 0; i < ring.length - 1; i++) {
            const pt1 = turf.point(ring[i]);
            const pt2 = turf.point(ring[i+1]);
            const distance = turf.distance(pt1, pt2, { units: 'meters' });
            
            if (distance > 0.5) { 
                const midpoint = turf.midpoint(pt1, pt2);
                const coords = turf.getCoord(midpoint);
                
                const label = L.divIcon({
                    className: 'length-label',
                    html: `${distance.toFixed(2)}m`,
                    iconSize: [40, 20],
                    iconAnchor: [20, 10]
                });

                L.marker([coords[1], coords[0]], { icon: label }).addTo(lengthLabelsLayer);
            }
        }
    });
}

// Toggle Labels Checkbox
toggleLabels.addEventListener('change', (e) => {
    isLabelsVisible = e.target.checked;
    if (!currentParcelLayer) return;

    if (isLabelsVisible) {
        const activeFeature = currentParcelLayer.toGeoJSON().features[0];
        drawBoundaryLengths(activeFeature);
    } else {
        lengthLabelsLayer.clearLayers();
    }
});
