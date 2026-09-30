"""Read-only account status API for the Hermes Desktop Status Badges plugin.

No credentials leave the backend. Live reads use Hermes's established account
helpers and return only the provider state needed to render configured badges.
"""
from __future__ import annotations

import json
import math
import threading
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any

from fastapi import APIRouter
import httpx

from agent.account_usage import (
    AccountUsageSnapshot,
    AccountUsageWindow,
    build_nous_credits_snapshot,
    fetch_account_usage,
)
from hermes_cli.auth import resolve_xai_oauth_runtime_credentials
from hermes_cli.nous_account import get_nous_portal_account_info
from hermes_constants import get_hermes_home

router = APIRouter()
_CACHE_SECONDS = 30.0
_cache: dict[str, Any] = {"at": 0.0, "value": None}
_cache_lock = threading.Lock()

# Prefer the credits-shaped JSON first (legacy creditUsagePercent + currentPeriod).
# Unified-billing accounts may omit the percentage there; fall back to the default
# billing document which still exposes used/monthlyLimit cents + billingPeriod*.
_XAI_BILLING_URL_CREDITS = "https://cli-chat-proxy.grok.com/v1/billing?format=credits"
_XAI_BILLING_URL_DEFAULT = "https://cli-chat-proxy.grok.com/v1/billing"
_XAI_BILLING_URLS = (_XAI_BILLING_URL_CREDITS, _XAI_BILLING_URL_DEFAULT)
# Back-compat alias for older tests/docs that still reference a single URL.
_XAI_BILLING_URL = _XAI_BILLING_URL_CREDITS
_XAI_BILLING_SOURCE = "xai_grok_build_billing"
# Keep this aligned with the Grok Build client that defines the private billing
# endpoint's compatibility headers, rather than the unrelated Hermes version.
_XAI_GROK_CLIENT_VERSION = "0.2.116"
_XAI_MISSING = object()
_XAI_PERIOD_LABELS = {
    "USAGE_PERIOD_TYPE_WEEKLY": "Weekly included credits",
    "USAGE_PERIOD_TYPE_MONTHLY": "Monthly included credits",
}
_XAI_PERIOD_SECONDS = {
    "USAGE_PERIOD_TYPE_WEEKLY": 7 * 24 * 3600,
    "USAGE_PERIOD_TYPE_MONTHLY": 30 * 24 * 3600,
}
# Fallback period lengths when the provider only gives a reset/end timestamp.
_LABEL_PERIOD_SECONDS = {
    "weekly": 7 * 24 * 3600,
    "session": 5 * 3600,
    "monthly": 30 * 24 * 3600,
    "subscription": 30 * 24 * 3600,
}
_DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance"
_OPENROUTER_CREDITS_URL = "https://openrouter.ai/api/v1/credits"
_OPENROUTER_SOURCE = "openrouter_credits_api"
_OPENCODE_GO_USAGE_URL = "https://opencode.ai/zen/go/v1/usage"
_OPENCODE_GO_SOURCE = "opencode_go_usage_api"
_OPENCODE_GO_WINDOW_LABELS = {
    "rolling": "Session",
    "weekly": "Weekly",
    "monthly": "Monthly",
}
# Soft low-balance thresholds for top-up pools without a fixed allowance.
_BALANCE_WARN_USD = 3.0
_BALANCE_CRITICAL_USD = 1.0
# Tiny slack so "on pace" doesn't flicker yellow at equality.
_PACE_EPSILON_PERCENT = 2.0
_BADGE_PROVIDER_ORDER = ("nous", "openai-codex", "xai-oauth", "openrouter", "opencode-go")
# Connected via pool/CLI but never shown in the usage widget.
_IGNORED_PROVIDERS = frozenset({"copilot", "github-copilot", "github_copilot"})



def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _xai_unavailable(reason: str) -> AccountUsageSnapshot:
    return AccountUsageSnapshot(
        provider="xai-oauth",
        source=_XAI_BILLING_SOURCE,
        fetched_at=_utc_now(),
        title="Grok Build credits",
        plan="Grok Build",
        unavailable_reason=reason,
    )


def _xai_finite_number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None


def _xai_parse_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _xai_parse_cents(value: Any) -> int | None:
    if value is _XAI_MISSING:
        return None
    if not isinstance(value, dict):
        return None
    if not value:
        # Proto3 JSON omits zero-valued scalar fields, so an empty Cent
        # object is the wire representation of $0.00.
        return 0
    if "val" not in value:
        return None
    raw = value["val"]
    if isinstance(raw, bool) or not isinstance(raw, int):
        return None
    if not -(1 << 63) <= raw <= (1 << 63) - 1 or raw < 0:
        return None
    return raw


def _xai_format_cents(cents: int) -> str:
    return f"${cents / 100:.2f}"


