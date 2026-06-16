"""JSON-in / JSON-out bridge between the Express server and the Python
CarePilot Referral Copilot scoring pipeline.

Usage::

    python3 referral_cli.py --op <op>     # request JSON on stdin

Supported ops::

    parse        — natural-language → structured referral search params
    search       — run recommend_facilities (+ optional feedback re-rank)
    shortlist    — persist a candidate to the shortlist
    note         — persist a free-text note for a candidate
    review       — persist a review decision for a candidate
    override     — persist a manual score override
    workspace    — read back shortlist + notes + decisions + overrides
    warmup       — load + cache the dataset (no input/output payload needed)

All responses are wrapped as ``{"ok": true, ...}`` on success or
``{"ok": false, "error": "...", "kind": "..."}`` on failure. The Node-side
bridge relies on this contract.

Environment::

    CAREPILOT_BACKEND_DIR    where facility_scoring_pipeline.py + persistence.py live
                             (default: /Users/joon/carepilot-referral)
    CAREPILOT_BACKEND_CSV    cleaned CSV to score against
                             (default: $CAREPILOT_BACKEND_DIR/clean_facilities_v4.csv)
    CAREPILOT_DB_PATH        SQLite path for planner state
                             (default: ~/.carepilot/state.db)
    CAREPILOT_CACHE_DIR      where the prepared-DataFrame pickle is cached
                             (default: $CAREPILOT_BACKEND_DIR/.cache)
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import io
import json
import math
import os
import pickle
import re
import sys
import traceback
from pathlib import Path
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Project + dataset discovery
# ---------------------------------------------------------------------------

BACKEND_DIR = Path(
    os.environ.get("CAREPILOT_BACKEND_DIR", "/Users/joon/carepilot-referral")
).resolve()
BACKEND_CSV = Path(
    os.environ.get("CAREPILOT_BACKEND_CSV", str(BACKEND_DIR / "clean_facilities_v4.csv"))
).resolve()
CACHE_DIR = Path(
    os.environ.get("CAREPILOT_CACHE_DIR", str(BACKEND_DIR / ".cache"))
).resolve()
CACHE_PICKLE = CACHE_DIR / "clean_facilities.pickle"

# Make the Python project importable
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


# ---------------------------------------------------------------------------
# Deterministic city table for the intent parser
# (matches recommendation_demo.py's canonical cities so users get consistent
# results whether they search via CLI or via chat)
# ---------------------------------------------------------------------------

CITY_COORDS: dict[str, tuple[float, float]] = {
    "delhi":     (28.6139, 77.2090),
    "new delhi": (28.6139, 77.2090),
    "mumbai":    (19.0760, 72.8777),
    "bombay":    (19.0760, 72.8777),
    "bengaluru": (12.9716, 77.5946),
    "bangalore": (12.9716, 77.5946),
    "chennai":   (13.0827, 80.2707),
    "madras":    (13.0827, 80.2707),
    "kolkata":   (22.5726, 88.3639),
    "calcutta":  (22.5726, 88.3639),
    "hyderabad": (17.3850, 78.4867),
    "jaipur":    (26.9124, 75.7873),
    "patna":     (25.5941, 85.1376),
    "pune":      (18.5204, 73.8567),
    "ahmedabad": (23.0225, 72.5714),
    "lucknow":   (26.8467, 80.9462),
    "bhopal":    (23.2599, 77.4126),
    "kochi":     (9.9312, 76.2673),
    "ernakulam": (9.9816, 76.2999),
    "thiruvananthapuram": (8.5241, 76.9366),
    "chandigarh": (30.7333, 76.7794),
    "indore":    (22.7196, 75.8577),
    "nagpur":    (21.1458, 79.0882),
    "surat":     (21.1702, 72.8311),
    "vadodara":  (22.3072, 73.1812),
    "coimbatore": (11.0168, 76.9558),
    "guwahati":  (26.1445, 91.7362),
    "bhubaneswar": (20.2961, 85.8245),
    "ranchi":    (23.3441, 85.3096),
    "raipur":    (21.2514, 81.6296),
    "varanasi":  (25.3176, 82.9739),
    "agra":      (27.1767, 78.0081),
    "amritsar":  (31.6340, 74.8723),
    "srinagar":  (34.0837, 74.7973),
    "jammu":     (32.7266, 74.8570),
}

# Tokenised "care need" → canonical condition + a sensible default care_type
# (matches the conditions facility_scoring_pipeline.recommend_facilities knows
# about; resolve_condition_key handles natural-language synonyms downstream)
CARE_NEED_PATTERNS: list[tuple[re.Pattern[str], str, str]] = [
    (re.compile(r"\bdialysis\b|\bkidney\b|\brenal\b|\bnephrolog", re.I), "dialysis", "specialist"),
    (re.compile(r"\bemergenc(?:y|ies)\b|\btrauma\b|\baccident\b|\b24[^a-z]*7\b", re.I), "emergency", "emergency"),
    (re.compile(r"\bsurgery\b|\bsurgical\b|\boperation\b", re.I), "surgery", "specialist"),
    (re.compile(r"\bmaternit(?:y|ies)\b|\bpregnan(?:cy|t)\b|\bantenatal\b|\bobstetric", re.I), "pregnancy", "maternity"),
    (re.compile(r"\bcardiolog|\bheart\b|\bcardiac\b|\bcoronary\b", re.I), "heart", "specialist"),
    (re.compile(r"\boncolog|\bcancer\b|\btumou?r\b", re.I), "cancer", "specialist"),
    (re.compile(r"\bdiabet|\bendocrin", re.I), "diabetes", "chronic"),
    (re.compile(r"\bp(?:a)?ediatric|\bchild(?:ren)?\b|\bneonatal\b", re.I), "child", "specialist"),
    (re.compile(r"\bgeneral\b|\bclinic\b|\bcheck[- ]?up\b|\bopd\b", re.I), "general", "general"),
]


# ---------------------------------------------------------------------------
# Lazy imports + dataset cache
# ---------------------------------------------------------------------------

_pipeline = None  # type: ignore[var-annotated]
_persistence = None  # type: ignore[var-annotated]
_clean_df_cache = None  # type: ignore[var-annotated]


def _load_pipeline():
    """Import facility_scoring_pipeline lazily so import errors surface as JSON."""
    global _pipeline
    if _pipeline is None:
        import facility_scoring_pipeline as fp  # type: ignore[import-not-found]
        _pipeline = fp
    return _pipeline


def _load_persistence():
    global _persistence
    if _persistence is None:
        import persistence as P  # type: ignore[import-not-found]
        # Honour CAREPILOT_DB_PATH if set; persistence.init_db defaults to ~/.carepilot
        db_path = os.environ.get("CAREPILOT_DB_PATH")
        if db_path:
            P.init_db(db_path=Path(db_path))
        else:
            P.init_db()
        _persistence = P
    return _persistence


def _load_clean_df():
    """Return the cleaned + prepared DataFrame, using a pickle cache when possible."""
    global _clean_df_cache
    if _clean_df_cache is not None:
        return _clean_df_cache

    if not BACKEND_CSV.exists():
        raise FileNotFoundError(
            f"CAREPILOT_BACKEND_CSV not found: {BACKEND_CSV}. "
            "Set the env var or place clean_facilities_v4.csv at that path."
        )

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    csv_mtime = BACKEND_CSV.stat().st_mtime
    if CACHE_PICKLE.exists() and CACHE_PICKLE.stat().st_mtime >= csv_mtime:
        with CACHE_PICKLE.open("rb") as fh:
            _clean_df_cache = pickle.load(fh)
        return _clean_df_cache

    fp = _load_pipeline()
    raw = fp.load_and_inspect(BACKEND_CSV)
    clean = fp.clean_invalid_rows(raw)
    clean = fp.deduplicate_facilities(clean)
    clean = fp.normalize_fields(clean)
    clean = fp.rename_baseline_score(clean)
    clean = fp.build_medical_text(clean)
    clean = fp.create_disease_match_scores(clean)
    with CACHE_PICKLE.open("wb") as fh:
        pickle.dump(clean, fh, protocol=pickle.HIGHEST_PROTOCOL)
    _clean_df_cache = clean
    return clean


# ---------------------------------------------------------------------------
# Intent parser (regex + city table; LLM is intentionally not required here)
# ---------------------------------------------------------------------------

_DEFAULT_RANKING = "prioritize_evidence"
_DEFAULT_MAX_DISTANCE_KM = 75.0
_DEFAULT_TOP_N = 10


def _detect_care_need(message: str) -> tuple[Optional[str], Optional[str]]:
    for pattern, care_need, care_type in CARE_NEED_PATTERNS:
        if pattern.search(message):
            return care_need, care_type
    return None, None


def _detect_location(message: str) -> tuple[Optional[str], Optional[float], Optional[float]]:
    """Look for `near <city>` first, then any city token in the message."""
    lower = message.lower()
    near = re.search(r"\bnear\s+([a-zA-Z][a-zA-Z\s]{2,40}?)(?:[.,!?]|$)", lower)
    if near:
        fragment = near.group(1).strip().lower()
        for city in sorted(CITY_COORDS.keys(), key=len, reverse=True):
            if city == fragment or city in fragment:
                lat, lon = CITY_COORDS[city]
                return city.title(), lat, lon

    for city in sorted(CITY_COORDS.keys(), key=len, reverse=True):
        if city in lower:
            lat, lon = CITY_COORDS[city]
            return city.title(), lat, lon

    return None, None, None


def _detect_max_distance(message: str) -> Optional[float]:
    m = re.search(r"\bwithin\s+(\d{1,4})\s*km\b", message, re.I)
    if m:
        return float(m.group(1))
    m = re.search(r"\b(\d{1,4})\s*km\s+(?:radius|away|max|nearby)\b", message, re.I)
    if m:
        return float(m.group(1))
    return None


def _detect_top_n(message: str) -> Optional[int]:
    m = re.search(r"\btop\s+(\d{1,2})\b", message, re.I)
    if m:
        return max(1, min(int(m.group(1)), 30))
    return None


def _detect_priority(message: str) -> Optional[str]:
    lower = message.lower()
    if "closest" in lower or "nearest" in lower or "prioritize distance" in lower:
        return "prioritize_distance"
    if "most trusted" in lower or "trust" in lower:
        return "prioritize_trust"
    if "best evidence" in lower or "most evidence" in lower:
        return "prioritize_evidence"
    return None


def op_parse(payload: dict) -> dict:
    message = (payload.get("message") or "").strip()
    if not message:
        return {
            "ok": False,
            "kind": "empty_message",
            "error": "Empty message — please type a referral request.",
        }

    care_need, care_type = _detect_care_need(message)
    location_text, lat, lon = _detect_location(message)
    max_distance = _detect_max_distance(message) or _DEFAULT_MAX_DISTANCE_KM
    top_n = _detect_top_n(message) or _DEFAULT_TOP_N
    priority = _detect_priority(message) or _DEFAULT_RANKING

    if not care_need and not lat:
        return {
            "ok": False,
            "kind": "needs_clarification",
            "needs_clarification": "both",
            "message": (
                "I could not identify a care need or a location in that message. "
                "Try, for example: \"dialysis near Jaipur\" or \"emergency surgery near Patna\"."
            ),
        }
    if not care_need:
        return {
            "ok": False,
            "kind": "needs_clarification",
            "needs_clarification": "care_need",
            "location_text": location_text,
            "user_lat": lat,
            "user_lon": lon,
            "message": (
                "I picked up a location but not a care need. "
                "Try \"dialysis near %s\" or \"cardiology near %s\"."
            )
            % (location_text or "this city", location_text or "this city"),
        }
    if not lat:
        return {
            "ok": False,
            "kind": "needs_clarification",
            "needs_clarification": "location",
            "care_need": care_need,
            "care_type": care_type,
            "message": (
                "I picked up the care need (%s) but not a location. "
                "Try \"%s near Mumbai\" or any major Indian city."
            )
            % (care_need, care_need),
        }

    return {
        "ok": True,
        "care_need": care_need,
        "care_type": care_type or "specialist",
        "location_text": location_text,
        "user_lat": float(lat),
        "user_lon": float(lon),
        "ranking_priority": priority,
        "max_distance_km": float(max_distance),
        "top_n": int(top_n),
        "needs_clarification": None,
    }


# ---------------------------------------------------------------------------
# Search + persistence ops
# ---------------------------------------------------------------------------

def _scenario_id(P, care_need: str, care_type: str, lat: float, lon: float, max_distance_km: float) -> str:
    # Prefer the persistence helper if present so we stay deterministic across
    # the Streamlit app and this CLI.
    make = getattr(P, "make_scenario_id", None)
    if callable(make):
        try:
            return make(care_need, care_type, lat, lon, max_distance_km)
        except Exception:
            pass
    key = f"{care_need}|{care_type}|{round(lat, 4)}|{round(lon, 4)}|{round(max_distance_km, 1)}"
    return hashlib.sha256(key.encode()).hexdigest()[:24]


def _safe_value(v: Any) -> Any:
    """Coerce a value into something JSON-serialisable. Replaces NaN with None."""
    if v is None:
        return None
    if isinstance(v, float):
        if math.isnan(v) or math.isinf(v):
            return None
        return v
    if isinstance(v, (int, str, bool)):
        return v
    if isinstance(v, (list, tuple)):
        return [_safe_value(x) for x in v]
    if isinstance(v, dict):
        return {str(k): _safe_value(val) for k, val in v.items()}
    # numpy / pandas types
    try:
        import numpy as np  # type: ignore[import-untyped]
        if isinstance(v, (np.integer,)):
            return int(v)
        if isinstance(v, (np.floating,)):
            f = float(v)
            return None if math.isnan(f) or math.isinf(f) else f
        if isinstance(v, (np.bool_,)):
            return bool(v)
        if isinstance(v, np.ndarray):
            return [_safe_value(x) for x in v.tolist()]
    except Exception:
        pass
    return str(v)


def _row_to_candidate(row, rank: int) -> dict:
    """Materialise a pandas Series row into the API contract."""
    def g(key: str, default: Any = None) -> Any:
        if key in row.index:
            return _safe_value(row[key])
        return default

    return {
        "rank": rank,
        "facility_id": str(g("facility_id", "")),
        "facility_name": str(g("facility_name", "")),
        "clean_facility_type": g("clean_facility_type"),
        "clean_city": g("clean_city"),
        "clean_district": g("clean_district"),
        "clean_state": g("clean_state"),
        "latitude": g("latitude"),
        "longitude": g("longitude"),
        "distance_km": g("distance_km"),
        "raw_recommendation_score": g("raw_recommendation_score"),
        "final_recommendation_score": g("final_recommendation_score"),
        "feedback_adjusted_score": g("feedback_adjusted_score"),
        "feedback_delta": g("feedback_delta"),
        "feedback_signals": g("feedback_signals", []),
        "feedback_reason": g("feedback_reason"),
        "score_cap_reason": g("score_cap_reason"),
        "uncertainty_level": g("uncertainty_level"),
        "evidence_strength_score": g("evidence_strength_score"),
        "disease_match_score": g("disease_match_score"),
        "baseline_trust_score": g("baseline_trust_score"),
        "local_need_score": g("local_need_score"),
        "score_breakdown": g("score_breakdown", []),
        "recommendation_reason": g("recommendation_reason"),
        "evidence_snippets": g("evidence_snippets", []),
        "missing_evidence_flags": g("missing_evidence_flags", []),
        "suspicious_evidence_flags": g("suspicious_evidence_flags", []),
        "source_url_classification": g("source_url_classification"),
        "facility_related_urls": g("facility_related_urls", []),
        "care_need_evidence_urls": g("care_need_evidence_urls", []),
        "unrelated_source_urls": g("unrelated_source_urls", []),
        "official_website": g("official_website"),
        "official_phone": g("official_phone"),
    }


def op_search(payload: dict) -> dict:
    care_need = (payload.get("care_need") or "").strip()
    care_type = (payload.get("care_type") or "specialist").strip()
    user_lat = payload.get("user_lat")
    user_lon = payload.get("user_lon")
    if not care_need or user_lat is None or user_lon is None:
        return {"ok": False, "kind": "missing_params",
                "error": "care_need, user_lat and user_lon are required."}

    max_distance_km = float(payload.get("max_distance_km") or _DEFAULT_MAX_DISTANCE_KM)
    top_n = int(payload.get("top_n") or _DEFAULT_TOP_N)
    ranking_priority = (payload.get("ranking_priority") or _DEFAULT_RANKING).strip()
    use_feedback = bool(payload.get("use_feedback_reranking", True))

    fp = _load_pipeline()
    P = _load_persistence()
    clean = _load_clean_df()

    ranked = fp.recommend_facilities(
        clean,
        user_lat=float(user_lat),
        user_lon=float(user_lon),
        condition=care_need,
        care_type=care_type,
        top_n=top_n,
        max_distance_km=max_distance_km,
        ranking_priority=ranking_priority,
    )

    sid = _scenario_id(P, care_need, care_type, float(user_lat), float(user_lon), max_distance_km)

    # Persist the scenario itself for the history sidebar (best-effort).
    save_scenario = getattr(P, "save_scenario", None)
    if callable(save_scenario):
        try:
            save_scenario(
                scenario_id=sid,
                user_location=(payload.get("location_text") or ""),
                user_lat=float(user_lat),
                user_lon=float(user_lon),
                care_need=care_need,
                care_type=care_type,
                ranking_priority=ranking_priority,
                max_distance_km=max_distance_km,
            )
        except Exception:
            pass

    # Optional feedback re-rank. apply_feedback_reranking takes a workspace
    # feedback dict (not a scenario_id) — pull it from persistence first.
    feedback_applied = False
    if use_feedback:
        apply = getattr(fp, "apply_feedback_reranking", None)
        get_feedback = getattr(P, "get_feedback_for_scenario", None)
        has_fb = getattr(P, "has_feedback_for_scenario", None)
        scenario_has_feedback = bool(has_fb(sid)) if callable(has_fb) else True
        if callable(apply) and callable(get_feedback) and scenario_has_feedback:
            try:
                workspace_feedback = get_feedback(sid)
                ranked = apply(ranked, workspace_feedback)
                feedback_applied = True
            except Exception as exc:
                sys.stderr.write(f"[referral_cli] apply_feedback_reranking failed: {exc}\n")
                feedback_applied = False

    candidates = [_row_to_candidate(row, rank=i + 1) for i, (_, row) in enumerate(ranked.iterrows())]
    return {
        "ok": True,
        "scenario_id": sid,
        "feedback_applied": feedback_applied,
        "candidates": candidates,
    }


# persistence.set_review_decision uses "reviewed" for the "accepted" state;
# the UI uses the friendlier word, so we translate at the boundary.
_REVIEW_STATUS_MAP = {
    "accepted": "reviewed",
    "reviewed": "reviewed",
    "needs_verification": "needs_verification",
    "rejected": "rejected",
    "pending": "pending",
}


def op_shortlist(payload: dict) -> dict:
    P = _load_persistence()
    sid = payload["scenario_id"]
    cand = payload.get("candidate") or {}
    P.save_to_shortlist(
        scenario_id=sid,
        facility_id=str(cand.get("facility_id", "")),
        facility_name=str(cand.get("facility_name", "")),
        final_recommendation_score=float(cand.get("final_recommendation_score") or 0.0),
        uncertainty_level=str(cand.get("uncertainty_level") or "unknown"),
    )
    return {"ok": True}


def op_note(payload: dict) -> dict:
    P = _load_persistence()
    P.add_note(
        scenario_id=payload["scenario_id"],
        facility_id=payload["facility_id"],
        note_text=payload["note"],
    )
    return {"ok": True}


def op_review(payload: dict) -> dict:
    P = _load_persistence()
    raw_status = str(payload.get("status", "")).lower()
    mapped = _REVIEW_STATUS_MAP.get(raw_status)
    if not mapped:
        return {
            "ok": False,
            "kind": "bad_request",
            "error": f"unsupported review status: {raw_status!r}",
        }
    P.set_review_decision(
        scenario_id=payload["scenario_id"],
        facility_id=payload["facility_id"],
        status=mapped,
        reviewer_note=payload.get("reviewer_note") or payload.get("reviewer"),
    )
    return {"ok": True}


def op_override(payload: dict) -> dict:
    P = _load_persistence()
    P.set_manual_override(
        scenario_id=payload["scenario_id"],
        facility_id=payload["facility_id"],
        original_score=float(payload["original_score"]),
        override_score=float(payload["override_score"]),
        override_reason=str(payload.get("reason") or payload.get("override_reason") or ""),
    )
    return {"ok": True}


def op_workspace(payload: dict) -> dict:
    P = _load_persistence()
    sid = payload["scenario_id"]
    out: dict[str, Any] = {"ok": True, "scenario_id": sid}
    get_workspace = getattr(P, "get_workspace", None)
    if callable(get_workspace):
        ws = get_workspace(sid)
        out.update(
            {
                "shortlist": _safe_value(ws.get("shortlist", [])),
                "notes": _safe_value(ws.get("notes", [])),
                "decisions": _safe_value(ws.get("review_decisions", ws.get("decisions", []))),
                "overrides": _safe_value(ws.get("overrides", [])),
            }
        )
        return out
    # Fallback: assemble from per-table list helpers.
    out["shortlist"] = _safe_value(P.list_shortlist(sid))
    out["notes"] = _safe_value(P.list_notes(sid))
    out["decisions"] = _safe_value(P.list_review_decisions(sid))
    out["overrides"] = _safe_value(P.list_overrides(sid))
    return out


def op_warmup(_payload: dict) -> dict:
    df = _load_clean_df()
    return {"ok": True, "rows": int(len(df)), "cols": int(len(df.columns))}


def _default_llm_model() -> str:
    return os.environ.get("CAREPILOT_LLM_MODEL", "databricks-llama-4-maverick")


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _candidate_dict_to_series(cand: dict) -> Any:
    """Map the API candidate JSON contract back into a pandas Series for llm_summary."""
    import pandas as pd  # type: ignore[import-untyped]

    snippets = cand.get("evidence_snippets") or []
    normalized: list[dict] = []
    for s in snippets:
        if not isinstance(s, dict):
            continue
        ns = dict(s)
        if ns.get("text") and not ns.get("snippet"):
            ns["snippet"] = ns["text"]
        normalized.append(ns)

    classification = cand.get("source_url_classification")
    if not isinstance(classification, dict):
        classification = {
            "facility_related": list(cand.get("facility_related_urls") or []),
            "care_need_evidence": list(cand.get("care_need_evidence_urls") or []),
            "unrelated": list(cand.get("unrelated_source_urls") or []),
        }

    return pd.Series(
        {
            "facility_id": cand.get("facility_id"),
            "facility_name": cand.get("facility_name"),
            "clean_city": cand.get("clean_city"),
            "clean_state": cand.get("clean_state"),
            "clean_facility_type": cand.get("clean_facility_type"),
            "distance_km": _safe_float(cand.get("distance_km")),
            "raw_recommendation_score": _safe_float(cand.get("raw_recommendation_score")),
            "final_recommendation_score": _safe_float(cand.get("final_recommendation_score")),
            "score_cap_reason": cand.get("score_cap_reason"),
            "baseline_trust_score": _safe_float(cand.get("baseline_trust_score")),
            "evidence_strength_score": _safe_float(cand.get("evidence_strength_score")),
            "disease_match_score": _safe_float(cand.get("disease_match_score")),
            "uncertainty_level": cand.get("uncertainty_level"),
            "recommendation_reason": cand.get("recommendation_reason"),
            "evidence_snippets": normalized,
            "source_url_classification": classification,
            "missing_evidence_flags": list(cand.get("missing_evidence_flags") or []),
            "suspicious_evidence_flags": list(cand.get("suspicious_evidence_flags") or []),
            "source_urls": (
                list(cand.get("facility_related_urls") or [])
                + list(cand.get("care_need_evidence_urls") or [])
                + list(cand.get("unrelated_source_urls") or [])
            ),
        }
    )


def op_summarize(payload: dict) -> dict:
    """Generate (or return cached) Llama card summary for one candidate."""
    import llm_summary as LLM  # type: ignore[import-not-found]

    scenario_id = str(payload.get("scenario_id") or "")
    cand = payload.get("candidate")
    care_need = str(payload.get("care_need") or "")
    care_type = str(payload.get("care_type") or "specialist")
    model = str(payload.get("model") or _default_llm_model())
    force = bool(payload.get("force_regenerate"))

    if not scenario_id or not isinstance(cand, dict) or not cand.get("facility_id"):
        return {"ok": False, "kind": "missing_params", "error": "scenario_id and candidate are required."}

    P = _load_persistence()
    row = _candidate_dict_to_series(cand)
    fid = str(cand["facility_id"])
    ph = LLM.payload_hash(LLM.build_candidate_payload(row))
    cache_model_key = f"{model}::{LLM.PROMPT_VERSION}"

    if not force:
        cached = P.get_cached_summary(
            scenario_id=scenario_id,
            facility_id=fid,
            model=cache_model_key,
            payload_hash=ph,
        )
        if cached:
            return {
                "ok": True,
                "summary": cached,
                "model": model,
                "prompt_version": LLM.PROMPT_VERSION,
                "payload_hash": ph,
                "cached": True,
            }

    try:
        summary = LLM.summarize_candidate(
            row, care_need=care_need, care_type=care_type, model=model,
        )
    except Exception as exc:
        return {"ok": False, "kind": "llm_error", "error": str(exc)}

    P.save_cached_summary(
        scenario_id=scenario_id,
        facility_id=fid,
        model=cache_model_key,
        payload_hash=ph,
        summary=summary,
    )
    return {
        "ok": True,
        "summary": summary,
        "model": model,
        "prompt_version": LLM.PROMPT_VERSION,
        "payload_hash": ph,
        "cached": False,
    }


def op_summarize_search(payload: dict) -> dict:
    """Llama-generated assistant message after a referral search."""
    import llm_summary as LLM  # type: ignore[import-not-found]

    care_need = str(payload.get("care_need") or "")
    care_type = str(payload.get("care_type") or "specialist")
    location_text = payload.get("location_text")
    candidates = payload.get("candidates")
    feedback_applied = bool(payload.get("feedback_applied"))
    model = str(payload.get("model") or _default_llm_model())

    if not care_need or not isinstance(candidates, list) or len(candidates) == 0:
        return {
            "ok": False,
            "kind": "missing_params",
            "error": "care_need and a non-empty candidates list are required.",
        }

    try:
        summary = LLM.summarize_search_results(
            care_need=care_need,
            care_type=care_type,
            location_text=str(location_text) if location_text else None,
            candidates=candidates,
            feedback_applied=feedback_applied,
            model=model,
        )
    except Exception as exc:
        return {"ok": False, "kind": "llm_error", "error": str(exc)}

    return {
        "ok": True,
        "summary": summary,
        "model": model,
        "prompt_version": LLM.PROMPT_VERSION,
    }


def op_chat(payload: dict) -> dict:
    """Llama follow-up reply about the current ranked search results."""
    import llm_summary as LLM  # type: ignore[import-not-found]

    question = str(payload.get("message") or "").strip()
    care_need = str(payload.get("care_need") or "")
    care_type = str(payload.get("care_type") or "specialist")
    location_text = payload.get("location_text")
    candidates = payload.get("candidates")
    feedback_applied = bool(payload.get("feedback_applied"))
    model = str(payload.get("model") or _default_llm_model())

    if not question:
        return {"ok": False, "kind": "empty_message", "error": "message is required."}
    if not care_need or not isinstance(candidates, list) or len(candidates) == 0:
        return {
            "ok": False,
            "kind": "missing_params",
            "error": "care_need and a non-empty candidates list are required.",
        }

    try:
        reply = LLM.answer_followup(
            question=question,
            care_need=care_need,
            care_type=care_type,
            location_text=str(location_text) if location_text else None,
            candidates=candidates,
            feedback_applied=feedback_applied,
            model=model,
        )
    except Exception as exc:
        return {"ok": False, "kind": "llm_error", "error": str(exc)}

    return {
        "ok": True,
        "reply": reply,
        "model": model,
        "prompt_version": LLM.PROMPT_VERSION,
    }


def op_classify_intent(payload: dict) -> dict:
    """Llama decides new_search vs follow_up for the current planner message."""
    import llm_summary as LLM  # type: ignore[import-not-found]

    message = str(payload.get("message") or "").strip()
    care_need = str(payload.get("care_need") or "")
    care_type = str(payload.get("care_type") or "specialist")
    location_text = payload.get("location_text")
    candidate_count = int(payload.get("candidate_count") or 0)
    top_facility_name = payload.get("top_facility_name")
    model = str(payload.get("model") or _default_llm_model())

    if not message:
        return {"ok": False, "kind": "empty_message", "error": "message is required."}
    if not care_need or candidate_count <= 0:
        return {"ok": True, "intent": "new_search", "confidence": 1.0, "model": model}

    try:
        result = LLM.classify_message_intent(
            message=message,
            care_need=care_need,
            care_type=care_type,
            location_text=str(location_text) if location_text else None,
            candidate_count=candidate_count,
            top_facility_name=str(top_facility_name) if top_facility_name else None,
            model=model,
        )
    except Exception as exc:
        return {"ok": False, "kind": "llm_error", "error": str(exc)}

    return {
        "ok": True,
        "intent": result["intent"],
        "confidence": result["confidence"],
        "model": model,
        "prompt_version": LLM.PROMPT_VERSION,
    }


OPS = {
    "parse":     op_parse,
    "search":    op_search,
    "shortlist": op_shortlist,
    "note":      op_note,
    "review":    op_review,
    "override":  op_override,
    "workspace": op_workspace,
    "warmup":    op_warmup,
    "summarize": op_summarize,
    "summarize_search": op_summarize_search,
    "chat":      op_chat,
    "classify_intent": op_classify_intent,
}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="CarePilot referral CLI bridge")
    parser.add_argument("--op", required=True, choices=sorted(OPS.keys()))
    parser.add_argument("--input", default=None,
                        help="Path to request JSON. Defaults to stdin.")
    args = parser.parse_args(argv[1:])

    try:
        if args.input:
            with open(args.input, "r", encoding="utf-8") as fh:
                payload = json.load(fh)
        else:
            raw = sys.stdin.read().strip()
            payload = json.loads(raw) if raw else {}
    except Exception as exc:
        json.dump(
            {"ok": False, "kind": "bad_request", "error": f"invalid JSON: {exc}"},
            sys.stdout,
        )
        return 2

    op = OPS[args.op]
    # The Python pipeline emits human-readable progress via print() to stdout.
    # Capture that into stderr so the only thing on stdout is the response JSON
    # — that is the contract the Node bridge relies on.
    real_stdout = sys.stdout
    captured = io.StringIO()
    try:
        with contextlib.redirect_stdout(captured):
            result = op(payload)
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        result = {
            "ok": False,
            "kind": "exception",
            "error": str(exc),
            "type": type(exc).__name__,
        }
    finally:
        captured_text = captured.getvalue()
        if captured_text:
            sys.stderr.write(captured_text)
            sys.stderr.flush()

    json.dump(result, real_stdout)
    real_stdout.write("\n")
    real_stdout.flush()
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
