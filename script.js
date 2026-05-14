// ------------------------------------------------------
// Initialize Map
// ------------------------------------------------------

let map = L.map("map").setView([41.8781, -87.6298], 8);

let currentBaseLayer = null;
let currentRouteLayer = null;
let currentStageId = 1;
let currentMarkers = [];
let pointMarkerLookup = {};
let userMarker = null;
let latestUserCoords = null;
let progressIntervalTimer = null;
let selectedProgressIntervalMinutes = 1;


// ------------------------------------------------------
// Leaflet Panes
// Route stays below points.
// ------------------------------------------------------

map.createPane("routePane");
map.getPane("routePane").style.zIndex = 400;

map.createPane("pointPane");
map.getPane("pointPane").style.zIndex = 650;


// ------------------------------------------------------
// Basemap Layers
// ------------------------------------------------------

const basemaps = {
  carto: L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    {
      attribution: "© OpenStreetMap contributors © CARTO",
      maxZoom: 20
    }
  ),

  osm: L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19
    }
  ),

  satellite: L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      attribution: "Tiles © Esri",
      maxZoom: 19
    }
  ),

  google: L.tileLayer(
    "https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",
    {
      attribution: "© Google",
      maxZoom: 20
    }
  )
};


// Add default basemap
currentBaseLayer = basemaps.carto;
currentBaseLayer.addTo(map);


// ------------------------------------------------------
// Color Settings
// ------------------------------------------------------

const colors = {
  fuel: "#2E8B57",
  food: "#E8B923",
  lodging: "#ADD8E6",
  attraction: "#E67E22",
  stop: "#FF0000",
  place: "#FF0000",
  route: "#2D6CDF"
};


// ------------------------------------------------------
// Basemap Change
// ------------------------------------------------------

function changeBasemap(type) {
  if (currentBaseLayer) {
    map.removeLayer(currentBaseLayer);
  }

  currentBaseLayer = basemaps[type];
  currentBaseLayer.addTo(map);

  if (currentRouteLayer) {
    currentRouteLayer.bringToFront();
  }

  currentMarkers.forEach(marker => marker.bringToFront());

  if (userMarker) {
    userMarker.bringToFront();
  }
}


// ------------------------------------------------------
// Start / Switch Stage
// ------------------------------------------------------

function initStage(id) {
  const stage = routeData[id];

  if (!stage) {
    console.error("Stage not found:", id);
    return;
  }

  currentStageId = id;

  clearMapLayers();

  drawRoute(stage);
  drawPoints(stage);
  updatePlacesPanel(stage);
  updateProgressLabels(stage);

  map.flyTo(stage.center, stage.zoom);

  if (latestUserCoords) {
    updateProgressFromUserLocation();
  }
}


function switchStage(id) {
  initStage(id);
}


// ------------------------------------------------------
// Clear Previous Stage
// ------------------------------------------------------

function clearMapLayers() {
  if (currentRouteLayer) {
    map.removeLayer(currentRouteLayer);
    currentRouteLayer = null;
  }

  currentMarkers.forEach(marker => {
    map.removeLayer(marker);
  });

  currentMarkers = [];
  pointMarkerLookup = {};
}


// ------------------------------------------------------
// Draw Route
// ------------------------------------------------------

function drawRoute(stage) {
  currentRouteLayer = L.polyline(stage.mainRoute, {
    color: colors.route,
    weight: 5,
    opacity: 0.85,
    pane: "routePane"
  }).addTo(map);

  const distanceMeters = calculateRouteDistance(stage.mainRoute);
  const km = (distanceMeters / 1000).toFixed(1);
  const miles = (distanceMeters * 0.000621371).toFixed(1);
  const minutes = Math.round(miles * 1.2);

  currentRouteLayer.bindPopup(`
    <strong>${stage.name}</strong>
    <hr>
    Total Route Distance: ${km} km (${miles} mi)<br>
    Estimated Drive Time: ~${minutes} mins
  `);
}


// ------------------------------------------------------
// Draw Points
// ------------------------------------------------------

function drawPoints(stage) {
  stage.points.forEach((point, index) => {
    const pointType = point.type || "place";
    const markerColor = colors[pointType] || colors.place;

    const marker = L.circleMarker(point.coords, {
      radius: pointType === "stop" || pointType === "place" ? 9 : 7,
      fillColor: markerColor,
      color: "#ffffff",
      weight: 2,
      fillOpacity: 0.9,
      pane: "pointPane"
    }).addTo(map);

    const distanceText = getDistanceTextFromPreviousPlace(stage.points, index);

    marker.bindPopup(`
      <strong>${point.name}</strong><br>
      <span>${point.desc || ""}</span><br>
      <small>Type: ${formatType(pointType)}</small><br>
      <small>${distanceText}</small>
    `);

    currentMarkers.push(marker);
    pointMarkerLookup[index] = marker;
  });
}


