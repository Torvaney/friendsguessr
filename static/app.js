/* global L, io */

(() => {
  const els = {
    connBadge: document.getElementById("connBadge"),

    lobbyView: document.getElementById("lobbyView"),
    gameView: document.getElementById("gameView"),
    endView: document.getElementById("endView"),

    nameInput: document.getElementById("nameInput"),
    joinBtn: document.getElementById("joinBtn"),
    playerName: document.getElementById("playerName"),

    playersList: document.getElementById("playersList"),
    playersEmpty: document.getElementById("playersEmpty"),

    phaseBanner: document.getElementById("phaseBanner"),
    imageWrap: document.getElementById("imageWrap"),
    questionImage: document.getElementById("questionImage"),

    roundLabel: document.getElementById("roundLabel"),
    remainingLabel: document.getElementById("remainingLabel"),

    submitBtn: document.getElementById("submitBtn"),
    clearBtn: document.getElementById("clearBtn"),
    statusText: document.getElementById("statusText"),

    scoresEmpty: document.getElementById("scoresEmpty"),
    scoresList: document.getElementById("scoresList"),

    endScoresEmpty: document.getElementById("endScoresEmpty"),
    endScoresList: document.getElementById("endScoresList"),
  };

  const storageKey = "geoquiz.name";
  let myName = localStorage.getItem(storageKey) || "";
  let socket = null;
  let serverState = null;

  let myGuess = null;
  let myGuessMarker = null;

  let guessesLayer = null;
  let answerLayer = null;

  // ---- Map ----
  const map = L.map("map", { worldCopyJump: true }).setView([20, 0], 2);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  guessesLayer = L.layerGroup().addTo(map);
  answerLayer = L.layerGroup().addTo(map);

  function setConnBadge(text, ok) {
    els.connBadge.textContent = text;
    els.connBadge.className =
      "text-xs px-3 py-1 rounded-full " +
      (ok
        ? "bg-emerald-900/40 border border-emerald-700 text-emerald-200"
        : "bg-slate-800 text-slate-200");
  }

  function setStatus(text) {
    if (els.statusText) els.statusText.textContent = text;
  }

  function banner(text, kind) {
    if (!els.phaseBanner) return;
    els.phaseBanner.classList.remove("hidden");
    let cls = "rounded-xl border px-3 py-2 text-sm ";
    if (kind === "warn") cls += "border-amber-700 bg-amber-900/30 text-amber-100";
    else if (kind === "ok") cls += "border-emerald-700 bg-emerald-900/30 text-emerald-100";
    else cls += "border-slate-700 bg-slate-900/40 text-slate-200";
    els.phaseBanner.className = cls;
    els.phaseBanner.textContent = text;
  }

  function clearBanner() {
    if (!els.phaseBanner) return;
    els.phaseBanner.classList.add("hidden");
  }

  function showView(which) {
    els.lobbyView.classList.add("hidden");
    els.gameView.classList.add("hidden");
    els.endView.classList.add("hidden");

    if (which === "lobby") els.lobbyView.classList.remove("hidden");
    if (which === "game") els.gameView.classList.remove("hidden");
    if (which === "end") els.endView.classList.remove("hidden");

    // Leaflet needs invalidateSize when container visibility changes
    setTimeout(() => map.invalidateSize(), 0);
  }

    function ensureNameUI() {
    if (els.nameInput) els.nameInput.value = myName;
    if (els.playerName) els.playerName.textContent = myName || "—";

    if (myName) {
        lockNameUI();
    } else if (els.joinBtn) {
        els.joinBtn.disabled = !(els.nameInput && els.nameInput.value.trim());
    }
    }


  function lockNameUI() {
    if (!els.nameInput || !els.joinBtn) return;
    els.nameInput.disabled = true;
    els.nameInput.classList.add("opacity-70", "cursor-not-allowed");
    els.joinBtn.disabled = true;
    els.joinBtn.classList.add("opacity-70", "cursor-not-allowed");
  }

  function join(name) {
    myName = name.trim();
    if (!myName) return;

    localStorage.setItem(storageKey, myName);
    if (els.playerName) els.playerName.textContent = myName;

    socket.emit("join", { name: myName });

    lockNameUI();
    setStatus("Joined.");
  }


  // Lobby join UI events
  els.nameInput.addEventListener("input", () => {
    els.joinBtn.disabled = !els.nameInput.value.trim();
  });
  els.joinBtn.addEventListener("click", () => join(els.nameInput.value));
  els.nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") join(els.nameInput.value);
  });

  // ---- Guessing interaction ----
  map.on("click", (e) => {
    if (!serverState) return;
    const phase = serverState.phase?.type;
    if (phase !== "question") return;
    if (serverState.phase.revealed) return;
    if (!myName) return;

    myGuess = { lat: e.latlng.lat, lon: e.latlng.lng };

    if (myGuessMarker) myGuessMarker.remove();
    myGuessMarker = L.marker([myGuess.lat, myGuess.lon]).addTo(map);
    myGuessMarker.bindPopup(
      `<b>Your guess</b><br/>${myGuess.lat.toFixed(4)}, ${myGuess.lon.toFixed(4)}`
    );

    els.submitBtn.disabled = false;
    els.clearBtn.disabled = false;
    setStatus("Pin placed. Ready to submit.");
  });

  els.clearBtn.addEventListener("click", () => {
    myGuess = null;
    if (myGuessMarker) {
      myGuessMarker.remove();
      myGuessMarker = null;
    }
    els.submitBtn.disabled = true;
    els.clearBtn.disabled = true;
    setStatus("Pin cleared.");
  });

  els.submitBtn.addEventListener("click", () => {
    if (!myGuess || !myName) return;
    socket.emit("guess", {
      name: myName,
      latitude: myGuess.lat,
      longitude: myGuess.lon,
    });
    els.submitBtn.disabled = true;
    setStatus("Guess submitted. Waiting for others…");
  });

  // ---- Rendering ----
  function renderPlayers(joined) {
    els.playersList.innerHTML = "";
    if (!joined || joined.length === 0) {
      els.playersEmpty.classList.remove("hidden");
      return;
    }
    els.playersEmpty.classList.add("hidden");

    for (const name of joined) {
      const li = document.createElement("li");
      const isMe = myName && name === myName;
      li.className =
        "flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2";
      li.innerHTML = `<span class="${isMe ? "font-semibold text-slate-100" : "text-slate-200"}">${escapeHtml(
        name
      )}</span>${isMe ? `<span class="text-xs text-slate-400">you</span>` : ""}`;
      els.playersList.appendChild(li);
    }
  }

  function renderScoresInto(listEl, emptyEl, scores) {
    listEl.innerHTML = "";
    const keys = scores ? Object.keys(scores) : [];
    if (!scores || keys.length === 0) {
      emptyEl.textContent = "—";
      return;
    }
    emptyEl.textContent = "";

    const rows = Object.entries(scores).sort((a, b) => a[1] - b[1]);
    for (const [name, score] of rows) {
      const li = document.createElement("li");
      const isMe = myName && name === myName;
      li.className =
        "flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2";
      li.innerHTML = `
        <span class="${isMe ? "font-semibold text-slate-100" : "text-slate-200"}">${escapeHtml(name)}</span>
        <span class="tabular-nums text-slate-100">${Number(score).toFixed(1)} km</span>
      `;
      listEl.appendChild(li);
    }
  }

  function resetRoundUI() {
    myGuess = null;
    if (myGuessMarker) {
      myGuessMarker.remove();
      myGuessMarker = null;
    }
    guessesLayer.clearLayers();
    answerLayer.clearLayers();

    if (els.submitBtn) els.submitBtn.disabled = true;
    if (els.clearBtn) els.clearBtn.disabled = true;
  }

  function renderLobby(phase, upcomingCount) {
    showView("lobby");
    clearBanner();
    setStatus("In lobby.");

    renderPlayers(phase.joined || []);
    ensureNameUI();

    if (myName && (phase.joined || []).includes(myName)) {
      lockNameUI();
    }
  }


  function renderQuestion(phase, upcomingCount) {
    showView("game");

    els.remainingLabel.textContent = String(upcomingCount ?? "—");
    els.roundLabel.textContent = "Question";

    // Image
    els.imageWrap.classList.remove("hidden");
    els.questionImage.src = phase.question.image_path;

    // Leaderboard (always visible in game)
    renderScoresInto(els.scoresList, els.scoresEmpty, phase.scores);

    // If question changed, clear markers
    const img = phase.question?.image_path || "";
    if (renderQuestion._lastImg && renderQuestion._lastImg !== img) resetRoundUI();
    renderQuestion._lastImg = img;

    // Before reveal: DO NOT show other guesses
    guessesLayer.clearLayers();
    answerLayer.clearLayers();

    if (!phase.revealed) {
      clearBanner();
      setStatus("Click the map to place a pin.");
      // If I already guessed, lock submit
      if (myName && phase.guesses && phase.guesses[myName]) {
        els.submitBtn.disabled = true;
        els.clearBtn.disabled = true;
        setStatus("Guess submitted. Waiting for others…");
      }
      return;
    }

    // Revealed
    banner("Revealed! Pins and answer are shown.", "ok");
    setStatus("Revealed.");

    const qLat = phase.question.latitude;
    const qLon = phase.question.longitude;

    // Draw answer pin
    const answer = L.marker([qLat, qLon]).addTo(answerLayer);
    answer.bindTooltip("Actual location", { permanent: true, direction: "top", offset: [0, -10] });
    answer.bindPopup(`<b>Actual location</b><br/>${qLat.toFixed(4)}, ${qLon.toFixed(4)}`);

    // Draw all guesses + name labels
    const boundsPoints = [[qLat, qLon]];
    for (const [name, g] of Object.entries(phase.guesses || {})) {
      const marker = L.marker([g.lat, g.lon]).addTo(guessesLayer);

      // Permanent label with name next to marker
      marker.bindTooltip(escapeHtml(name), {
        permanent: true,
        direction: "right",
        offset: [10, 0],
        className: "leaflet-tooltip-name",
      });

      marker.bindPopup(`<b>${escapeHtml(name)}</b><br/>${g.lat.toFixed(4)}, ${g.lon.toFixed(4)}`);
      boundsPoints.push([g.lat, g.lon]);
    }

    // Fit to all markers (answer + guesses)
    if (boundsPoints.length >= 2) {
      map.fitBounds(boundsPoints, { padding: [40, 40] });
    } else {
      map.setView([qLat, qLon], 6);
    }
  }
  renderQuestion._lastImg = "";

  function renderEnd(phase) {
    showView("end");
    resetRoundUI();
    clearBanner();
    setStatus("Finished.");

    // End page: leaderboard only
    renderScoresInto(els.endScoresList, els.endScoresEmpty, phase.scores);
  }

  function renderFromState(s) {
    serverState = s;

    // Keep name displayed
    if (els.playerName) els.playerName.textContent = myName || "—";

    const phase = s.phase;
    if (!phase) return;

    if (phase.type === "lobby") return renderLobby(phase, s.upcoming_questions);
    if (phase.type === "question") return renderQuestion(phase, s.upcoming_questions);
    if (phase.type === "end") return renderEnd(phase);

    console.warn("Unknown phase", phase);
  }

  // ---- Connect socket ----
  function connect() {
    socket = io({ transports: ["websocket", "polling"] });

    socket.on("connect", () => {
      setConnBadge("Connected", true);
      setStatus("Connected.");
      if (myName) socket.emit("join", { name: myName });
    });

    socket.on("disconnect", () => {
      setConnBadge("Disconnected", false);
      setStatus("Disconnected. Reconnecting…");
    });

    socket.on("state", (payload) => renderFromState(payload));
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => {
      switch (c) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case '"':
          return "&quot;";
        case "'":
          return "&#39;";
        default:
          return c;
      }
    });
  }

  // ---- Init ----
  ensureNameUI();
  connect();
})();
