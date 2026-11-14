"""Smoke-test a running API/container with stdlib only and no external data calls.

python -m deploy.check_runtime --url http://127.0.0.1:8000
Use --api-only before a front-end build. Exits nonzero on any failed check.
"""
import argparse
from html.parser import HTMLParser
import json
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen


class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script" and attrs.get("src"):
            self.urls.add(attrs["src"])
        if tag == "link" and attrs.get("rel") == "stylesheet" and attrs.get("href"):
            self.urls.add(attrs["href"])


def fetch(base, path, body=None, expected=200):
    url = base.rstrip("/") + path
    request = Request(url, data=None if body is None else json.dumps(body).encode(),
                      headers={"Content-Type": "application/json"} if body is not None else {})
    try:
        response = urlopen(request, timeout=10)
    except HTTPError as error:
        response = error
    with response:
        payload = response.read()
        assert response.status == expected, f"{path}: HTTP {response.status}, esperado {expected}: {payload[:500]!r}"
        return payload, response.headers.get_content_type()


def check(base, api_only=False):
    deadline = time.monotonic() + 60
    while True:
        try:
            health = json.loads(fetch(base, "/health")[0])
            assert health["status"] == "ok"
            break
        except (URLError, TimeoutError, AssertionError):
            if time.monotonic() >= deadline:
                raise
            time.sleep(1)

    metadata = json.loads(fetch(base, "/metadata")[0])
    assert metadata["point_climate_available"] is True
    ids = {culture["id"] for culture in metadata["cultures"]}
    assert {"soja", "milho", "trigo"} <= ids, "Catálogo incompleto"
    assert metadata["demo_field"]["boundary"]["type"] == "FeatureCollection"
    result = json.loads(fetch(base, "/analyze", {"lat": -20.032, "lon": -48.526, "horizonte": 2})[0])
    assert result["origem"]["hoje"] == "tabela_demo"
    assert result["origem"]["aviso"]
    assert all(len(result["clima"][scenario]) == 12 for scenario in ("hoje", "futuro", "seco"))
    assert result["sequencias"] and len(result["sequencias"]) + len(result["descartadas"]) == len(ids) ** 2
    outside = json.loads(fetch(base, "/analyze", {"lat": -30, "lon": -51}, expected=422)[0])
    assert "cobertura" in outside["detail"]
    print("API: catálogo, origem, três cenários e erro de cobertura conferidos.", flush=True)
    if api_only:
        return

    html, content_type = fetch(base, "/")
    assert content_type == "text/html" and b"Happy Farmers" in html
    parser = Assets()
    parser.feed(html.decode("utf-8"))
    assert any(url.endswith(".js") for url in parser.urls), "Bundle JS ausente no HTML"
    assert any(url.endswith(".css") for url in parser.urls), "CSS ausente no HTML"
    for asset in parser.urls:
        parsed = urlparse(urljoin(base + "/", asset))
        assert parsed.netloc == urlparse(base).netloc, f"Asset inesperado fora da aplicação: {asset}"
        payload, _ = fetch(base, parsed.path)
        assert payload, f"Asset vazio: {asset}"
    assert fetch(base, "/pkg/app.js")[0]
    wasm, content_type = fetch(base, "/pkg/app_bg.wasm")
    assert content_type == "application/wasm" and wasm[:4] == b"\0asm", "WASM inválido"
    print("Site: HTML, CSS, JS e Rune/WASM servidos pelo serviço de produção.", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--api-only", action="store_true")
    args = parser.parse_args()
    check(args.url.rstrip("/"), args.api_only)
