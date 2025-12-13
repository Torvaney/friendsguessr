import math
import pathlib
import threading
from dataclasses import dataclass, replace

import exifread
from flask import Flask, render_template
from flask_socketio import SocketIO

app = Flask(__name__)
app.config["SECRET_KEY"] = "dev"
socketio = SocketIO(app, async_mode="threading", cors_allowed_origins="*")

QUESTIONS_DIR = pathlib.Path(__file__).parent / "static" / "questions"


# Image/Question loading


@dataclass(frozen=True)
class Question:
    image_path: pathlib.Path
    latitude: float
    longitude: float


def _ratio_to_float(r):
    return float(r.num) / float(r.den)


def read_gps_latlon(image_path: pathlib.Path) -> tuple[float, float] | None:
    with image_path.open("rb") as f:
        tags = exifread.process_file(f, details=False)

    lat_tag = tags.get("GPS GPSLatitude")
    lat_ref = tags.get("GPS GPSLatitudeRef")
    lon_tag = tags.get("GPS GPSLongitude")
    lon_ref = tags.get("GPS GPSLongitudeRef")

    if not (lat_tag and lat_ref and lon_tag and lon_ref):
        return None

    lat_dms = [_ratio_to_float(x) for x in lat_tag.values]
    lon_dms = [_ratio_to_float(x) for x in lon_tag.values]

    lat = lat_dms[0] + lat_dms[1] / 60.0 + lat_dms[2] / 3600.0
    lon = lon_dms[0] + lon_dms[1] / 60.0 + lon_dms[2] / 3600.0

    if str(lat_ref.values[0]) == "S":
        lat = -lat
    if str(lon_ref.values[0]) == "W":
        lon = -lon

    return lat, lon


def load_questions_from_dir(dir_path: pathlib.Path) -> tuple[Question, ...]:
    questions = []

    for p in sorted(dir_path.iterdir()):
        if p.suffix.lower() not in {".jpg", ".jpeg"}:
            continue

        latlon = read_gps_latlon(p)
        if not latlon:
            print(f"[questions] SKIP {p.name}: no GPS EXIF")
            continue

        lat, lon = latlon
        questions.append(Question(image_path=p, latitude=lat, longitude=lon))

    if not questions:
        raise RuntimeError("No usable questions found")

    print(f"[questions] loaded {len(questions)} question(s)")
    return tuple(questions)


# State


@dataclass(frozen=True)
class Lobby:
    joined: frozenset[str]


@dataclass(frozen=True)
class Guess:
    latitude: float
    longitude: float


@dataclass(frozen=True)
class QuestionRound:
    question: Question
    guesses: dict[str, Guess]
    revealed: bool

    scores: dict[str, float]  # Cumulative. Carried forwards through each round


@dataclass(frozen=True)
class End:
    scores: dict[str, float]


@dataclass(frozen=True)
class State:
    phase: Lobby | QuestionRound | End
    upcoming_questions: tuple[Question]


init = State(
    phase=Lobby(joined=frozenset()),
    upcoming_questions=load_questions_from_dir(QUESTIONS_DIR),
)

## Serialisation...


def image_url_for(path: pathlib.Path) -> str:
    # assumes path is inside ".../static/"
    static_dir = pathlib.Path(__file__).parent / "static"
    rel = path.relative_to(static_dir).as_posix()
    return f"/static/{rel}"


def serialize_state(state: State) -> dict:
    def serialize_phase(phase):
        if isinstance(phase, Lobby):
            return {
                "type": "lobby",
                "joined": sorted(phase.joined),
            }

        if isinstance(phase, QuestionRound):
            return {
                "type": "question",
                "question": {
                    "image_path": image_url_for(phase.question.image_path),
                    "latitude": phase.question.latitude,
                    "longitude": phase.question.longitude if phase.revealed else None,
                },
                "guesses": {
                    name: {"lat": g.latitude, "lon": g.longitude}
                    for name, g in phase.guesses.items()
                },
                "revealed": phase.revealed,
                "scores": phase.scores,
            }

        if isinstance(phase, End):
            return {
                "type": "end",
                "scores": phase.scores,
            }

        raise AssertionError("Unknown phase")

    return {
        "phase": serialize_phase(state.phase),
        "upcoming_questions": len(state.upcoming_questions),
    }


# Update


def add_player(state: State, name: str) -> State:
    if not isinstance(state.phase, Lobby):
        return state

    return replace(
        state,
        phase=replace(
            state.phase,
            joined=state.phase.joined | {name},
        ),
    )


def submit_guess(state: State, name: str, lat: float, lon: float) -> State:
    if not isinstance(state.phase, QuestionRound):
        return state

    if state.phase.revealed:
        return state

    guesses = dict(state.phase.guesses)
    guesses[name] = Guess(lat, lon)

    return replace(
        state,
        phase=replace(
            state.phase,
            guesses=guesses,
        ),
    )


def advance(state: State) -> State:
    phase = state.phase

    # Lobby → first question
    if isinstance(phase, Lobby):
        if not state.upcoming_questions:
            return state

        q, *rest = state.upcoming_questions
        return State(
            phase=QuestionRound(
                question=q,
                guesses={},
                revealed=False,
                scores={name: 0.0 for name in phase.joined},
            ),
            upcoming_questions=tuple(rest),
        )

    # Question round
    if isinstance(phase, QuestionRound):
        # Guessing → reveal
        if not phase.revealed:
            q = phase.question
            scores = dict(phase.scores)

            for name, guess in phase.guesses.items():
                d = haversine_km(
                    guess.latitude,
                    guess.longitude,
                    q.latitude,
                    q.longitude,
                )
                scores[name] += score_from_distance_km(d)

            return replace(
                state,
                phase=replace(
                    phase,
                    revealed=True,
                    scores=scores,
                ),
            )

        # Revealed → next round / end
        if state.upcoming_questions:
            q, *rest = state.upcoming_questions
            return State(
                phase=QuestionRound(
                    question=q,
                    guesses={},
                    revealed=False,
                    scores=phase.scores,
                ),
                upcoming_questions=tuple(rest),
            )

        return replace(state, phase=End(scores=phase.scores))

    return state


# View / Routes


@app.route("/")
def index():
    return render_template("index.html")


# Socket events & global(!) state

state_lock = threading.Lock()
state: State = init


def update(socketio: SocketIO, fn, *args):
    global state
    with state_lock:
        state = fn(state, *args)
        payload = serialize_state(state)
    socketio.emit("state", payload)


@socketio.on("join")
def on_join(data):
    update(socketio, add_player, data["name"])


@socketio.on("guess")
def on_guess(data):
    update(
        socketio,
        submit_guess,
        data["name"],
        data["latitude"],
        data["longitude"],
    )


# Cli loop


def cli_loop():
    while True:
        if input("> ").strip() in {"next", "n"}:
            update(socketio, advance)


# Scoring


def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)

    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def score_from_distance_km(d):
    return max(0.0, 5000.0 * math.exp(-d / 2000.0))


# ---- Main ----
if __name__ == "__main__":
    threading.Thread(target=cli_loop, daemon=True).start()
    socketio.run(app, host="0.0.0.0", port=4242)
