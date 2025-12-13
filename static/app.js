/* global L, io */

(() => {
  // ---- State ----
  const els = {
    connBadge: document.getElementById("connBadge"),
    loginPanel: document.getElementById("loginPanel"),
    nameInput: document.getElementById("nameInput"),
    joinBtn: document.getElementById("joinBtn"),
    playerName: document.getElementById("playerName"),

    phaseBanner: document.getElementById("phaseBanner"),
    imageWrap: document.getElementById("imageWrap"),
    questionImage: document.getElementById("questionImage"),

    roundLabel: document.getElementById("roundLabel"),
    remainingLabel: document.getElementById("remainingLabel"),

    submitBtn: document.getElementById("submitBtn"),
    clearBtn: document.getElementById("clearBtn"),
    statusText: document.getElementById("statusText"),

    playersList: document.getElementById("playersList"),
    playersEmpty: document.getElementById("playersEmpty"),

    scoresEmpty: document.getElementById("scoresEmpty"),
    scoresList: document.getElementById("scoresList"),
  };

  const storageKey = "geoquiz.name";
  let myName = localStorage.getItem(storageKey) || "";

  let socket = null;

  // Current “server state” snapshot
  let serverState = null;

  // My local guess (not necessarily submitted yet)
  let myGuess = null; // {lat, lon}
  let myGuessMarker = null;

  // Markers for all guesses + the answer
  let othersLayer = null;
  let answerMarker = null;
  let answerLineLayer = null;

  // ---- Map ----
  const map = L.map("map", {
    worldCopyJump: true,
    zoomControl: true,
  }).setView([20, 0], 2);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  othersLayer = L.layerGroup().addTo(map);
  answerLineLayer = L.layerGroup().addTo(map);

  function setConnBadge(text, ok) {
    els.connBadge.textContent = text;
    els.connBadge.className =
      "text-xs px-3 py-1 rounded-full " +
      (ok ? "bg-emerald-900/40 border border-emerald-700 text-emerald-200" : "bg-slate-800 text-slate-200");
  }

  function banner(text, kind) {
    els.phaseBanner.classList.remove("hidden");
    let cls = "rounded-xl border px-3 py-2 text-sm ";
    if (kind === "warn") cls += "border-amber-700 bg-amber-900/30 text-amber-100";
    else if (kind === "ok") cls += "border-emerald-700 bg-emerald-900/30 text-emerald-100";
    else cls += "border-slate-700 bg-slate-900/40 text-slate-200";
    els.phaseBanner.className = cls;
    els.phaseBanner.textContent = text;
  }

  function clearBanner() {
    els.phaseBanner.classList.add("hidden");
  }

  function setStatus(text) {
    els.statusText.textContent = text;
  }

  function ensureNameUI() {
    els.nameInput.value = myName;
    els.playerName.textContent = myName || "—";
    els.joinBtn.disabled = !els.nameInput.value.trim();
  }

  // ---- Joining ----
  function join(name) {
    myName = name.trim();
    if (!myName) return;

    localStorage.setItem(storageKey, myName);
    els.playerName.textContent = myName;

    socket.emit("join", { name: myName });
    els.loginPanel.classList.add("hidden");
    setStatus("Joined. Waiting for the game…");
  }

  els.nameInput.addEventListener("input", () => {
    els.joinBtn.disabled = !els.nameInput.value.trim();
  });

  els.joinBtn.addEventListener("click", () => {
    join(els.nameInput.value);
  });

  els.nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") join(els.nameInput.value);
  });

  // ---- Guessing ----
  map.on("click", (e) => {
    if (!serverState) return;
    const phase = serverState.phase?.type;
    if (phase !== "question") return;
    if (serverState.phase.revealed) return;
    if (!myName) return;

    myGuess = { lat: e.latlng.lat, lon: e.latlng.lng };

    if (myGuessMarker) myGuessMarker.remove();
    myGuessMarker = L.marker([myGuess.lat, myGuess.lon]).addTo(map);
    myGuessMarker.bindPopup(`<b>Your guess</b><br/>${myGuess.lat.toFixed(4)}, ${myGuess.lon.toFixed(4)}`);

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
    setStatus("Guess submitted.");
  });

  // ---- Rendering helpers ----
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

  function renderScores(scores) {
    els.scoresList.innerHTML = "";
    if (!scores || Object.keys(scores).length === 0) {
      els.scoresEmpty.textContent = "—";
      return;
    }

    els.scoresEmpty.textContent = "";
    const rows = Object.entries(scores)
      .sort((a, b) => b[1] - a[1])
      .map(([name, score]) => ({ name, score }));

    for (const r of rows) {
      const li = document.createElement("li");
      const isMe = myName && r.name === myName;
      li.className =
        "flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2";
      li.innerHTML = `
        <span class="${isMe ? "font-semibold text-slate-100" : "text-slate-200"}">${escapeHtml(r.name)}</span>
        <span class="tabular-nums text-slate-100">${r.score.toFixed(1)}</span>
      `;
      els.scoresList.appendChild(li);
    }
  }

  function resetPerRoundUI() {
    // Clear local guess
    myGuess = null;
    if (myGuessMarker) {
      myGuessMarker.remove();
      myGuessMarker = null;
    }
    els.submitBtn.disabled = true;
    els.clearBtn.disabled = true;

    // Clear map layers
    othersLayer.clearLayers();
    answerLineLayer.clearLayers();
    if (answerMarker) {
      answerMarker.remove();
      answerMarker = null;
    }
  }

  function renderQuestionPhase(phase, upcomingQuestionsCount) {
    els.imageWrap.classList.remove("hidden");
    els.questionImage.src = phase.question.image_path;

    els.remainingLabel.textContent = String(upcomingQuestionsCount ?? "—");

    // “Round label” is not provided by server; we can infer by remaining.
    // This is optional — you can remove it if you dislike the inference.
    els.roundLabel.textContent = "Question";

    renderScores(phase.scores);

    // Show everyone who has joined (lobby list is only in lobby; we can show guessers here)
    // If you want, you can keep joined list server-side for question rounds too.
    // For now, show guessers as "players" + anyone in scores.
    const players = new Set(Object.keys(phase.scores || {}));
    renderPlayers([...players].sort());

    // Render guesses markers
    othersLayer.clearLayers();
    for (const [name, g] of Object.entries(phase.guesses || {})) {
      const m = L.circleMarker([g.lat, g.lon], { radius: 7 });
      m.bindPopup(`<b>${escapeHtml(name)}</b><br/>${g.lat.toFixed(4)}, ${g.lon.toFixed(4)}`);
      m.addTo(othersLayer);
    }

    if (!phase.revealed) {
      clearBanner();
      setStatus("Click the map to place a pin.");
      // If I already submitted a guess earlier, disable submit
      if (myName && phase.guesses && phase.guesses[myName]) {
        els.submitBtn.disabled = true;
        els.clearBtn.disabled = true;
        setStatus("Guess submitted. Waiting for reveal…");
      }
      return;
    }

    // Revealed: show answer marker and lines to guesses
    banner("Revealed! Actual location is shown on the map.", "ok");
    setStatus("Round revealed.");

    const qLat = phase.question.latitude;
    const qLon = phase.question.longitude;

    // Safety: longitude is only sent when revealed per your backend (it becomes null otherwise)
    if (qLat != null && qLon != null) {
      if (answerMarker) answerMarker.remove();
      answerMarker = L.marker([qLat, qLon]).addTo(map);
      answerMarker.bindPopup(`<b>Actual location</b><br/>${qLat.toFixed(4)}, ${qLon.toFixed(4)}`);

      answerLineLayer.clearLayers();
      for (const [name, g] of Object.entries(phase.guesses || {})) {
        const line = L.polyline(
          [
            [g.lat, g.lon],
            [qLat, qLon],
          ],
          { weight: 2, opacity: 0.7 }
        );
        line.bindPopup(`<b>${escapeHtml(name)}</b> → actual`);
        line.addTo(answerLineLayer);
      }

      // Fit view roughly around all markers
      const pts = [];
      pts.push([qLat, qLon]);
      for (const g of Object.values(phase.guesses || {})) pts.push([g.lat, g.lon]);
      if (pts.length > 1) map.fitBounds(pts, { padding: [30, 30] });
      else map.setView([qLat, qLon], 6);
    }
  }

  function renderLobbyPhase(phase, upcomingQuestionsCount) {
    els.imageWrap.classList.add("hidden");
    els.questionImage.src = "";

    els.roundLabel.textContent = "Lobby";
    els.remainingLabel.textContent = String(upcomingQuestionsCount ?? "—");

    renderPlayers(phase.joined || []);
    els.scoresList.innerHTML = "";
    els.scoresEmpty.textContent = "No scores yet.";

    resetPerRoundUI();

    banner("Waiting for host to start the first question (type 'n' / 'next' in the server console).", "warn");
    setStatus("In lobby.");
  }

  function renderEndPhase(phase) {
    els.imageWrap.classList.add("hidden");
    resetPerRoundUI();
    renderScores(phase.scores || {});
    banner("Game over. Final scores shown on the right.", "ok");
    setStatus("Finished.");
  }

  function renderFromState(s) {
    serverState = s;

    // If user already has a saved name, hide login once connected.
    if (myName) {
      els.loginPanel.classList.add("hidden");
      els.playerName.textContent = myName;
    } else {
      els.loginPanel.classList.remove("hidden");
    }

    // Always show “remaining”
    const remaining = s.upcoming_questions;

    const phase = s.phase;
    if (!phase) return;

    // If we transitioned into a new question, clear per-round UI.
    // Heuristic: when image_path changes or type changes.
    const phaseType = phase.type;
    if (phaseType !== "question") {
      // If leaving question round, clear local markers
      resetPerRoundUI();
    } else {
      // If this is a *new* question, reset
      const img = phase.question?.image_path || "";
      if (renderFromState._lastImg && renderFromState._lastImg !== img) resetPerRoundUI();
      renderFromState._lastImg = img;
    }

    if (phaseType === "lobby") return renderLobbyPhase(phase, remaining);
    if (phaseType === "question") return renderQuestionPhase(phase, remaining);
    if (phaseType === "end") return renderEndPhase(phase);

    console.warn("Unknown phase", phase);
  }
  renderFromState._lastImg = "";

  // ---- Connect socket ----
  function connect() {
    socket = io({
      transports: ["websocket", "polling"],
    });

    socket.on("connect", () => {
      setConnBadge("Connected", true);
      setStatus("Connected.");

      // Auto-join if we have a stored name
      if (myName) socket.emit("join", { name: myName });
    });

    socket.on("disconnect", () => {
      setConnBadge("Disconnected", false);
      setStatus("Disconnected. Trying to reconnect…");
    });

    socket.on("state", (payload) => {
      renderFromState(payload);
    });
  }

  // ---- Small util ----
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
