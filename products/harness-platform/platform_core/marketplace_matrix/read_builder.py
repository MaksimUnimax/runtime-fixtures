"""Invoke the pinned local request validator before an outbound API call."""
import errno
import json
import subprocess
import syslog


def checked_response(script, payload):
    from semantics import Rejected

    # This subprocess only builds a request. Repeating it cannot issue an HTTP
    # call, create a report, or charge a model operation.
    for attempt, timeout in enumerate((5, 15), start=1):
        try:
            proc = subprocess.run(["node", str(script)], input=payload.encode(),
                                  capture_output=True, timeout=timeout)
            response = json.loads(proc.stdout)
            if isinstance(response, dict) and type(response.get("ok")) is bool:
                return response
            reason = "invalid response schema"
        except subprocess.TimeoutExpired:
            reason = "timeout"
        except OSError as exc:
            reason = errno.errorcode.get(exc.errno, "OS_ERROR")
            if exc.errno not in (errno.EAGAIN, errno.EINTR):
                syslog.syslog(syslog.LOG_ERR, "octoport request validator: " + reason)
                break
        except (UnicodeError, ValueError):
            reason = "output status=" + str(proc.returncode)
        syslog.syslog(syslog.LOG_WARNING, f"octoport request validator attempt={attempt} {reason}")
    raise Rejected("READ_BUILDER_UNAVAILABLE")