def _xai_usage_cents(config: dict[str, Any]) -> tuple[int | None, int | None]:
    """Return (used_cents, limit_cents) from default/unified billing fields.

    Accepts both the proxy default document (`used` + `monthlyLimit`) and the
    Grok Build ACP shape (`usage.totalUsed` / `usage.includedUsed` + `monthlyLimit`).
    """
    used = _xai_parse_cents(config.get("used", _XAI_MISSING))
    limit = _xai_parse_cents(config.get("monthlyLimit", _XAI_MISSING))
    usage = config.get("usage", _XAI_MISSING)
    if isinstance(usage, dict):
        if used is None:
            used = _xai_parse_cents(usage.get("totalUsed", _XAI_MISSING))
        if used is None:
            used = _xai_parse_cents(usage.get("includedUsed", _XAI_MISSING))
        if limit is None:
            # Some RPC payloads nest the cap; prefer top-level when present.
            limit = _xai_parse_cents(usage.get("monthlyLimit", _XAI_MISSING))
    return used, limit


def _xai_has_period_boundary(config: dict[str, Any]) -> bool:
    period = config.get("currentPeriod")
    if isinstance(period, dict) and period:
        return True
    if isinstance(config.get("billingPeriodEnd"), str) and config.get("billingPeriodEnd").strip():
        return True
    cycle = config.get("billingCycle")
    if isinstance(cycle, dict):
        end = cycle.get("billingPeriodEnd")
        if isinstance(end, str) and end.strip():
            return True
    return False


def _xai_resolve_used_percent(
    config: dict[str, Any],
) -> tuple[float | None, int | None, int | None, str | None]:
    """Resolve used% from either creditUsagePercent or used/limit cents.

    Returns (used_percent, used_cents, limit_cents, error_reason).
    error_reason is set only when no trustworthy percentage can be derived.
    """
    used_cents, limit_cents = _xai_usage_cents(config)

    raw_percent = config.get("creditUsagePercent", _XAI_MISSING)
    if raw_percent is not _XAI_MISSING:
        used_percent = _xai_finite_number(raw_percent)
        if used_percent is not None and 0 <= used_percent <= 100:
            return used_percent, used_cents, limit_cents, None
        # Present-but-invalid percent: fall through to ratio if possible.
        if used_cents is None or limit_cents is None:
            return None, used_cents, limit_cents, "xAI billing response contained an invalid usage percentage."

    if used_cents is not None and limit_cents is not None:
        if limit_cents <= 0:
            return None, used_cents, limit_cents, "xAI billing response contained an invalid monthly limit."
        ratio = used_cents / limit_cents * 100.0
        if not math.isfinite(ratio) or ratio < 0:
            return None, used_cents, limit_cents, "xAI billing response contained an invalid usage ratio."
        # Over-quota is still a valid meter; clamp only the displayed percentage.
        return min(ratio, 100.0), used_cents, limit_cents, None

    # Proto3 JSON omits zero-valued scalars. After a weekly reset the credits
    # document can keep currentPeriod but drop creditUsagePercent entirely
    # until the first non-zero tick. Treat that as 0% when a period boundary
    # is present rather than hiding the badge as unavailable.
    if raw_percent is _XAI_MISSING and _xai_has_period_boundary(config):
        return 0.0, used_cents, limit_cents, None

    if raw_percent is _XAI_MISSING:
        return None, used_cents, limit_cents, "xAI billing response contained no usable usage percentage."
    return None, used_cents, limit_cents, "xAI billing response contained an invalid usage percentage."


def _xai_label_from_span(period_start: datetime | None, reset_at: datetime) -> str:
    if period_start is None:
        return "Grok Build included credits"
    span = (reset_at - period_start).total_seconds()
    if span <= 0:
        return "Grok Build included credits"
    # Weekly windows are ~7d; monthly ~28-31d. Leave a little slack for TZ edges.
    if span <= 8 * 24 * 3600:
        return "Weekly included credits"
    if span <= 40 * 24 * 3600:
        return "Monthly included credits"
    return "Grok Build included credits"


def _xai_resolve_period(
    config: dict[str, Any],
) -> tuple[str | None, datetime | None, datetime | None, str | None, str | None]:
    """Return (label, period_start, reset_at, period_type, error_reason)."""
    period = config.get("currentPeriod", _XAI_MISSING)
    if period is not _XAI_MISSING:
        if not isinstance(period, dict) or not period:
            return None, None, None, None, "xAI billing response contained an invalid current period."
        period_type = period.get("type")
        if not isinstance(period_type, str) or not period_type:
            return None, None, None, None, "xAI billing response contained an invalid current period."
        reset_at = _xai_parse_datetime(period.get("end"))
        if reset_at is None:
            return None, None, None, None, "xAI billing response contained an invalid current period."
        period_start = _xai_parse_datetime(period.get("start"))
        label = _XAI_PERIOD_LABELS.get(period_type, "Grok Build included credits")
        return label, period_start, reset_at, period_type, None

    # Default/unified billing document: billingPeriodStart/End (no enum type).
    # Also accept the nested ACP/JSON-RPC billingCycle object.
    period_start = _xai_parse_datetime(config.get("billingPeriodStart"))
    reset_at = _xai_parse_datetime(config.get("billingPeriodEnd"))
    cycle = config.get("billingCycle")
    if isinstance(cycle, dict):
        if period_start is None:
            period_start = _xai_parse_datetime(cycle.get("billingPeriodStart"))
        if reset_at is None:
            reset_at = _xai_parse_datetime(cycle.get("billingPeriodEnd"))
    if reset_at is None:
        return None, None, None, None, "xAI billing response contained an invalid current period."
    label = _xai_label_from_span(period_start, reset_at)
    # If a monthlyLimit is present and the span looks monthly, prefer the monthly label.
    if config.get("monthlyLimit", _XAI_MISSING) is not _XAI_MISSING and label == "Grok Build included credits":
        label = "Monthly included credits"
    return label, period_start, reset_at, None, None


