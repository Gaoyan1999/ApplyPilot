"""Live preview screenshots for the web Tasks dashboard.

Each worker's Chrome runs with a CDP debug port for as long as its slot is
occupied (see chrome.launch_chrome). This polls that port for a JPEG
screenshot of whatever page is currently active and stores it on the
worker's dashboard.WorkerState, so the web UI can show a live "what is it
doing right now" preview without the user needing to look at the actual
Chrome window.

Uses a single long-lived Playwright CDP connection per worker rather than
reconnecting on every poll tick -- connect_over_cdp().close() only detaches
the client, it doesn't touch the underlying Chrome process, so this never
interferes with the @playwright/mcp connection driving the actual apply.
"""

import base64
import logging
import threading
import time

from playwright.sync_api import sync_playwright

from applypilot.apply import dashboard

logger = logging.getLogger(__name__)

POLL_INTERVAL_S = 1.5
JPEG_QUALITY = 40
CONNECT_TIMEOUT_MS = 2000
CONNECT_RETRIES = 20

_stop_events: dict[int, threading.Event] = {}
_lock = threading.Lock()


def start(worker_id: int, cdp_port: int) -> None:
    """Start polling `worker_id`'s Chrome for screenshots in a background
    thread. No-op if a poller is already running for this worker."""
    with _lock:
        if worker_id in _stop_events:
            return
        stop_event = threading.Event()
        _stop_events[worker_id] = stop_event

    thread = threading.Thread(
        target=_poll_loop, args=(worker_id, cdp_port, stop_event), daemon=True,
    )
    thread.start()


def stop(worker_id: int) -> None:
    """Stop `worker_id`'s poller, if one is running. The last-captured
    screenshot is left in place on its WorkerState (e.g. so a job left open
    for review still shows its final frame)."""
    with _lock:
        stop_event = _stop_events.pop(worker_id, None)
    if stop_event is not None:
        stop_event.set()


def _poll_loop(worker_id: int, cdp_port: int, stop_event: threading.Event) -> None:
    try:
        with sync_playwright() as p:
            browser = None
            for _ in range(CONNECT_RETRIES):
                if stop_event.is_set():
                    return
                try:
                    browser = p.chromium.connect_over_cdp(
                        f"http://localhost:{cdp_port}", timeout=CONNECT_TIMEOUT_MS,
                    )
                    break
                except Exception:
                    time.sleep(0.5)
            if browser is None:
                return

            try:
                while not stop_event.is_set():
                    try:
                        context = browser.contexts[0] if browser.contexts else None
                        page = context.pages[-1] if context and context.pages else None
                        if page is not None:
                            data = page.screenshot(
                                type="jpeg", quality=JPEG_QUALITY, timeout=CONNECT_TIMEOUT_MS,
                            )
                            dashboard.update_state(
                                worker_id, screenshot=base64.b64encode(data).decode("ascii"),
                            )
                    except Exception:
                        # Page mid-navigation, closed, or Chrome briefly busy --
                        # next tick retries; the last good frame just goes
                        # stale rather than erroring the whole poller.
                        pass
                    stop_event.wait(POLL_INTERVAL_S)
            finally:
                browser.close()
    except Exception:
        logger.debug("Screenshot poller for worker %d exited", worker_id, exc_info=True)
