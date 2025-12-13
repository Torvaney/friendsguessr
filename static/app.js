// --- Socket ---
const socket = io({ transports: ["websocket"] });

let myName = localStorage.getItem("quiz_name") || "";
let latestState = null;

// --- UI elements ---
const statusEl = document.getElementById("status");
const phaseTitleEl = document.getElementById("phaseTitle");

const nameModal = document.getElementById("nameModal");
const nameInput = document.getElementById("nameInput");
const joinBtn = document.getElementById("joinBtn");
const nameError = document.getElementById("nameError");

const lobbyCard = document.getElementById("lobbyCard");
const joinedList = document.getElementById("joinedList");

const imageWrap = document.getElementById("imageWrap");
const questionImage = document.getElementById("questionImage");
const revealNote = document.getElementById("revealNote");

const scoreCard = document.getElementById("scoreCard");
const scoreBody = document.getElementById("scoreBody");

const endCard = document.getElementById("endCard");
const guessInfo = document.getElementById("guessInfo");

// --- Map setup (Leaflet) ---
const map = L.map("map", { worldCopyJump: true }).setView([20, 0], 2);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

let myGuessMarker = null;
let othersLayer = L.layerGroup().addTo(map);
let actualMarker = null;

// Click map to set/move guess (only allowed while in question & not revealed)
map.on("click", (e) => {
  if (!latestState) return;
  const phase = latestState.phase;
  if (phase.type !== "question") return;
  if (phase.revealed) return;
  if (!myName) return;

  const { lat, lng } = e.latlng;

  if (!myGuessMarker) {
    myGuessMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
    myGuessMarker.on("dragend", () => {
      const p = myGuessMarker.getLatLng();
      sendGuess(p.lat, p.lng);
      setGuessInfo(p.lat, p.lng);
    });
  } else {
    myGuessMarker.setLatLng([lat, lng]);
  }

  sendGuess(lat, lng);
  setGuessInfo(lat, lng);
});