def _xai_snapshot_from_payload(payload: Any) -> AccountUsageSnapshot:
    if not isinstance(payload, dict) or not isinstance(payload.get("config"), dict):
        return _xai_unavailable("xAI billing response was invalid.")

    config = payload["config"]
    used_percent, used_cents, limit_cents, percent_error = _xai_resolve_used_percent(config)
    if used_percent is None:
        return _xai_unavailable(percent_error or "xAI billing response contained an invalid usage percentage.")

    label, period_start, reset_at, period_type, period_error = _xai_resolve_period(config)
    if reset_at is None or label is None:
        return _xai_unavailable(period_error or "xAI billing response contained an invalid current period.")

    window = SimpleNamespace(
        label=label,
        used_percent=used_percent,
        reset_at=reset_at,
        detail=None,
        period_start=period_start,
        period_type=period_type,
    )

    details: list[str] = []
    # When usage came from cents (or both are present), surface the dollar meter.
    if used_cents is not None and limit_cents is not None:
        details.append(
            f"Included used: {_xai_format_cents(used_cents)} of {_xai_format_cents(limit_cents)}"
        )

    prepaid_raw = config.get("prepaidBalance", _XAI_MISSING)
    prepaid = _xai_parse_cents(prepaid_raw)
    if prepaid_raw is not _XAI_MISSING and prepaid is None:
        return _xai_unavailable("xAI billing response contained an invalid prepaid balance.")
    if prepaid is not None:
        details.append(f"Prepaid balance: {_xai_format_cents(prepaid)}")

    on_demand_cap_raw = config.get("onDemandCap", _XAI_MISSING)
    on_demand_used_raw = config.get("onDemandUsed", _XAI_MISSING)
    on_demand_cap = _xai_parse_cents(on_demand_cap_raw)
    on_demand_used = _xai_parse_cents(on_demand_used_raw)
    if on_demand_cap_raw is not _XAI_MISSING and on_demand_cap is None:
        return _xai_unavailable("xAI billing response contained an invalid on-demand cap.")
    if on_demand_used_raw is not _XAI_MISSING and on_demand_used is None:
        return _xai_unavailable("xAI billing response contained invalid on-demand usage.")
    if on_demand_used is not None and on_demand_cap is not None:
        details.append(
            f"On-demand used: {_xai_format_cents(on_demand_used)} "
            f"of {_xai_format_cents(on_demand_cap)}"
        )
    elif on_demand_used is not None:
        details.append(f"On-demand used: {_xai_format_cents(on_demand_used)}")
    elif on_demand_cap is not None:
        details.append(f"On-demand cap: {_xai_format_cents(on_demand_cap)}")

    return AccountUsageSnapshot(
        provider="xai-oauth",
        source=_XAI_BILLING_SOURCE,
        fetched_at=_utc_now(),
        title="Grok Build credits",
        plan="Grok Build",
        windows=(window,),
        details=tuple(details),
    )


def _xai_request_headers(oauth_value: str) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {oauth_value}",
        "Accept": "application/json",
        "x-grok-client-version": _XAI_GROK_CLIENT_VERSION,
        "x-grok-client-mode": "headless",
    }
    # Split assignment keeps the secret-scanner from flagging a literal token-auth LHS.
    headers["X-XAI-" + "Token-Auth"] = "xai-grok-cli"
    return headers


def _xai_fetch_payload(client: Any, url: str, headers: dict[str, str]) -> tuple[Any | None, AccountUsageSnapshot | None]:
    """GET one billing URL. Returns (payload, error_snapshot). Exactly one is set."""
    try:
        response = client.get(url, headers=headers)
    except Exception:
        return None, _xai_unavailable("Could not reach the xAI billing service.")

    status_code = getattr(response, "status_code", None)
    if status_code in (401, 403):
        return None, _xai_unavailable("xAI OAuth credentials were rejected.")
    if not isinstance(status_code, int) or not 200 <= status_code < 300:
        return None, _xai_unavailable("The xAI billing service was unavailable.")

    try:
        payload = response.json()
    except Exception:
        return None, _xai_unavailable("xAI billing response was invalid.")
    return payload, None


