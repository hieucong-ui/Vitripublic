import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getDatabase, ref, set, onValue, onDisconnect, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";

/*
 * REPLACE THESE VALUES with your Firebase Web App configuration.
 * Firebase Console -> Project settings -> Your apps -> Web app.
 */
const firebaseConfig = {
  apiKey: "AIzaSyDEGjFoUTSAAGpEX_ROX9HwFe9h2RvboD8",
  authDomain: "vitri-481ed.firebaseapp.com",
  databaseURL: "https://vitri-481ed-default-rtdb.firebaseio.com",
  projectId: "vitri-481ed",
  storageBucket: "vitri-481ed.firebasestorage.app",
  messagingSenderId: "171298557434",
  appId: "1:171298557434:web:711acf3e896abcbf386843",
  measurementId: "G-TCCPPV9F4B"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const $ = id => document.getElementById(id);
const home = $("home"), room = $("room"), errorEl = $("error");
const nameEl = $("name"), roomInput = $("roomInput");
const createBtn = $("createBtn"), joinBtn = $("joinBtn");
const roomCodeEl = $("roomCode"), statusEl = $("status"), membersEl = $("members");

let uid = null;
let roomId = null;
let displayName = null;
let watchId = null;
let stopRoomListener = null;
let map = null;
const markers = new Map();

const savedName = localStorage.getItem("locationShareName");
if (savedName) nameEl.value = savedName;

onAuthStateChanged(auth, user => {
  uid = user?.uid ?? null;
});

signInAnonymously(auth).catch(err => {
  showError("Không thể kết nối Firebase: " + err.message);
});

createBtn.addEventListener("click", () => startRoom(true));
joinBtn.addEventListener("click", () => startRoom(false));
$("copyBtn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(roomId);
    $("copyBtn").textContent = "Đã sao chép";
    setTimeout(() => $("copyBtn").textContent = "Sao chép", 1200);
  } catch {
    alert("Mã phòng: " + roomId);
  }
});
$("stopBtn").addEventListener("click", stopSharing);

function showError(message) {
  errorEl.textContent = message;
}

function normalizeName() {
  const value = nameEl.value.trim();
  if (!value) throw new Error("Hãy nhập tên máy.");
  displayName = value.slice(0, 20);
  localStorage.setItem("locationShareName", displayName);
}

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

async function waitForAuth() {
  for (let i = 0; i < 50 && !uid; i++) {
    await new Promise(r => setTimeout(r, 100));
  }
  if (!uid) throw new Error("Firebase Authentication chưa sẵn sàng.");
}

async function startRoom(isCreate) {
  showError("");
  try {
    normalizeName();
    await waitForAuth();

    const requested = roomInput.value.trim().toUpperCase();
    roomId = isCreate ? makeRoomCode() : requested;

    if (!isCreate && !/^[A-Z0-9]{6}$/.test(roomId)) {
      throw new Error("Mã phòng phải gồm 6 ký tự.");
    }

    const memberRef = ref(db, `rooms/${roomId}/members/${uid}`);
    await set(memberRef, true);

    roomCodeEl.textContent = roomId;
    home.classList.add("hidden");
    room.classList.remove("hidden");

    initMap();
    subscribeRoom();
    startLocationSharing();
  } catch (err) {
    showError(err.message || "Không thể vào phòng.");
  }
}

function initMap() {
  if (map) return;
  map = L.map("map").setView([16.047, 108.206], 5);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
}

function subscribeRoom() {
  const roomRef = ref(db, `rooms/${roomId}`);
  stopRoomListener = onValue(roomRef, snapshot => {
    const data = snapshot.val() || {};
    const locations = data.locations || {};
    renderLocations(locations);
  }, err => {
    statusEl.textContent = "Lỗi đọc phòng: " + err.message;
  });
}

function renderLocations(locations) {
  const entries = Object.entries(locations);
  membersEl.innerHTML = "";

  let newest = 0;
  for (const [id, loc] of entries) {
    if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") continue;

    const isMe = id === uid;
    const label = loc.name + (isMe ? " (Máy của bạn)" : "");
    const time = loc.updatedAt ? new Date(loc.updatedAt).toLocaleTimeString() : "vừa cập nhật";

    const row = document.createElement("div");
    row.className = "member";
    row.innerHTML = `<span>${escapeHtml(label)}</span><span class="muted">${time}</span>`;
    membersEl.appendChild(row);

    let marker = markers.get(id);
    if (!marker) {
      marker = L.marker([loc.lat, loc.lng]).addTo(map);
      markers.set(id, marker);
    } else {
      marker.setLatLng([loc.lat, loc.lng]);
    }
    marker.bindPopup(`<b>${escapeHtml(label)}</b><br>${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}`);

    if (loc.updatedAt > newest) newest = loc.updatedAt;
  }

  for (const [id, marker] of markers) {
    if (!locations[id]) {
      map.removeLayer(marker);
      markers.delete(id);
    }
  }

  statusEl.textContent = entries.length >= 2
    ? "Đã kết nối 2 máy."
    : "Đang chờ máy thứ hai tham gia...";

  // Fit map only when there are at least 2 visible markers.
  const validMarkers = [...markers.values()];
  if (validMarkers.length >= 2) {
    const group = L.featureGroup(validMarkers);
    map.fitBounds(group.getBounds().pad(0.25), { maxZoom: 16 });
  } else if (validMarkers.length === 1) {
    map.setView(validMarkers[0].getLatLng(), 15);
  }
}

function startLocationSharing() {
  if (!navigator.geolocation) {
    statusEl.textContent = "Trình duyệt không hỗ trợ GPS.";
    return;
  }

  statusEl.textContent = "Đang xin quyền vị trí...";

  watchId = navigator.geolocation.watchPosition(async position => {
    const { latitude: lat, longitude: lng, accuracy } = position.coords;

    try {
      const locationRef = ref(db, `rooms/${roomId}/locations/${uid}`);
      await set(locationRef, {
        name: displayName,
        lat,
        lng,
        accuracy: Math.round(accuracy || 0),
        updatedAt: Date.now()
      });

      // If the browser disconnects, remove this device's location.
      onDisconnect(locationRef).remove();

      statusEl.textContent = "Đang chia sẻ vị trí.";
    } catch (err) {
      statusEl.textContent = "Không ghi được vị trí: " + err.message;
    }
  }, err => {
    const messages = {
      1: "Bạn chưa cấp quyền vị trí.",
      2: "Không lấy được vị trí hiện tại.",
      3: "GPS phản hồi quá lâu."
    };
    statusEl.textContent = messages[err.code] || err.message;
  }, {
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 15000
  });
}

async function stopSharing() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  if (roomId && uid) {
    try {
      await set(ref(db, `rooms/${roomId}/locations/${uid}`), null);
      await set(ref(db, `rooms/${roomId}/members/${uid}`), null);
    } catch {}
  }

  if (stopRoomListener) stopRoomListener();
  location.reload();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
