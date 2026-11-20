"""Write-only operator credentials. Replacing a key takes effect on the next call."""
import argparse
import getpass
import os
from pathlib import Path
import tempfile

PROVIDERS = ("deepseek","openrouter")
DEFAULT_DIRECTORY = Path("/var/lib/harness-prod/provider-keys")

def directory():
    value=os.environ.get("HARNESS_PROVIDER_KEYS_DIR")
    return Path(value) if value else None

def read(provider):
    root=directory()
    if provider not in PROVIDERS:
        raise ValueError("Unknown provider")
    if root:
        try:
            return (root/provider).read_text().strip()
        except FileNotFoundError:
            pass
    return ""

def save(root,provider,value):
    if provider not in PROVIDERS or not isinstance(value,str):
        raise ValueError("Invalid credential")
    value=value.strip()
    if not 10 <= len(value) <= 2048 or not value.isascii() or not all(32<ord(c)<127 for c in value):
        raise ValueError("Invalid credential")
    if (provider=="deepseek" and value.startswith("sk-or-")) or (provider=="openrouter" and value.startswith("sk-") and not value.startswith("sk-or-")):
        raise ValueError("Wrong provider")
    root=Path(root)
    root.mkdir(mode=0o700,exist_ok=True)
    # A CLI running as root must create credentials readable by systemd's DynamicUser.
    owner=root.parent.stat()
    if os.geteuid()==0:
        os.chown(root,owner.st_uid,owner.st_gid)
    fd,name=tempfile.mkstemp(dir=root)
    try:
        with os.fdopen(fd,"w") as f:
            if os.geteuid()==0:
                os.fchown(f.fileno(),owner.st_uid,owner.st_gid)
            f.write(value+"\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(name,root/provider)
        dfd=os.open(root,os.O_RDONLY|os.O_DIRECTORY)
        try:
            os.fsync(dfd)
        finally:
            os.close(dfd)
    finally:
        Path(name).unlink(missing_ok=True)

def routes(get_token, body):
    from starlette.exceptions import HTTPException
    from starlette.responses import JSONResponse
    from starlette.routing import Route
    async def keys(req):
        token=get_token(req,allow_cookie=True)
        identity=req.app.state.identity
        if not identity.is_admin(token):
            raise HTTPException(403,"Administrator required")
        if req.method=="POST":
            values=await body(req,"key")
            if not identity.is_admin(token):
                raise HTTPException(403,"Administrator required")
            if not directory():
                raise HTTPException(503,"Каталог ключей не настроен")
            save(directory(),req.path_params["provider"],values["key"])
        relay=bool(os.getenv("HARNESS_PROVIDER_RELAY_KEY_FILE") or os.getenv("HARNESS_ACCEPTANCE_KEY_FILE"))
        configured_router=bool(os.getenv("HARNESS_OPENROUTER_KEY_FILE") and Path(os.environ["HARNESS_OPENROUTER_KEY_FILE"]).is_file())
        return JSONResponse({"deepseek":{"configured":bool(read("deepseek")) or relay},
                  "openrouter":{"configured":bool(read("openrouter")) or configured_router,
                  "enabled":req.app.state.model_router is not None and req.app.state.model_router.available()}})
    return [Route("/api/admin/provider-keys",keys), Route("/api/admin/provider-keys/{provider}",keys,methods=["POST"])]

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("provider",choices=PROVIDERS)
    args=parser.parse_args()
    save(directory() or DEFAULT_DIRECTORY,args.provider,getpass.getpass("API key (hidden): "))
    print("Ключ сохранён для "+args.provider)