// ------------------------------------------------------
// Update Left Places Panel
// Includes distance from previous place.
// ------------------------------------------------------

function updatePlacesPanel(stage) {
  const titleContainer = document.getElementById("stage-title");
  const listContainer = document.getElementById("places-list");

  titleContainer.innerText = `${stage.name.split(":")[0]} — Places`;
  listContainer.innerHTML = "";

  const places = stage.points;

  if (!places || places.length === 0) {
    listContainer.innerHTML = `
      <p class="empty-message">No places available for this stage.</p>
    `;
    return;
  }

  places.forEach((place, index) => {
    const placeType = place.type || "place";
    const placeColor = colors[placeType] || colors.place;

    const distanceText = getDistanceTextFromPreviousPlace(places, index);

    const item = document.createElement("div");
    item.className = "place-item";

    item.innerHTML = `
      <div class="place-number" style="background:${placeColor}">
        ${index + 1}
      </div>

      <div class="place-info">
        <h3>${place.name}</h3>
        <p>${place.desc || ""}</p>

        <div class="place-distance">
          ${distanceText}
        </div>

        <span class="place-type" style="background:${placeColor}">
          ${formatType(placeType)}
        </span>
      </div>
    `;

    item.addEventListener("click", () => {
      zoomToPlace(place, index);
    });

    listContainer.appendChild(item);
  });
}


// ------------------------------------------------------
// Distance Between Two Places
// This calculates straight-line distance.
// ------------------------------------------------------

function getDistanceTextFromPreviousPlace(places, index) {
  if (index === 0) {
    return "Starting point";
  }

  const previousPlace = places[index - 1];
  const currentPlace = places[index];

  const distanceKm = calculateDistanceKm(
    previousPlace.coords,
    currentPlace.coords
  );

  return `${distanceKm.toFixed(1)} km from previous place`;
}


function calculateDistanceKm(coordsA, coordsB) {
  const pointA = L.latLng(coordsA[0], coordsA[1]);
  const pointB = L.latLng(coordsB[0], coordsB[1]);

  return pointA.distanceTo(pointB) / 1000;
}


// ------------------------------------------------------
// Total Route Distance
// ------------------------------------------------------

function calculateRouteDistance(routeCoords) {
  let distance = 0;

  for (let i = 1; i < routeCoords.length; i++) {
    const pointA = L.latLng(routeCoords[i - 1][0], routeCoords[i - 1][1]);
    const pointB = L.latLng(routeCoords[i][0], routeCoords[i][1]);

    distance += pointA.distanceTo(pointB);
  }

  return distance;
}


// ------------------------------------------------------
// Zoom to Place
// ------------------------------------------------------

function zoomToPlace(place, index) {
  map.flyTo(place.coords, 14, {
    duration: 1.2
  });

  const marker = pointMarkerLookup[index];

  if (marker) {
    setTimeout(() => {
      marker.openPopup();
    }, 800);
  }
}


// ------------------------------------------------------
// Zoom to Current User Location
// ------------------------------------------------------

function zoomToCurrentLocation() {
  if (latestUserCoords) {
    map.flyTo(latestUserCoords, 15, {
      duration: 1.2
    });

    if (userMarker) {
      setTimeout(() => {
        userMarker.openPopup();
      }, 800);
    }

    return;
  }

  if (!navigator.geolocation) {
    alert("Geolocation is not supported by this browser.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    position => {
      latestUserCoords = [
        position.coords.latitude,
        position.coords.longitude
      ];

      updateUserMarker(latestUserCoords);

      map.flyTo(latestUserCoords, 15, {
        duration: 1.2
      });

      updateProgressFromUserLocation();
    },
    error => {
      alert("Unable to get your current location: " + error.message);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 10000,
      timeout: 10000
    }
  );
}


// ------------------------------------------------------
// User Location Tracking
// ------------------------------------------------------

function trackUser() {
  if (!navigator.geolocation) {
    console.warn("Geolocation is not supported by this browser.");
    return;
  }

  navigator.geolocation.watchPosition(
    position => {
      latestUserCoords = [
        position.coords.latitude,
        position.coords.longitude
      ];

      updateUserMarker(latestUserCoords);
      updateProgressFromUserLocation();
    },
    error => {
      console.warn("Location tracking error:", error.message);
      updateProgressStatus("Location unavailable: " + error.message);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 10000,
      timeout: 10000
    }
  );
}


