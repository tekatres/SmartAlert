"""Backtest harness for the trading signal engine.

Replays the engine bar-by-bar over historical Binance Futures klines and
evaluates the forward outcome of every signal (TP1 before SL = WIN). Reports
win-rate per setup / direction / confluence bucket, and can grid-search the
signal thresholds to calibrate how strict the engine should be.

Usage (from backend/):
  python -m scripts.backtest_signals --coins BTC,ETH,SOL --days 30
  python -m scripts.backtest_signals --coins BTC --days 60 --grid --top 15

Notes:
  - Funding rate and Open Interest votes are NEUTRAL in backtests (those
    endpoints only expose current values; only candle data is historical).
  - A WIN is counted when TP1 is touched before SL within the eval window,
    using 15m candles for touch resolution.
"""
from __future__ import annotations

import argparse
import asyncio
import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

import httpx

from app.alert_engine.signal_engine import (
    MIN_ADX,
    MIN_CONFLUENCE,
    MIN_RISK_REWARD,
    SignalThresholds,
    _vote_adx,
    analyze_bar,
)
from app.alert_engine.signal_outcome import evaluate_from_candles
from app.core.logging import get_logger
from app.services.binance_futures import (
    MultiTimeframeKlines,
    fetch_klines_between,
)

logger = get_logger(__name__)

COIN_SYMBOLS: Dict[str, str] = {
    "BTC": "BTCUSDT",
    "ETH": "ETHUSDT",
    "SOL": "SOLUSDT",
    "BNB": "BNBUSDT",
    "XRP": "XRPUSDT",
    "DOGE": "DOGEUSDT",
    "ADA": "ADAUSDT",
    "LINK": "LINKUSDT",
}

WARMUP_DAYS = 30  # history used to warm up EMA200 / StochRSI before eval
TP1_R = 2.2 / 1.5  # ~1.47R if closed fully at TP1 (ATR-based)


@dataclass
class TradeRecord:
    ts: datetime
    symbol: str
    direction: str
    confluence: int
    total: int
    rr: float
    adx: float
    adx_result: object
    signal_type: str
    leverage: int
    votes: list
    entry: float
    sl: float
    tp1: float
    result: str          # "WIN" | "LOSS" | "PENDING"
    hit_level: str


def _build_slices(c1h, c15, c4h) -> Tuple[List[int], List[int]]:
    """For each 1h bar index, the index into c15/c4h up to that bar's time."""
    idx15: List[int] = []
    idx4h: List[int] = []
    j15 = 0
    j4h = 0
    for bar in c1h:
        while j15 < len(c15) and c15[j15].timestamp <= bar.timestamp:
            j15 += 1
        while j4h < len(c4h) and c4h[j4h].timestamp <= bar.timestamp:
            j4h += 1
        idx15.append(j15)
        idx4h.append(j4h)
    return idx15, idx4h


async def load_history(symbol: str, days: int) -> Tuple[list, list, list]:
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days + WARMUP_DAYS)
    start_ms = int(start.timestamp() * 1000)
    end_ms = int(end.timestamp() * 1000)
    async with httpx.AsyncClient(timeout=40) as client:
        c15 = await fetch_klines_between(client, symbol, "15m", start_ms, end_ms)
        c1h = await fetch_klines_between(client, symbol, "1h", start_ms, end_ms)
        c4h = await fetch_klines_between(client, symbol, "4h", start_ms, end_ms)
    logger.info("%s: loaded %d 15m / %d 1h / %d 4h candles", symbol, len(c15), len(c1h), len(c4h))
    return c15, c1h, c4h