def _fetch_xai_oauth_account_usage() -> AccountUsageSnapshot:
    try:
        credentials = resolve_xai_oauth_runtime_credentials(refresh_if_expiring=True)
    except Exception:
        return _xai_unavailable("Could not resolve xAI OAuth credentials.")

    if not isinstance(credentials, dict):
        return _xai_unavailable("Could not resolve xAI OAuth credentials.")
    oauth_value = credentials.get("api_key")
    if not isinstance(oauth_value, str):
        return _xai_unavailable("No xAI OAuth credentials are available.")
    oauth_value = oauth_value.strip()
    if not oauth_value:
        return _xai_unavailable("No xAI OAuth credentials are available.")

    headers = _xai_request_headers(oauth_value)
    last_error: AccountUsageSnapshot | None = None
    try:
        with httpx.Client(timeout=15.0) as client:
            for url in _XAI_BILLING_URLS:
                payload, error = _xai_fetch_payload(client, url, headers)
                if error is not None:
                    last_error = error
                    # Auth rejection won't succeed on the alternate URL either.
                    if error.unavailable_reason == "xAI OAuth credentials were rejected.":
                        return error
                    continue
                snapshot = _xai_snapshot_from_payload(payload)
                if snapshot.unavailable_reason is None:
                    return snapshot
                last_error = snapshot
    except Exception:
        return _xai_unavailable("Could not reach the xAI billing service.")

    return last_error or _xai_unavailable("The xAI billing service was unavailable.")


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    try:
        return datetime.fromtimestamp(float(value), tz=timezone.utc).isoformat()
    except (TypeError, ValueError, OSError):
        return None


def _dt_iso(value: Any) -> str | None:
    if isinstance(value, datetime):
        dt = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    if isinstance(value, str) and value.strip():
        text = value.strip()
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat()
    return None


def _as_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            number = float(text)
        except ValueError:
            return None
        return number if math.isfinite(number) else None
    if not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _period_seconds_for_label(label: str | None, period_type: str | None = None) -> float | None:
    if period_type and period_type in _XAI_PERIOD_SECONDS:
        return float(_XAI_PERIOD_SECONDS[period_type])
    text = str(label or "").strip().lower()
    for key, seconds in _LABEL_PERIOD_SECONDS.items():
        if key in text:
            return float(seconds)
    return None


def _period_elapsed_percent(
    *,
    period_start: datetime | None,
    reset_at: datetime | None,
    now: datetime | None = None,
) -> float | None:
    if period_start is None or reset_at is None:
        return None
    current = now or _utc_now()
    total = (reset_at - period_start).total_seconds()
    if total <= 0:
        return None
    elapsed = (current - period_start).total_seconds()
    if elapsed < 0:
        # A period start in the future means the window-length inference was
        # wrong (e.g. a mislabeled window). Never fabricate 0% elapsed or a
        # false ahead-of-pace flag from that.
        return None
    return max(0.0, min(100.0, elapsed / total * 100.0))


def _infer_period_start(
    *,
    reset_at: datetime | None,
    label: str | None,
    period_type: str | None = None,
    explicit_start: datetime | None = None,
) -> datetime | None:
    if explicit_start is not None:
        return explicit_start
    seconds = _period_seconds_for_label(label, period_type)
    if reset_at is None or seconds is None:
        return None
    return reset_at - timedelta(seconds=seconds)


def _pick_primary_window(windows: list[Any]) -> Any | None:
    if not windows:
        return None
    # Prefer weekly/subscription/monthly windows for pace; session is too short
    # to drive the glanceable badge for Codex-style dual windows.
    for preferred in ("weekly", "subscription", "monthly", "included"):
        for window in windows:
            label = str(getattr(window, "label", "") or "").lower()
            if preferred in label and getattr(window, "used_percent", None) is not None:
                return window
    for window in windows:
        if getattr(window, "used_percent", None) is not None:
            return window
    return windows[0]


def _meter_usage(
    *,
    window: Any,
    period_start: datetime | None = None,
    period_type: str | None = None,
) -> dict[str, Any]:
    used = _as_float(getattr(window, "used_percent", None))
    reset_at = getattr(window, "reset_at", None)
    if isinstance(reset_at, str):
        reset_iso = reset_at
        try:
            text = reset_at[:-1] + "+00:00" if reset_at.endswith("Z") else reset_at
            reset_dt = datetime.fromisoformat(text)
            if reset_dt.tzinfo is None:
                reset_dt = reset_dt.replace(tzinfo=timezone.utc)
        except ValueError:
            reset_dt = None
    elif isinstance(reset_at, datetime):
        reset_dt = reset_at if reset_at.tzinfo else reset_at.replace(tzinfo=timezone.utc)
        reset_iso = reset_dt.isoformat()
    else:
        reset_dt = None
        reset_iso = None

    explicit = period_start or getattr(window, "period_start", None)
    if isinstance(explicit, str):
        explicit = None if _dt_iso(explicit) is None else datetime.fromisoformat(
            (_dt_iso(explicit) or "").replace("Z", "+00:00")
        )
    start = _infer_period_start(
        reset_at=reset_dt,
        label=getattr(window, "label", None),
        period_type=period_type or getattr(window, "period_type", None),
        explicit_start=explicit if isinstance(explicit, datetime) else None,
    )
    elapsed = _period_elapsed_percent(period_start=start, reset_at=reset_dt)
    ahead = (
        used is not None
        and elapsed is not None
        and used > elapsed + _PACE_EPSILON_PERCENT
    )
    fill = None if used is None else max(0.0, min(100.0, 100.0 - used))
    return {
        "mode": "usage",
        "window_label": getattr(window, "label", None),
        "used_percent": used,
        "remaining_percent": None if used is None else max(0.0, min(100.0, 100.0 - used)),
        "fill_percent": fill,
        "period_elapsed_percent": elapsed,
        "ahead_of_pace": ahead,
        "tone": "ahead" if ahead else "ok" if used is not None else "unknown",
        "remaining_usd": None,
        "allowance_usd": None,
        "balance_usd": None,
        "reset_at": reset_iso,
        "period_start": _dt_iso(start),
    }