function updateUserMarker(coords) {
  if (!userMarker) {
    userMarker = L.circleMarker(coords, {
      radius: 10,
      fillColor: "#0057ff",
      color: "#ffffff",
      weight: 3,
      fillOpacity: 1,
      pane: "pointPane"
    }).addTo(map);

    userMarker.bindPopup("Your current location");
  } else {
    userMarker.setLatLng(coords);
  }

  userMarker.bringToFront();
}


// ------------------------------------------------------
// Progress Bar Interval
// ------------------------------------------------------

function changeProgressInterval(minutes) {
  selectedProgressIntervalMinutes = Number(minutes);
  startProgressAutoUpdate();

  updateProgressStatus(
    `Progress will update every ${selectedProgressIntervalMinutes} minute(s).`
  );
}


function startProgressAutoUpdate() {
  if (progressIntervalTimer) {
    clearInterval(progressIntervalTimer);
  }

  progressIntervalTimer = setInterval(() => {
    updateProgressFromUserLocation();
  }, selectedProgressIntervalMinutes * 60 * 1000);
}


// ------------------------------------------------------
// Update Progress Based on User Location
// ------------------------------------------------------

function updateProgressFromUserLocation() {
  if (!latestUserCoords) {
    updateProgressStatus("Waiting for location...");
    return;
  }

  const stage = routeData[currentStageId];

  if (!stage || !stage.mainRoute || stage.mainRoute.length < 2) {
    updateProgressStatus("Route data not available.");
    return;
  }

  const progress = calculateProgressAlongRoute(
    latestUserCoords,
    stage.mainRoute
  );

  updateProgressBar(progress.percent);

  updateProgressStatus(
    `Progress: ${progress.percent.toFixed(1)}% | ` +
    `Nearest route distance: ${progress.nearestDistanceKm.toFixed(2)} km`
  );
}


// ------------------------------------------------------
// Approximate Progress Along Route
// Finds nearest route vertex and calculates cumulative distance.
// This is simple and reliable for your current coordinate-based route.
// ------------------------------------------------------

function calculateProgressAlongRoute(userCoords, routeCoords) {
  const userLatLng = L.latLng(userCoords[0], userCoords[1]);

  let totalDistance = 0;
  let cumulativeDistances = [0];

  for (let i = 1; i < routeCoords.length; i++) {
    const previous = L.latLng(routeCoords[i - 1][0], routeCoords[i - 1][1]);
    const current = L.latLng(routeCoords[i][0], routeCoords[i][1]);

    totalDistance += previous.distanceTo(current);
    cumulativeDistances.push(totalDistance);
  }

  let nearestIndex = 0;
  let nearestDistance = Infinity;

  routeCoords.forEach((coord, index) => {
    const routePoint = L.latLng(coord[0], coord[1]);
    const distanceToUser = userLatLng.distanceTo(routePoint);

    if (distanceToUser < nearestDistance) {
      nearestDistance = distanceToUser;
      nearestIndex = index;
    }
  });

  const distanceTravelled = cumulativeDistances[nearestIndex];
  const percent = totalDistance > 0
    ? (distanceTravelled / totalDistance) * 100
    : 0;

  return {
    percent: Math.max(0, Math.min(100, percent)),
    nearestDistanceKm: nearestDistance / 1000
  };
}


// ------------------------------------------------------
// Update Progress Bar UI
// ------------------------------------------------------

function updateProgressBar(percent) {
  const safePercent = Math.max(0, Math.min(100, percent));

  document.getElementById("user-marker").style.left = `${safePercent}%`;
  document.getElementById("user-progress").style.width = `${safePercent}%`;
}


function updateProgressStatus(message) {
  const progressStatus = document.getElementById("progress-status");

  if (progressStatus) {
    progressStatus.innerText = message;
  }
}


// ------------------------------------------------------
// Progress Labels
// ------------------------------------------------------

function updateProgressLabels(stage) {
  const startLabel = document.getElementById("route-start-label");
  const midStop = document.getElementById("mid-stop");
  const endLabel = document.getElementById("route-end-label");

  if (!stage.points || stage.points.length === 0) {
    startLabel.innerText = "Start";
    midStop.innerText = "Midpoint";
    endLabel.innerText = "End";
    return;
  }

  startLabel.innerText = stage.points[0].name;

  const middleIndex = Math.floor(stage.points.length / 2);
  midStop.innerText = stage.points[middleIndex].name;

  endLabel.innerText = stage.points[stage.points.length - 1].name;
}


// ------------------------------------------------------
// Helper: Format Type Label
// ------------------------------------------------------

function formatType(type) {
  if (!type) return "Place";

  return type
    .replace("_", " ")
    .replace(/\b\w/g, character => character.toUpperCase());
}


// ------------------------------------------------------
// Start App
// ------------------------------------------------------

initStage(1);
trackUser();
startProgressAutoUpdate();