def analyze_coin(coin: str, symbol: str, days: int) -> List[TradeRecord]:
    c15, c1h, c4h = asyncio.run(load_history(symbol, days))
    if not c1h:
        return []

    idx15, idx4h = _build_slices(c1h, c15, c4h)
    eval_start = c1h[-1].timestamp - timedelta(days=days)
    records: List[TradeRecord] = []

    for i, bar_candle in enumerate(c1h):
        if bar_candle.timestamp < eval_start:
            continue  # still in warmup

        mtf = MultiTimeframeKlines(
            symbol=symbol,
            coin_id=coin.lower(),
            candles_15m=c15[: idx15[i]],
            candles_1h=c1h[: i + 1],
            candles_4h=c4h[: idx4h[i]],
        )
        bar = analyze_bar(mtf)
        if bar is None:
            continue

        forward = c15[idx15[i]:]
        outcome = evaluate_from_candles(
            forward,
            direction=bar.direction,
            entry_price=bar.entry_price,
            stop_loss=bar.stop_loss,
            take_profit_1=bar.take_profit_1,
            take_profit_2=bar.take_profit_2,
            created_at=bar_candle.timestamp,
        )

        records.append(
            TradeRecord(
                ts=bar_candle.timestamp,
                symbol=coin,
                direction=bar.direction,
                confluence=bar.confluence_score,
                total=bar.confluence_total,
                rr=bar.risk_reward,
                adx=bar.adx,
                adx_result=bar.adx_result,
                signal_type=_label_from_votes(bar),
                leverage=bar.leverage,
                votes=bar.votes,
                entry=bar.entry_price,
                sl=bar.stop_loss,
                tp1=bar.take_profit_1,
                result=outcome.result,
                hit_level=outcome.hit_level,
            )
        )

    logger.info("%s: %d bars analyzed, %d raw setups recorded", coin, i + 1, len(records))
    return records


def _label_from_votes(bar) -> str:
    from app.alert_engine.signal_engine import _label_signal
    return _label_signal(bar.votes, bar.direction)


def _score_with(rec: TradeRecord, min_adx: float) -> Tuple[str, int, int]:
    """Recompute direction/confluence with an ADX vote at `min_adx`."""
    votes = [v for v in rec.votes if v.name != "ADX 1h"]
    votes.append(_vote_adx(rec.adx_result, min_adx))
    ls = sum(v.weight for v in votes if v.vote == "LONG")
    ss = sum(v.weight for v in votes if v.vote == "SHORT")
    total = sum(v.weight for v in votes)
    if ls >= ss:
        return "LONG", ls, total
    return "SHORT", ss, total


def _emitted(rec: TradeRecord, min_confluence: int, min_rr: float, min_adx: float) -> bool:
    if rec.adx < min_adx:
        return False
    if rec.rr < min_rr:
        return False
    _, score, _ = _score_with(rec, min_adx)
    return score >= min_confluence


def aggregate(records: List[TradeRecord]) -> Dict[str, object]:
    settled = [r for r in records if r.result != "PENDING"]
    n = len(settled)
    wins = sum(1 for r in settled if r.result == "WIN")
    losses = n - wins
    winrate = wins / n if n else 0.0
    ev = (TP1_R * winrate - (1 - winrate)) if n else 0.0
    avg_rr = sum(r.rr for r in settled) / n if n else 0.0
    return {
        "signals": len(records),
        "settled": n,
        "wins": wins,
        "losses": losses,
        "winrate": round(winrate, 3),
        "ev_per_trade_r": round(ev, 3),
        "avg_rr": round(avg_rr, 2),
    }


