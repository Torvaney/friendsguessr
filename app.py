import math
import pathlib
import threading
from dataclasses import dataclass, replace

from flask import Flask, render_template
from flask_socketio import SocketIO

app = Flask(__name__)
app.config["SECRET_KEY"] = "dev"
socketio = SocketIO(app, async_mode="threading", cors_allowed_origins="*")


# State


@dataclass(frozen=True)
class Lobby:
    joined: frozenset[str]


@dataclass(frozen=True)
class Guess:
    latitude: float
    longitude: float


@dataclass(frozen=True)
class Question:
    image_path: pathlib.Path
    # TODO: load lat/long from image metadata


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


init = State(phase=Lobby(joined=frozenset()), upcoming_questions=[])

## Serialisation...


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
                    "image_path": str(phase.question.image_path),
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