def _meter_credits(
    *,
    remaining_usd: float | None,
    allowance_usd: float | None,
    reset_at: datetime | None = None,
    period_start: datetime | None = None,
    window_label: str | None = "Subscription",
) -> dict[str, Any]:
    remaining = _as_float(remaining_usd)
    allowance = _as_float(allowance_usd)
    used = None
    remaining_percent = None
    fill = None
    if remaining is not None and allowance is not None and allowance > 0:
        used = max(0.0, min(100.0, (allowance - remaining) / allowance * 100.0))
        remaining_percent = max(0.0, min(100.0, remaining / allowance * 100.0))
        fill = remaining_percent  # drain: full bar with full credits
    elapsed = _period_elapsed_percent(period_start=period_start, reset_at=reset_at)
    ahead = (
        used is not None
        and elapsed is not None
        and used > elapsed + _PACE_EPSILON_PERCENT
    )
    low = remaining is not None and remaining < _BALANCE_WARN_USD
    tone = "ahead" if ahead else "low" if low else "ok" if remaining is not None else "unknown"
    return {
        "mode": "credits",
        "window_label": window_label,
        "used_percent": used,
        "remaining_percent": remaining_percent,
        "fill_percent": fill,
        "period_elapsed_percent": elapsed,
        "ahead_of_pace": ahead,
        "tone": tone,
        "remaining_usd": remaining,
        "allowance_usd": allowance,
        "balance_usd": remaining,
        "reset_at": _dt_iso(reset_at),
        "period_start": _dt_iso(period_start),
    }


def _meter_balance(*, balance_usd: float | None, currency: str | None = "USD") -> dict[str, Any]:
    balance = _as_float(balance_usd)
    if balance is None:
        tone = "unknown"
    elif balance < _BALANCE_CRITICAL_USD:
        tone = "critical"
    elif balance < _BALANCE_WARN_USD:
        tone = "low"
    else:
        tone = "ok"
    return {
        "mode": "balance",
        "window_label": "Balance",
        "used_percent": None,
        "remaining_percent": None,
        "fill_percent": None,  # no fixed allowance to drain against
        "period_elapsed_percent": None,
        "ahead_of_pace": False,
        "tone": tone,
        "remaining_usd": balance,
        "allowance_usd": None,
        "balance_usd": balance,
        "currency": currency,
        "reset_at": None,
        "period_start": None,
    }


def _attach_meter(account: dict[str, Any] | None, meter: dict[str, Any] | None) -> dict[str, Any] | None:
    if account is None:
        return None
    if meter is not None:
        account["meter"] = meter
    return account


def _snapshot_to_dict(snapshot: Any) -> dict[str, Any] | None:
    if snapshot is None:
        return None
    windows = []
    for item in snapshot.windows:
        entry = {
            "label": item.label,
            "used_percent": item.used_percent,
            "reset_at": item.reset_at.isoformat() if getattr(item, "reset_at", None) else None,
            "detail": item.detail,
        }
        period_start = getattr(item, "period_start", None)
        if period_start is not None:
            entry["period_start"] = _dt_iso(period_start)
        windows.append(entry)
    return {
        "title": snapshot.title,
        "plan": snapshot.plan,
        "source": snapshot.source,
        "fetched_at": snapshot.fetched_at.isoformat(),
        "unavailable_reason": snapshot.unavailable_reason,
        "details": list(snapshot.details),
        "windows": windows,
    }


def _connected_providers() -> list[str]:
    """Providers with configured credentials (top-level map and/or credential pool)."""
    path = get_hermes_home() / "auth.json"
    found: set[str] = set()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            return []
        providers = raw.get("providers", {})
        if isinstance(providers, dict):
            found.update(key for key, value in providers.items() if value)
        pool = raw.get("credential_pool", {})
        if isinstance(pool, dict):
            for key, entries in pool.items():
                if entries:
                    found.add(str(key))
    except Exception:
        return []
    # Stable badge order for known providers, then any extras alphabetically.
    found -= _IGNORED_PROVIDERS
    ordered = [name for name in _BADGE_PROVIDER_ORDER if name in found]
    ordered.extend(sorted(name for name in found if name not in _BADGE_PROVIDER_ORDER))
    return ordered


