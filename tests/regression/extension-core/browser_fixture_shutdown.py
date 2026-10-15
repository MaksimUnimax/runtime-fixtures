"""Confirm shutdown of this test's standard-library HTTP signing fixture."""
import socketserver


def assert_http_fixture_stopped(server):
    assert not server.thread.is_alive(), "SYNTHETIC_HEALTH_SERVER_THREAD_STILL_ACTIVE"
    raw = server._server
    assert raw.daemon_threads is False, "SYNTHETIC_HEALTH_HANDLER_JOIN_DISABLED"
    assert raw.block_on_close is True, "SYNTHETIC_HEALTH_HANDLER_CLOSE_JOIN_DISABLED"
    registry = getattr(raw, "_threads", None)
    # Before the first request Python 3.11/3.12 uses a non-iterable sentinel.
    # It specifically proves no request-handler threads were registered.
    if isinstance(registry, socketserver._NoThreads):
        return
    assert isinstance(registry, socketserver._Threads), "SYNTHETIC_HEALTH_THREAD_REGISTRY_UNKNOWN"
    assert not any(thread.is_alive() for thread in registry), (
        "SYNTHETIC_HEALTH_REQUEST_THREAD_STILL_ACTIVE"
    )
