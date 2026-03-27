#!/usr/bin/env python3
"""Pattern 4: Fine-grained progress bar with true color gradient"""

import json, subprocess, sys, os, time, datetime, urllib.request, urllib.error

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

data = json.load(sys.stdin)

BLOCKS = " ▏▎▍▌▋▊▉█"
R = "\033[0m"
DIM = "\033[2m"

CACHE_FILE = os.path.expanduser("~/.claude/logs/claude-usage-cache.json")
CACHE_TTL = 360
JST = datetime.timezone(datetime.timedelta(hours=9))


def gradient(pct):
    if pct < 50:
        r = int(pct * 5.1)
        return f"\033[38;2;{r};200;80m"
    else:
        g = int(200 - (pct - 50) * 4)
        return f"\033[38;2;255;{max(g, 0)};60m"


def bar(pct, width=10):
    pct = min(max(pct, 0), 100)
    filled = pct * width / 100
    full = int(filled)
    frac = int((filled - full) * 8)
    b = "█" * full
    if full < width:
        b += BLOCKS[frac]
        b += "░" * (width - full - 1)
    return b


def format_reset(epoch_str, is_7d=False):
    """Format epoch seconds as reset time in JST."""
    if not epoch_str:
        return ""
    try:
        dt = datetime.datetime.fromtimestamp(int(epoch_str), tz=JST)
        hour = dt.strftime("%I%p").lstrip("0").lower()  # e.g. "3pm"
        if is_7d:
            label = f"{dt.strftime('%b').capitalize()} {dt.day} at {hour}"
        else:
            label = hour
        return f"  {DIM}Resets {label} (JST){R}"
    except Exception:
        return ""


def fmt(label, pct, reset_epoch=None, is_7d=False):
    p = round(pct)
    result = f"{label} {gradient(pct)}{bar(pct)} {p}%{R}"
    if reset_epoch:
        result += format_reset(reset_epoch, is_7d=is_7d)
    return result


def fetch_usage():
    """Fetch rate limit headers via a minimal Haiku call, cache results."""
    try:
        token_raw = subprocess.check_output(
            [
                "security",
                "find-generic-password",
                "-s",
                "Claude Code-credentials",
                "-w",
            ],
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
    except Exception:
        return None

    if not token_raw:
        return None

    try:
        token_json = json.loads(token_raw)
        access_token = token_json.get("claudeAiOauth", {}).get("accessToken", "")
    except Exception:
        access_token = token_raw

    if not access_token:
        return None

    cc_version = data.get("version", "0.0.0")
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(
            {
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 1,
                "messages": [{"role": "user", "content": "h"}],
            }
        ).encode(),
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            "User-Agent": f"claude-code/{cc_version}",
            "anthropic-beta": "oauth-2025-04-20",
            "anthropic-version": "2023-06-01",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            hdrs = dict(resp.headers)
    except urllib.error.HTTPError as e:
        hdrs = dict(e.headers)
    except Exception:
        return None

    # Header names are case-insensitive; normalize to lower
    hdrs_lower = {k.lower(): v for k, v in hdrs.items()}
    h5u = hdrs_lower.get("anthropic-ratelimit-unified-5h-utilization", "")
    h5r = hdrs_lower.get("anthropic-ratelimit-unified-5h-reset", "")
    h7u = hdrs_lower.get("anthropic-ratelimit-unified-7d-utilization", "")
    h7r = hdrs_lower.get("anthropic-ratelimit-unified-7d-reset", "")

    if not h5u:
        return None

    cache_data = {
        "five_hour_util": h5u,
        "five_hour_reset": h5r,
        "seven_day_util": h7u,
        "seven_day_reset": h7r,
    }
    try:
        with open(CACHE_FILE, "w") as f:
            json.dump(cache_data, f)
    except Exception:
        pass
    return cache_data


def get_usage():
    if os.path.exists(CACHE_FILE):
        try:
            age = time.time() - os.path.getmtime(CACHE_FILE)
            if age < CACHE_TTL:
                with open(CACHE_FILE) as f:
                    return json.load(f)
        except Exception:
            pass

    result = fetch_usage()
    if result:
        return result

    # Fall back to stale cache
    try:
        with open(CACHE_FILE) as f:
            return json.load(f)
    except Exception:
        return None


# ---- Build output ----

model = data.get("model", {}).get("display_name", "Claude")
parts = [model]

cwd = data.get("workspace", {}).get("current_dir") or data.get("cwd", ".")
try:
    branch = subprocess.check_output(
        ["git", "-C", cwd, "branch", "--show-current"],
        stderr=subprocess.DEVNULL,
        text=True,
    ).strip()
    if branch:
        parts.append(f"\033[38;2;100;180;255m{branch}{R}")
except Exception:
    pass

ctx = data.get("context_window", {}).get("used_percentage")
if ctx is not None:
    parts.append(fmt("ctx", ctx))

usage = get_usage()
five_reset = (usage or {}).get("five_hour_reset")
seven_reset = (usage or {}).get("seven_day_reset")

five = data.get("rate_limits", {}).get("five_hour", {}).get("used_percentage")
if five is not None:
    parts.append(fmt("5h", five, five_reset))

week = data.get("rate_limits", {}).get("seven_day", {}).get("used_percentage")
if week is not None:
    parts.append(fmt("7d", week, seven_reset, is_7d=True))

print(f"{DIM}│{R}".join(f" {p} " for p in parts), end="")