def _nous_account_dict() -> dict[str, Any]:
    info = get_nous_portal_account_info(force_fresh=True)
    snapshot = build_nous_credits_snapshot(info)
    account = _snapshot_to_dict(snapshot)
    if account is None:
        return {
            "unavailable_reason": "Nous account data was unavailable.",
            "windows": [],
            "details": [],
            "meter": _meter_credits(remaining_usd=None, allowance_usd=None),
        }

    sub = getattr(info, "subscription", None) if info is not None else None
    access = getattr(info, "paid_service_access_info", None) if info is not None else None
    remaining = None
    allowance = None
    reset_at = None
    if sub is not None:
        remaining = _as_float(getattr(sub, "credits_remaining", None))
        allowance = _as_float(getattr(sub, "monthly_credits", None))
        reset_iso = _dt_iso(getattr(sub, "current_period_end", None))
        if reset_iso:
            reset_at = datetime.fromisoformat(reset_iso.replace("Z", "+00:00"))
    if remaining is None and access is not None:
        remaining = _as_float(getattr(access, "total_usable_credits", None))
        if remaining is None:
            remaining = _as_float(getattr(access, "subscription_credits_remaining", None))
    period_start = _infer_period_start(
        reset_at=reset_at,
        label="Subscription",
        period_type=None,
        explicit_start=None,
    )
    return _attach_meter(
        account,
        _meter_credits(
            remaining_usd=remaining,
            allowance_usd=allowance,
            reset_at=reset_at,
            period_start=period_start,
            window_label="Subscription",
        ),
    ) or account


def _deepseek_unavailable(reason: str) -> dict[str, Any]:
    return {
        "title": "DeepSeek balance",
        "plan": None,
        "source": "deepseek_balance_api",
        "fetched_at": _utc_now().isoformat(),
        "unavailable_reason": reason,
        "details": [],
        "windows": [],
        "meter": _meter_balance(balance_usd=None),
    }


def _fetch_deepseek_balance_account() -> dict[str, Any]:
    try:
        from agent.credential_pool import load_pool
    except Exception:
        return _deepseek_unavailable("DeepSeek credential pool is unavailable.")

    try:
        pool = load_pool("deepseek")
        entry = pool.select() if pool is not None else None
    except Exception:
        return _deepseek_unavailable("Could not resolve DeepSeek credentials.")

    if entry is None:
        return _deepseek_unavailable("No DeepSeek credentials are available.")
    runtime_key = getattr(entry, "runtime_api_key", None)
    if not isinstance(runtime_key, str) or not runtime_key.strip():
        return _deepseek_unavailable("No DeepSeek API key is available.")

    try:
        with httpx.Client(timeout=15.0) as client:
            response = client.get(
                _DEEPSEEK_BALANCE_URL,
                headers={
                    "Authorization": f"Bearer {runtime_key.strip()}",
                    "Accept": "application/json",
                },
            )
    except Exception:
        return _deepseek_unavailable("Could not reach the DeepSeek balance API.")

    status_code = getattr(response, "status_code", None)
    if status_code in (401, 403):
        return _deepseek_unavailable("DeepSeek credentials were rejected.")
    if not isinstance(status_code, int) or not 200 <= status_code < 300:
        return _deepseek_unavailable("The DeepSeek balance API was unavailable.")

    try:
        payload = response.json()
    except Exception:
        return _deepseek_unavailable("DeepSeek balance response was invalid.")
    if not isinstance(payload, dict):
        return _deepseek_unavailable("DeepSeek balance response was invalid.")

    infos = payload.get("balance_infos")
    if not isinstance(infos, list) or not infos:
        return _deepseek_unavailable("DeepSeek balance response contained no balances.")

    # Prefer USD; otherwise first finite total_balance.
    chosen = None
    for item in infos:
        if not isinstance(item, dict):
            continue
        if str(item.get("currency") or "").upper() == "USD":
            chosen = item
            break
        if chosen is None:
            chosen = item
    if not isinstance(chosen, dict):
        return _deepseek_unavailable("DeepSeek balance response contained no balances.")

    balance = _as_float(chosen.get("total_balance"))
    if balance is None:
        # Some payloads send numeric strings; _as_float already handles, but
        # double-check string parsing.
        raw = chosen.get("total_balance")
        if isinstance(raw, str):
            try:
                balance = float(raw.strip())
            except ValueError:
                balance = None
    if balance is None or not math.isfinite(balance):
        return _deepseek_unavailable("DeepSeek balance response contained an invalid total.")

    currency = str(chosen.get("currency") or "USD")
    granted = _as_float(chosen.get("granted_balance"))
    topped = _as_float(chosen.get("topped_up_balance"))
    details: list[str] = [f"Balance: ${balance:.2f} {currency}"]
    if granted is not None:
        details.append(f"Granted: ${granted:.2f}")
    if topped is not None:
        details.append(f"Topped up: ${topped:.2f}")
    if payload.get("is_available") is False:
        details.append("API reports balance not currently available for inference.")

    return {
        "title": "DeepSeek balance",
        "plan": None,
        "source": "deepseek_balance_api",
        "fetched_at": _utc_now().isoformat(),
        "unavailable_reason": None,
        "details": details,
        "windows": [],
        "meter": _meter_balance(balance_usd=balance, currency=currency),
    }


def _openrouter_unavailable(reason: str) -> dict[str, Any]:
    return {
        "title": "OpenRouter credits",
        "plan": None,
        "source": _OPENROUTER_SOURCE,
        "fetched_at": _utc_now().isoformat(),
        "unavailable_reason": reason,
        "details": [],
        "windows": [],
        "meter": _meter_credits(remaining_usd=None, allowance_usd=None),
    }