function setGuessInfo(lat, lon) {
  guessInfo.textContent = `Your guess: ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

function sendGuess(latitude, longitude) {
  socket.emit("guess", { name: myName, latitude, longitude });
}

// --- Join flow ---
function showJoinModal() {
  nameModal.classList.remove("hidden");
  nameInput.value = myName || "";
  setTimeout(() => nameInput.focus(), 50);
}

function hideJoinModal() {
  nameModal.classList.add("hidden");
}

function validateName(n) {
  const name = (n || "").trim();
  if (name.length < 1) return "Name can’t be empty.";
  if (name.length > 24) return "Keep it under 25 chars.";
  if (!/^[a-zA-Z0-9 _.-]+$/.test(name)) return "Use letters/numbers/spaces/_ . - only.";
  return null;
}

function doJoin() {
  const n = nameInput.value;
  const err = validateName(n);
  if (err) {
    nameError.textContent = err;
    nameError.classList.remove("hidden");
    return;
  }
  nameError.classList.add("hidden");

  myName = n.trim();
  localStorage.setItem("quiz_name", myName);
  socket.emit("join", { name: myName });
  hideJoinModal();
}

joinBtn.addEventListener("click", doJoin);
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") doJoin();
});

// --- Socket events ---
socket.on("connect", () => {
  statusEl.textContent = "Connected";
  if (!myName) showJoinModal();
  else socket.emit("join", { name: myName });
});

socket.on("disconnect", () => {
  statusEl.textContent = "Disconnected";
});

socket.on("state", (payload) => {
  latestState = payload;
  render(payload);
});

// --- Rendering ---
function render(state) {
  const phase = state.phase;

  // Reset visibility
  lobbyCard.classList.add("hidden");
  imageWrap.classList.add("hidden");
  scoreCard.classList.add("hidden");
  endCard.classList.add("hidden");
  revealNote.classList.add("hidden");

  // Clear other players markers and actual marker each render
  othersLayer.clearLayers();
  if (actualMarker) {
    map.removeLayer(actualMarker);
    actualMarker = null;
  }

  if (phase.type === "lobby") {
    phaseTitleEl.textContent = "Lobby";
    lobbyCard.classList.remove("hidden");
    renderJoined(phase.joined);
    // Keep map zoomed out
    return;
  }

  if (phase.type === "question") {
    phaseTitleEl.textContent = `Question (${state.upcoming_questions} left after this)`;

    imageWrap.classList.remove("hidden");
    scoreCard.classList.remove("hidden");

    // Image path: backend currently sends a filesystem path string.
    // The simplest convention is: store under /static/... and send that.
    // If you're sending absolute paths, you'll want to change backend to send a URL.
    questionImage.src = normalizeImageUrl(phase.question.image_path);

    renderScores(phase.scores);

    // Show all guesses (including yours) as markers
    // (If you prefer secrecy, you can show them only when phase.revealed === true.)
    for (const [name, g] of Object.entries(phase.guesses || {})) {
      const m = L.circleMarker([g.lat, g.lon], { radius: 7 });
      m.bindTooltip(name, { permanent: false });
      m.addTo(othersLayer);
    }

    // Ensure your draggable marker matches your last submitted guess (if any)
    const myGuess = (phase.guesses || {})[myName];
    if (myGuess) {
      if (!myGuessMarker) {
        myGuessMarker = L.marker([myGuess.lat, myGuess.lon], { draggable: !phase.revealed }).addTo(map);
        if (!phase.revealed) {
          myGuessMarker.on("dragend", () => {
            const p = myGuessMarker.getLatLng();
            sendGuess(p.lat, p.lng);
            setGuessInfo(p.lat, p.lng);
          });
        }
      } else {
        myGuessMarker.setLatLng([myGuess.lat, myGuess.lon]);
        myGuessMarker.dragging?.[phase.revealed ? "disable" : "enable"]();
      }
      setGuessInfo(myGuess.lat, myGuess.lon);
    } else {
      // If no guess yet, keep marker if user placed one this round.
      if (myGuessMarker) myGuessMarker.dragging?.[phase.revealed ? "disable" : "enable"]();
    }

    // Reveal actual location if revealed (backend should provide lat/lon then)
    if (phase.revealed) {
      revealNote.classList.remove("hidden");

      const q = phase.question;
      // Expect q.latitude and q.longitude present when revealed
      if (q.latitude != null && q.longitude != null) {
        actualMarker = L.marker([q.latitude, q.longitude]).addTo(map);
        actualMarker.bindPopup("Actual location").openPopup();
      }
    }
    return;
  }

  if (phase.type === "end") {
    phaseTitleEl.textContent = "End";
    scoreCard.classList.remove("hidden");
    endCard.classList.remove("hidden");
    renderScores(phase.scores);
    return;
  }
}

function renderJoined(names) {
  joinedList.innerHTML = "";
  for (const n of names) {
    const li = document.createElement("li");
    li.textContent = n;
    joinedList.appendChild(li);
  }
}

function renderScores(scores) {
  scoreBody.innerHTML = "";

  const rows = Object.entries(scores || {})
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));

  for (const [name, score] of rows) {
    const tr = document.createElement("tr");
    const tdN = document.createElement("td");
    const tdS = document.createElement("td");

    tdN.textContent = name;
    tdS.textContent = Math.round(score).toString();

    tr.appendChild(tdN);
    tr.appendChild(tdS);
    scoreBody.appendChild(tr);
  }
}

function normalizeImageUrl(pathStr) {
  // Best: backend should send something like "/static/questions/q1.jpg".
  // If it sends "static/questions/q1.jpg", fix it.
  if (!pathStr) return "";
  if (pathStr.startsWith("/static/")) return pathStr;
  if (pathStr.startsWith("static/")) return "/" + pathStr;

  // If it's a filesystem path, try to extract ".../static/..."
  const idx = pathStr.replaceAll("\\", "/").lastIndexOf("/static/");
  if (idx >= 0) return pathStr.replaceAll("\\", "/").slice(idx);

  // Fall back: treat as relative URL
  return pathStr;
}

// Show modal if we don't have a name yet
if (!myName) showJoinModal();
