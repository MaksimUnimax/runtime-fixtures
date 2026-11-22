"""Owner-facing timer controls. Only the internal test runner can issue a preview receipt."""
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from ...chat_connections import scope_for
from . import store

BASE = "/api/chats/{chat_id}/plugins/timer"


def draft_view(row):
    return {"id": row["id"], "kind": row["kind"], "revision": row["revision"],
            "instructions": row["instructions"], "eventId": row["target"],
            "preview": row["preview"], "receipt": row["receipt"], "accepted": bool(row["accepted"])}


def event_view(row):
    return {"id": row["id"], "kind": row["kind"], "revision": row["revision"],
            "instructions": row["instructions"], "schedule": row["schedule"],
            "status": row["status"], "nextAt": (store.schedule.timestamp(row["next_us"]).isoformat()
                                                if row["next_us"] is not None else None)}


def routes(get_token, body):
    async def endpoint(req, command):
        token = get_token(req, allow_cookie=True)
        chat = req.path_params["chat_id"]
        identity = req.app.state.identity
        key = req.path_params.get("key")
        data = {}
        if command == "start":
            data = await body(req, "requestId", "text", optional=("kind", "eventId"))
            if not isinstance(data["requestId"], str) or not data["requestId"]:
                raise ValueError("Нужен идентификатор запроса.")
        elif command == "refine":
            data = await body(req, "revision", "text")
        elif command == "confirm":
            data = await body(req, "revision", "receipt")
        elif command == "cancel":
            data = await body(req, "revision")
        elif req.method == "POST":
            await body(req)
        with identity._write() if req.method == "POST" else identity._lock:
            db = identity._db
            scope = scope_for(db, token, chat)
            store.require_plugin(db, scope)
            if command == "list":
                before = req.query_params.get("before")
                if before is not None:
                    before = int(before)
                    if not 0 < before < 2**63:
                        raise ValueError("Неверная страница списка таймеров.")
                rows, next_cursor = store.list_events(db, scope, before)
                return JSONResponse({"events": [event_view(row) for row in rows], "nextCursor": next_cursor})
            if command == "start":
                row = store.start(db, scope, data.get("kind"), data["text"], data.get("eventId"),
                                  request_id=data["requestId"])
                return JSONResponse(draft_view(row))
            if command == "draft":
                return JSONResponse(draft_view(store.draft(db, scope, key)))
            if command == "refine":
                return JSONResponse(draft_view(store.refine(db, scope, key, data["revision"], data["text"])))
            if command == "confirm":
                return JSONResponse(event_view(store.confirm(db, scope, key, data["revision"], data["receipt"])))
            if command == "cancel":
                store.cancel(db, scope, key, data["revision"])
            else:
                store.change_status(db, scope, key, command)
            return Response(status_code=204)

    def route(suffix, command, method="POST"):
        async def handle(req):
            return await endpoint(req, command)
        return Route(BASE + suffix, handle, methods=[method])

    return [route("", "list", "GET"), route("/drafts", "start"), route("/drafts/{key}", "draft", "GET"),
            *(route("/drafts/{key}/" + cmd, cmd) for cmd in ("refine", "cancel", "confirm")),
            *(route("/events/{key}/" + cmd, cmd) for cmd in ("pause", "resume", "delete"))]