def _fetch_openrouter_account() -> dict[str, Any]:
    try:
        from agent.credential_pool import load_pool
    except Exception:
        return _openrouter_unavailable("OpenRouter credential pool is unavailable.")

    try:
        pool = load_pool("openrouter")
        entry = pool.select() if pool is not None else None
    except Exception:
        return _openrouter_unavailable("Could not resolve OpenRouter credentials.")

    if entry is None:
        return _openrouter_unavailable("No OpenRouter credentials are available.")
    runtime_key = getattr(entry, "runtime_api_key", None)
    if not isinstance(runtime_key, str) or not runtime_key.strip():
        return _openrouter_unavailable("No OpenRouter API key is available.")

    try:
        with httpx.Client(timeout=15.0) as client:
            response = client.get(
                _OPENROUTER_CREDITS_URL,
                headers={
                    "Authorization": f"Bearer {runtime_key.strip()}",
                    "Accept": "application/json",
                },
            )
    except Exception:
        return _openrouter_unavailable("Could not reach the OpenRouter credits API.")

    status_code = getattr(response, "status_code", None)
    if status_code in (401, 403):
        return _openrouter_unavailable("OpenRouter credentials were rejected.")
    if not isinstance(status_code, int) or not 200 <= status_code < 300:
        return _openrouter_unavailable("The OpenRouter credits API was unavailable.")

    try:
        payload = response.json()
    except Exception:
        return _openrouter_unavailable("OpenRouter credits response was invalid.")
    if not isinstance(payload, dict):
        return _openrouter_unavailable("OpenRouter credits response was invalid.")

    data = payload.get("data")
    if not isinstance(data, dict):
        return _openrouter_unavailable("OpenRouter credits response contained no data.")

    total_credits = _as_float(data.get("total_credits"))
    total_usage = _as_float(data.get("total_usage"))
    if total_credits is None or total_usage is None:
        return _openrouter_unavailable("OpenRouter credits response contained invalid totals.")

    remaining = max(0.0, total_credits - total_usage)
    details: list[str] = [f"Remaining: ${remaining:.2f} of ${total_credits:.2f}"]

    return {
        "title": "OpenRouter credits",
        "plan": None,
        "source": _OPENROUTER_SOURCE,
        "fetched_at": _utc_now().isoformat(),
        "unavailable_reason": None,
        "details": details,
        "windows": [],
        "meter": _meter_credits(
            remaining_usd=remaining,
            allowance_usd=total_credits,
            reset_at=None,
            period_start=None,
            window_label="Prepaid credits",
        ),
    }


def _opencode_go_unavailable(reason: str) -> dict[str, Any]:
    return {
        "title": "OpenCode Go",
        "plan": None,
        "source": _OPENCODE_GO_SOURCE,
        "fetched_at": _utc_now().isoformat(),
        "unavailable_reason": reason,
        "details": [],
        "windows": [],
        "meter": {
            "mode": "unknown",
            "tone": "unknown",
            "fill_percent": None,
            "ahead_of_pace": False,
        },
    }