def report(records: List[TradeRecord]) -> None:
    print("\n=== GLOBAL ===")
    print(_fmt(aggregate(records)))

    print("\n=== POR SETUP ===")
    by_setup: Dict[str, List[TradeRecord]] = {}
    for r in records:
        by_setup.setdefault(r.signal_type, []).append(r)
    rows = sorted(
        ((k, aggregate(v)) for k, v in by_setup.items()),
        key=lambda kv: kv[1]["ev_per_trade_r"],
        reverse=True,
    )
    for k, agg in rows:
        print(f"{k:28s} {_fmt(agg)}")

    print("\n=== POR DIRECCIÓN ===")
    for d in ("LONG", "SHORT"):
        sub = [r for r in records if r.direction == d]
        if sub:
            print(f"{d:6s} {_fmt(aggregate(sub))}")

    print("\n=== POR CONFLUENCIA (bucket) ===")
    buckets = {8: [], 7: [], 6: [], 5: [], 4: []}
    for r in records:
        for b in sorted(buckets, reverse=True):
            if r.confluence >= b:
                buckets[b].append(r)
                break
    for b in sorted(buckets, reverse=True):
        if buckets[b]:
            print(f"confluencia>={b:2d} {_fmt(aggregate(buckets[b]))}")


def _fmt(agg: Dict[str, object]) -> str:
    return (
        f"señales={agg['signals']:4d} settled={agg['settled']:4d} "
        f"W={agg['wins']:3d}/L={agg['losses']:3d} "
        f"WR={agg['winrate']*100:5.1f}% EV={agg['ev_per_trade_r']:+.2f}R "
        f"RRmed={agg['avg_rr']:.2f}"
    )


def grid(records: List[TradeRecord], top: int) -> None:
    combos = [
        (c, rr, adx)
        for c in (4, 5, 6, 7, 8)
        for rr in (1.2, 1.5, 1.8, 2.0)
        for adx in (10, 15, 20, 25)
    ]
    results = []
    for c, rr, adx in combos:
        emitted = [r for r in records if _emitted(r, c, rr, adx)]
        if not emitted:
            continue
        agg = aggregate(emitted)
        results.append(
            (c, rr, adx, agg["signals"], agg["settled"], agg["winrate"], agg["ev_per_trade_r"])
        )

    results.sort(key=lambda x: x[6], reverse=True)
    print("\n=== GRID SEARCH (ordenado por EV por trade) ===")
    print(f"{'conf':>5} {'rr':>4} {'adx':>4} {'n':>5} {'settled':>7} {'WR%':>6} {'EV(R)':>7}")
    for c, rr, adx, n, settled, wr, ev in results[:top]:
        print(f"{c:5d} {rr:4.1f} {adx:4d} {n:5d} {settled:7d} {wr*100:6.1f} {ev:+7.2f}")

    best = results[0] if results else None
    if best:
        print(
            f"\nMejor combo: min_confluence={best[0]} min_risk_reward={best[1]:.1f} "
            f"min_adx={best[2]} (EV={best[6]:+.2f}R, n={best[3]})"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Backtest del motor de señales")
    parser.add_argument("--coins", default="BTC,ETH,SOL", help="Coins separadas por coma")
    parser.add_argument("--days", type=int, default=30, help="Días de evaluación")
    parser.add_argument("--grid", action="store_true", help="Grid search de umbrales")
    parser.add_argument("--top", type=int, default=15, help="Top N combos del grid")
    parser.add_argument("--json", action="store_true", help="Salida JSON del global+setups")
    args = parser.parse_args()

    coins = [c.strip().upper() for c in args.coins.split(",") if c.strip()]
    all_records: List[TradeRecord] = []
    for coin in coins:
        symbol = COIN_SYMBOLS.get(coin)
        if not symbol:
            print(f"⚠ desconocido: {coin}", file=sys.stderr)
            continue
        all_records.extend(analyze_coin(coin, symbol, args.days))

    if args.json:
        payload = {
            "global": aggregate(all_records),
            "default_thresholds": {
                "min_confluence": MIN_CONFLUENCE,
                "min_risk_reward": MIN_RISK_REWARD,
                "min_adx": MIN_ADX,
            },
        }
        print(json.dumps(payload, indent=2, default=str))
    else:
        print(f"\nBacktest: {', '.join(coins)} | {args.days}d de evaluación")
        report(all_records)
        if args.grid:
            grid(all_records, args.top)


if __name__ == "__main__":
    main()