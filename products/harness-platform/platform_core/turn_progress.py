"""Short-lived, authorized progress for an in-flight native turn."""
import asyncio
import json
import re
from starlette.exceptions import HTTPException
from starlette.responses import StreamingResponse, JSONResponse
from starlette.routing import Route

STAGES={"accepted","model","thinking","tool","writing"}

class LiveTurn:
    def __init__(self):
        self.stage="waiting"
        self.text=""
        self.step=0
        self.done=False
        self.changed=asyncio.Event()

    def set(self,data):
        if self.done: return
        stage=data.get("stage")
        if stage not in STAGES: return
        self.stage=stage
        if stage=="model":
            self.step+=1
            self.text=""
        if stage=="writing" and isinstance(data.get("text"),str):
            self.text=(self.text+data["text"])[:65536]
        self.wake()

    def wake(self):
        signal=self.changed
        self.changed=asyncio.Event()
        signal.set()

class Progress:
    def __init__(self):
        self.turns={}

    def begin(self,scope,rid):
        key=(scope,rid)
        existing=self.turns.get(key)
        if existing and not existing.done: return existing,False
        turn=LiveTurn()
        self.turns[key]=turn
        return turn,True

    def finish(self,scope,rid,turn):
        turn.done=True
        turn.wake()
        def forget():
            if self.turns.get((scope,rid)) is turn:
                del self.turns[scope,rid]
        asyncio.get_running_loop().call_later(5,forget)

def routes(token_for):
    async def stream(req):
        identity=req.app.state.identity
        token=token_for(req,allow_cookie=True)
        chat=req.path_params["chat_id"]
        scope=identity.resolve_chat(token,chat)
        rid=req.query_params.get("requestId")
        hub=req.app.state.progress
        if rid is None:
            active=next((r for (s,r),v in hub.turns.items() if s==scope and not v.done),None)
            return JSONResponse({"requestId":active})
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}",rid): raise HTTPException(400)
        async def messages():
            # GET may arrive just before the POST. No slot is allocated by a reader.
            for _ in range(40):
                turn=hub.turns.get((scope,rid))
                if turn: break
                await asyncio.sleep(.1)
            else: return
            while True:
                identity.resolve_chat(token,chat)
                signal=turn.changed
                yield json.dumps({"stage":turn.stage,"text":turn.text,"step":turn.step,"done":turn.done},ensure_ascii=False)+"\n"
                if turn.done: return
                try: await asyncio.wait_for(signal.wait(),8)
                except TimeoutError: pass
                await asyncio.sleep(.05)
        return StreamingResponse(messages(),media_type="application/x-ndjson",headers={"X-Accel-Buffering":"no","Cache-Control":"no-store"})
    return [Route("/api/chats/{chat_id}/progress",stream)]
