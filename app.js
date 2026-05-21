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

// ESRI World Imagery
const esriSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: '&copy; Esri &mdash; Source: Esri'
});

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
    "ESRI World Imagery": esriSat,
    "OpenStreetMap (Standard)": osmLayer
}, {
    "Map Sheet": mapSheetLayer, // <--- FIXED: Added missing comma here
    "Parcel Labels (कित्ता नं)": parcelLabelsLayer
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

// UI Elements (Safely mapped)
const vdcSelect = document.getElementById('vdc-select');
const wardSelect = document.getElementById('ward-select');
const sheetSelect = document.getElementById('sheet-select');
const parcelSelect = document.getElementById('parcel-select');
const searchBtn = document.getElementById('search-btn');
const toggleLabels = document.getElementById('toggle-labels');
const sidebar = document.getElementById('sidebar');

// Split Tool Elements (Safely mapped)
const splitToggleBtn = document.getElementById('toggle-split-btn');
const splitForm = document.getElementById('split-form');
const splitAreaInput = document.getElementById('split-area');
const splitDirSelect = document.getElementById('split-direction');
const executeSplitBtn = document.getElementById('execute-split-btn');
const splitError = document.getElementById('split-error');
const errorDisplay = document.getElementById('error-message');
