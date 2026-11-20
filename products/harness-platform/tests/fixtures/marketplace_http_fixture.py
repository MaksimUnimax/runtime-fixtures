"""Use real matrix subprocesses with deterministic marketplace HTTP replies in tests."""
import json
import subprocess
import sys
import tempfile
from unittest.mock import patch

from platform_core.marketplace_matrix import plugin, worker

PLUGINS = ()


def read(request, *, on_dispatch=None, **options):
    if on_dispatch:
        on_dispatch()
    payload = json.loads(request.data)
    if request.host == "seller-analytics-api.wildberries.ru":
        assert request.get_header("Authorization") == "only-fixture-wb"
        row = {"product":{"nmId":101},"statistic":{"selected":{"period":payload["selectedPeriod"],"orderCount":13}}}
        result = {"data":{"currency":"RUB","products":[row]}}
    elif request.host == "api-seller.ozon.ru":
        assert request.get_header("Api-key") == "only-fixture-ozon"
        assert payload["metrics"] == ["ordered_units"]
        result = {"result":{"totals":[29],"data":[{"dimensions":[{"id":"2026-11"}],"metrics":[29]}]}}
    else:
        raise AssertionError("Unexpected marketplace request")
    return json.dumps(result).encode(), 200


if __name__ == "__main__":
    unpack = worker.unpack
    def unpack_with_test_http(directory):
        unpack(directory)
        patch("http_transport.read_response", read).start()
    worker.unpack = unpack_with_test_http
    worker.main()
else:
    original = plugin.invoke
    def invoke(packet, timeout):
        if "selections" not in packet:
            return original(packet, timeout)
        with tempfile.TemporaryDirectory() as tmp:
            packet["workingDirectory"] = tmp
            child = subprocess.run([sys.executable, "-m", __name__], cwd=plugin.ROOT,
                input=json.dumps(packet),text=True,capture_output=True,timeout=timeout,check=True)
        return json.loads(child.stdout)
    plugin.invoke = invoke
