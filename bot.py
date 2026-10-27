
import asyncio
import random
import time
import aiosqlite

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

DB_PATH = "crash_rocket.db"

ROUND_WAIT = 5
ROUND_DURATION = 20

round_number = 1
round_started = 0.0
crash_at = 2.0
round_phase = "waiting"
round_history = []
round_lock = asyncio.Lock()


class BetRequest(BaseModel):
    user_id: str = "demo"
    amount: int


class PlayerRequest(BaseModel):
    user_id: str = "demo"


async def get_balance(user_id: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT OR IGNORE INTO players (user_id, balance) VALUES (?, 1000)",
            (user_id,)
        )
        await db.commit()

        async with db.execute(
            "SELECT balance FROM players WHERE user_id = ?",
            (user_id,)
        ) as cursor:
            row = await cursor.fetchone()

    return row[0]


async def set_balance(user_id: str, balance: int):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE players SET balance = ? WHERE user_id = ?",
            (balance, user_id)
        )
        await db.commit()


async def ensure_round():
    global round_number, round_started, crash_at, round_phase

    now = time.monotonic()

    if round_phase == "waiting" and now - round_started >= ROUND_WAIT:
        round_phase = "flying"
        round_started = now
        crash_at = round_crash_point()

    elif round_phase == "flying":
        elapsed = now - round_started
        current = min(1000, 1.0 + elapsed * 0.15) ** 1.5

        if current >= crash_at or elapsed >= ROUND_DURATION:
            round_history.insert(0, crash_at)
            async with aiosqlite.connect(DB_PATH) as db:
                await db.execute(
                    """INSERT OR REPLACE INTO rounds
                       (round_number, crash_at, created_at)
                       VALUES (?, ?, ?)""",
                    (round_number, crash_at, time.time())
                )
                await db.commit()
            del round_history[10:]
            round_phase = "crashed"
            round_started = now

    elif round_phase == "crashed" and now - round_started >= 3:
        round_number += 1
        round_phase = "waiting"
        round_started = now


def round_crash_point():
    return round(random.uniform(1.15, 5.0), 2)


def current_multiplier():
    if round_phase != "flying":
        return 1.0

    elapsed = time.monotonic() - round_started
    return round(min(1000, 1.0 + elapsed * 0.15) ** 1.5, 2)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global round_started

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS players (
                user_id TEXT PRIMARY KEY,
                balance INTEGER NOT NULL DEFAULT 1000
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS bets (
                user_id TEXT NOT NULL,
                round_number INTEGER NOT NULL,
                amount INTEGER NOT NULL,
                cashed_out INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (user_id, round_number)
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS rounds (
                round_number INTEGER PRIMARY KEY,
                crash_at REAL NOT NULL,
                created_at REAL NOT NULL
            )
        """)
        await db.commit()

    round_started = time.monotonic()
    yield


app = FastAPI(title="Crash Rocket", lifespan=lifespan)
app.mount("/web", StaticFiles(directory="web"), name="web")


@app.get("/")
async def home():
    return FileResponse("web/index.html")


@app.get("/health")
async def health():
    return {"status": "ok", "game": "Crash Rocket"}


@app.get("/api/state")
async def state(user_id: str = "demo"):
    async with round_lock:
        await ensure_round()

        balance = await get_balance(user_id)
        multiplier = current_multiplier()

        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute(
                """SELECT amount, cashed_out FROM bets
                   WHERE user_id = ? AND round_number = ?""",
                (user_id, round_number)
            ) as cursor:
                bet_row = await cursor.fetchone()

        return {
            "user_id": user_id,
            "balance": balance,
            "round": round_number,
            "phase": round_phase,
            "multiplier": multiplier,
            "crash_at": crash_at if round_phase == "crashed" else None,
            "history": round_history,
            "bet": bet_row[0] if bet_row else 0,
            "cashed_out": bool(bet_row[1]) if bet_row else False,
        }


@app.post("/api/bet")
async def place_bet(request: BetRequest):
    if request.amount < 1 or request.amount > 1000000:
        raise HTTPException(400, "Некорректная сумма ставки")

    async with round_lock:
        await ensure_round()

        if round_phase != "waiting":
            raise HTTPException(400, "Ставки принимаются перед запуском")

        balance = await get_balance(request.user_id)

        if request.amount > balance:
            raise HTTPException(400, "Недостаточно виртуальных монет")

        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute(
                "SELECT 1 FROM bets WHERE user_id = ? AND round_number = ?",
                (request.user_id, round_number)
            ) as cursor:
                existing = await cursor.fetchone()

            if existing:
                raise HTTPException(400, "Ставка на этот раунд уже сделана")

            await db.execute(
                "UPDATE players SET balance = balance - ? WHERE user_id = ?",
                (request.amount, request.user_id)
            )
            await db.execute(
                """INSERT INTO bets (user_id, round_number, amount)
                   VALUES (?, ?, ?)""",
                (request.user_id, round_number, request.amount)
            )
            await db.commit()

        return {"ok": True, "balance": balance - request.amount}


@app.post("/api/cashout")
async def cashout(request: PlayerRequest):
    async with round_lock:
        await ensure_round()

        if round_phase != "flying":
            raise HTTPException(400, "Раунд уже закончился")

        multiplier = current_multiplier()

        if multiplier >= crash_at:
            raise HTTPException(400, "Слишком поздно — раунд закончился")

        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute(
                """SELECT amount, cashed_out FROM bets
                   WHERE user_id = ? AND round_number = ?""",
                (request.user_id, round_number)
            ) as cursor:
                bet_row = await cursor.fetchone()

            if not bet_row:
                raise HTTPException(400, "??????? ?????? ??????")

            amount, already_cashed_out = bet_row

            if already_cashed_out:
                raise HTTPException(400, "??????? ??? ??????")

            payout = int(amount * multiplier)

            cursor = await db.execute(
                """UPDATE bets SET cashed_out = 1
                   WHERE user_id = ? AND round_number = ?
                   AND cashed_out = 0""",
                (request.user_id, round_number)
            )

            if cursor.rowcount != 1:
                raise HTTPException(400, "??????? ??? ??????")

            await db.execute(
                "UPDATE players SET balance = balance + ? WHERE user_id = ?",
                (payout, request.user_id)
            )
            await db.commit()

        return {
            "ok": True,
            "multiplier": multiplier,
            "payout": payout,
            "balance": await get_balance(request.user_id),
        }
