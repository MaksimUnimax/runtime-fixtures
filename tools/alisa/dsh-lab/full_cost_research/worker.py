"""One isolated Harness turn. No production credentials or database access."""
from pathlib import Path
from dataclasses import asdict, is_dataclass
import json
import os
import time
from deepseek_harness import DeepSeekHarness

ROOT = Path("/opt/alisa-dsh-lab/20261110-r1")
WORK = Path("/workspace")

def main():
    start = time.monotonic()
    settings = json.loads((WORK / "request.json").read_text())
    os.environ["DEEPSEEK_API_KEY"] = (WORK / "local-transport-token").read_text()
    os.environ["DSH_SYSTEM_PROMPT"] = settings["system_prompt"]
    with DeepSeekHarness(
        profile="sdk-minimal",
        provider="deepseek-official",
        model="deepseek-flash",
        reasoning_effort="high",
        cwd=str(WORK),
        runtime_cwd=str(WORK),
        dsh_home=str(WORK / "home"),
        patches=(str(WORK / "harness.patch.yml"),),
        initialize_timeout_seconds=45,
        request_timeout_seconds=600,
        shutdown_timeout_seconds=10,
        base_url="http://127.0.0.1:33191",
    ) as harness:
        result = harness.run(settings["prompt"], session_id=settings["session_id"])
    payload = result.model_dump(mode="json") if hasattr(result, "model_dump") else asdict(result) if is_dataclass(result) else vars(result)
    payload["elapsed_seconds"] = round(time.monotonic() - start, 3)
    (WORK / "result.private.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2,
        default=lambda value: value.model_dump(mode="json") if hasattr(value, "model_dump") else str(value)) + "\n")
    print(json.dumps({"worker_completed": True, "elapsed_seconds": payload["elapsed_seconds"],
                      "finish_reason": str(result.finish_reason),
                      "answer_characters": len(result.final_response)}, ensure_ascii=False))
    if result.finish_reason not in (None, "completed", "stop") or not result.final_response.strip():
        raise RuntimeError("Harness turn did not complete with an answer")

if __name__ == "__main__":
    os.umask(0o077)
    main()