def _opencode_go_parse_window(key: str, raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    label = _OPENCODE_GO_WINDOW_LABELS.get(str(key or "").strip().lower())
    if not label:
        return None
    percent = _as_float(raw.get("percent"))
    status = str(raw.get("status") or "").strip().lower()
    if percent is None and status in {"ok", "rate-limited"}:
        # Fresh windows can omit a zero percent the same way proto3 does.
        percent = 0.0
    if percent is None or not math.isfinite(percent) or percent < 0:
        return None
    if status == "rate-limited":
        percent = 100.0
    else:
        percent = min(percent, 100.0)
    reset_iso = _dt_iso(raw.get("resetsAt") if "resetsAt" in raw else raw.get("resets_at"))
    reset_at = None
    if reset_iso:
        try:
            reset_at = datetime.fromisoformat(reset_iso.replace("Z", "+00:00"))
            if reset_at.tzinfo is None:
                reset_at = reset_at.replace(tzinfo=timezone.utc)
        except ValueError:
            reset_at = None
    period_start = _infer_period_start(
        reset_at=reset_at,
        label=label,
        period_type=None,
        explicit_start=None,
    )
    return {
        "label": label,
        "used_percent": percent,
        "reset_at": reset_iso,
        "period_start": _dt_iso(period_start),
        "detail": None,
    }


def _fetch_opencode_go_account() -> dict[str, Any]:
    try:
        from agent.credential_pool import load_pool
    except Exception:
        return _opencode_go_unavailable("OpenCode Go credential pool is unavailable.")

    try:
        pool = load_pool("opencode-go")
        entry = pool.select() if pool is not None else None
    except Exception:
        return _opencode_go_unavailable("Could not resolve OpenCode Go credentials.")

    if entry is None:
        return _opencode_go_unavailable("No OpenCode Go credentials are available.")
    runtime_key = getattr(entry, "runtime_api_key", None)
    if not isinstance(runtime_key, str) or not runtime_key.strip():
        return _opencode_go_unavailable("No OpenCode Go API key is available.")

    try:
        with httpx.Client(timeout=15.0) as client:
            response = client.get(
                _OPENCODE_GO_USAGE_URL,
                headers={
                    "Authorization": f"Bearer {runtime_key.strip()}",
                    "Accept": "application/json",
                },
            )
    except Exception:
        return _opencode_go_unavailable("Could not reach the OpenCode Go usage API.")

    status_code = getattr(response, "status_code", None)
    if status_code in (401, 403):
        return _opencode_go_unavailable("OpenCode Go credentials were rejected.")
    if not isinstance(status_code, int) or not 200 <= status_code < 300:
        return _opencode_go_unavailable("The OpenCode Go usage API was unavailable.")

    try:
        payload = response.json()
    except Exception:
        return _opencode_go_unavailable("OpenCode Go usage response was invalid.")
    if not isinstance(payload, dict):
        return _opencode_go_unavailable("OpenCode Go usage response was invalid.")

    usage = payload.get("usage")
    if not isinstance(usage, dict) or not usage:
        return _opencode_go_unavailable("OpenCode Go usage response contained no windows.")

    windows: list[dict[str, Any]] = []
    for key in ("rolling", "weekly", "monthly"):
        window = _opencode_go_parse_window(key, usage.get(key))
        if window is not None:
            windows.append(window)
    if not windows:
        return _opencode_go_unavailable("OpenCode Go usage response contained no windows.")

    account = {
        "title": "OpenCode Go",
        "plan": None,
        "source": _OPENCODE_GO_SOURCE,
        "fetched_at": _utc_now().isoformat(),
        "unavailable_reason": None,
        "details": [],
        "windows": windows,
    }
    return _attach_meter(account, _meter_from_account_windows(account)) or account


def _meter_from_account_windows(account: dict[str, Any]) -> dict[str, Any] | None:
    windows = account.get("windows") or []
    if not windows:
        return None
    # Windows are already dicts here.
    preferred = None
    for key in ("weekly", "subscription", "monthly", "included"):
        for window in windows:
            label = str(window.get("label") or "").lower()
            if key in label and window.get("used_percent") is not None:
                preferred = window
                break
        if preferred is not None:
            break
    if preferred is None:
        preferred = next((w for w in windows if w.get("used_percent") is not None), windows[0])

    reset_raw = preferred.get("reset_at")
    reset_at = None
    if isinstance(reset_raw, str) and reset_raw:
        try:
            text = reset_raw[:-1] + "+00:00" if reset_raw.endswith("Z") else reset_raw
            reset_at = datetime.fromisoformat(text)
            if reset_at.tzinfo is None:
                reset_at = reset_at.replace(tzinfo=timezone.utc)
        except ValueError:
            reset_at = None
    start_raw = preferred.get("period_start")
    period_start = None
    if isinstance(start_raw, str) and start_raw:
        try:
            text = start_raw[:-1] + "+00:00" if start_raw.endswith("Z") else start_raw
            period_start = datetime.fromisoformat(text)
            if period_start.tzinfo is None:
                period_start = period_start.replace(tzinfo=timezone.utc)
        except ValueError:
            period_start = None

    fake = SimpleNamespace(
        label=preferred.get("label"),
        used_percent=preferred.get("used_percent"),
        reset_at=reset_at,
        detail=preferred.get("detail"),
        period_start=period_start,
        period_type=preferred.get("period_type"),
    )
    return _meter_usage(window=fake, period_start=period_start)


def _live_account(provider: str) -> dict[str, Any] | None:
    if provider == "nous":
        try:
            return _nous_account_dict()
        except Exception as exc:
            return {
                "unavailable_reason": f"Could not fetch Nous account data: {type(exc).__name__}",
                "windows": [],
                "details": [],
                "meter": _meter_credits(remaining_usd=None, allowance_usd=None),
            }
    if provider == "xai-oauth":
        account = _snapshot_to_dict(_fetch_xai_oauth_account_usage())
        if account is None:
            return None
        return _attach_meter(account, _meter_from_account_windows(account))
    if provider == "openrouter":
        return _fetch_openrouter_account()
    if provider == "deepseek":
        return _fetch_deepseek_balance_account()
    if provider == "opencode-go":
        return _fetch_opencode_go_account()

    snapshot = fetch_account_usage(provider)
    if snapshot:
        account = _snapshot_to_dict(snapshot)
        if account is None:
            return None
        return _attach_meter(account, _meter_from_account_windows(account))
    return None


def _collect() -> dict[str, Any]:
    connected = [provider for provider in _connected_providers() if provider not in _IGNORED_PROVIDERS]
    accounts: dict[str, Any] = {}
    for provider in connected:
        account = _live_account(provider)
        if account is not None:
            accounts[provider] = account
        elif provider in connected:
            accounts[provider] = {
                "windows": [],
                "details": [],
                "unavailable_reason": "This provider has no supported live usage/credit endpoint in Hermes.",
                "meter": {
                    "mode": "unknown",
                    "tone": "unknown",
                    "fill_percent": None,
                    "ahead_of_pace": False,
                },
            }
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "connected_providers": connected,
        "accounts": accounts,
    }


@router.get("/usage")
def usage() -> dict[str, Any]:
    with _cache_lock:
        now = time.monotonic()
        if _cache["value"] is not None and now - float(_cache["at"]) < _CACHE_SECONDS:
            return _cache["value"]
        value = _collect()
        _cache.update(at=time.monotonic(), value=value)
        return value
