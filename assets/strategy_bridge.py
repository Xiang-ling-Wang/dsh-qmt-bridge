#coding:gbk
# QMT built-in Python bridge (Python 3.6).
# Default MODE is "signal": it validates orders and writes acks, but never
# calls passorder.  Switch to "live" only after the paper gate is accepted.
#
# Install: QMT -> Model Trading -> new Python strategy -> paste this file,
# choose the account, run in "simulation" first.
import os
import json
import time
import hmac
import hashlib
import datetime
import glob

BASE = os.environ.get("DSH_QMT_BRIDGE_DIR") or os.path.join(os.path.expanduser("~"), ".dsh", "qmt-bridge")
OUTBOX = os.path.join(BASE, "outbox")
ACKS = os.path.join(BASE, "acks")
FILLS = os.path.join(BASE, "fills")
HALT = os.path.join(BASE, "HALT")
SECRET_FILE = os.path.join(BASE, "secret.txt")

MODE = "signal"          # signal | live
ACCOUNT_OVERRIDE = ""    # optional: set your fund account here if UI injection fails
MAX_QTY = 1000
SYMBOL_WHITELIST = ["301297.SZ"]
PRICE_CAGE = 0.02
STRATEGY_NAME = "DSH_BRIDGE"


def _ensure_dirs():
    for d in (BASE, OUTBOX, ACKS, FILLS):
        if not os.path.isdir(d):
            os.makedirs(d)


def _read_secret():
    try:
        f = open(SECRET_FILE, "r")
        s = f.read().strip()
        f.close()
        return s
    except Exception:
        return ""


def _canonical(o):
    return "%s|%s|%s|%d|%.2f|%s" % (
        o.get("order_id", ""), o.get("symbol", ""), o.get("side", ""),
        int(o.get("qty", 0)), float(o.get("price", 0.0)), o.get("expires_at", ""))


def _token_ok(o):
    secret = _read_secret()
    if not secret:
        return False
    expect = hmac.new(secret.encode("utf-8"), _canonical(o).encode("utf-8"),
                      hashlib.sha256).hexdigest()
    return hmac.compare_digest(expect, str(o.get("approval_token", "")))


def _expired(o):
    try:
        exp = datetime.datetime.strptime(o.get("expires_at", ""), "%Y-%m-%dT%H:%M:%S")
    except Exception:
        return True
    return datetime.datetime.now() > exp


def _write_json(path, rec):
    f = open(path, "w")
    json.dump(rec, f, ensure_ascii=True, indent=2)
    f.close()


def _ack(order_id, status, message, extra=None):
    rec = {"order_id": order_id, "status": status, "message": message,
           "ts": datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")}
    if extra:
        rec.update(extra)
    _write_json(os.path.join(ACKS, order_id + ".json"), rec)


def _last_price(C, code):
    try:
        tick = C.get_full_tick([code])
        px = float(tick[code]["lastPrice"])
        if px > 0:
            return px
    except Exception:
        pass
    try:
        data = C.get_market_data_ex(["close"], [code], period="1d", count=1)
        return float(data[code]["close"].iloc[-1])
    except Exception:
        return 0.0


def _validate(C, o):
    if o.get("mode") != "live":
        return "mode_not_live"
    if o.get("symbol") not in SYMBOL_WHITELIST:
        return "symbol_not_allowed"
    if o.get("side") not in ("BUY", "SELL"):
        return "bad_side"
    try:
        qty = int(o.get("qty", 0))
        px = float(o.get("price", 0.0))
    except Exception:
        return "bad_number"
    if qty <= 0 or qty % 100 != 0:
        return "bad_qty"
    if qty > MAX_QTY:
        return "qty_too_large"
    last = _last_price(C, o.get("symbol", ""))
    if last <= 0:
        return "no_price"
    if abs(px / last - 1.0) > PRICE_CAGE:
        return "price_out_of_cage"
    if _expired(o):
        return "expired"
    if not _token_ok(o):
        return "bad_token"
    return ""


def _acct():
    return globals().get("account", "") or ACCOUNT_OVERRIDE


def _process(C):
    if os.path.exists(HALT):
        return
    for path in sorted(glob.glob(os.path.join(OUTBOX, "*.json"))):
        order_id = os.path.basename(path)[:-5]
        try:
            f = open(path, "r")
            o = json.load(f)
            f.close()
        except Exception as e:
            _ack(order_id, "bad_json", str(e))
            try:
                os.remove(path)
            except Exception:
                pass
            continue

        err = _validate(C, o)
        if err:
            _ack(order_id, "rejected", err)
            os.remove(path)
            continue

        if MODE != "live":
            _ack(order_id, "signal_only", "MODE=signal, passorder not called")
            os.remove(path)
            continue

        acct = _acct()
        if not acct:
            _ack(order_id, "rejected", "account not bound; run in model trading UI")
            os.remove(path)
            continue

        op = 23 if o["side"] == "BUY" else 24
        passorder(op, 1101, acct, o["symbol"], int(o.get("pr_type", 11)),
                  float(o["price"]), int(o["qty"]), STRATEGY_NAME, 2,
                  order_id, C)
        _ack(order_id, "submitted", "passorder called", {"account": acct})
        os.remove(path)


def _timer(C):
    try:
        _process(C)
    except Exception as e:
        print("bridge timer error: " + str(e))


def init(C):
    _ensure_dirs()
    acct = _acct()
    if acct:
        try:
            C.set_account(acct)
        except Exception:
            pass
    else:
        print("ERROR: account is empty. Add this strategy in Model Trading, "
              "select a fund account, and run 'simulation trading'. "
              "The quote/chart 'simulation signal' mode does not bind an account.")
    C.run_time("_timer", "3nSecond", "2019-10-14 13:20:00")
    print("DSH bridge init, mode=" + MODE + ", account=" + str(acct))


def after_init(C):
    _process(C)


def handlebar(C):
    pass


def order_callback(C, order):
    try:
        oid = getattr(order, "m_strRemark", "") or ""
        if not oid:
            return
        _write_json(os.path.join(ACKS, oid + "_order.json"), {
            "order_id": oid,
            "status": int(getattr(order, "m_nOrderStatus", -1)),
            "traded": int(getattr(order, "m_nVolumeTraded", 0)),
            "price": float(getattr(order, "m_dTradedPrice", 0.0)),
            "cancel_info": str(getattr(order, "m_strCancelInfo", "")),
            "ts": datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        })
    except Exception as e:
        print("order_callback error: " + str(e))


def deal_callback(C, deal):
    try:
        oid = getattr(deal, "m_strRemark", "") or "UNKNOWN"
        trade_id = str(getattr(deal, "m_strTradeID", ""))
        _write_json(os.path.join(FILLS, oid + "_" + trade_id + ".json"), {
            "order_id": oid,
            "trade_id": trade_id,
            "price": float(getattr(deal, "m_dPrice", 0.0)),
            "volume": int(getattr(deal, "m_nVolume", 0)),
            "commission": float(getattr(deal, "m_dCommission", 0.0)),
            "ts": datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        })
    except Exception as e:
        print("deal_callback error: " + str(e))


def stop(C):
    print("DSH bridge stopped")
