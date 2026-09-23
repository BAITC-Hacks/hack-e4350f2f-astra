"""Проверка сайта в установленном Edge: python browser_smoke.py."""
import os
import socket
import threading
import time
from pathlib import Path

import uvicorn
from playwright.sync_api import sync_playwright, expect

from main import app


def run():
    # Проверка не использует настоящий ключ и не расходует квоту.
    os.environ.pop("OPENAI_API_KEY", None)
    os.environ.pop("OPENAI_MODEL", None)
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        server = uvicorn.Server(uvicorn.Config(app, log_level="error"))
        thread = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
        thread.start()
        try:
            for _ in range(100):
                if server.started:
                    break
                time.sleep(0.05)
            assert server.started
            with sync_playwright() as p:
                browser = p.chromium.launch(channel="msedge", headless=True)
                page = browser.new_page(viewport={"width": 1440, "height": 1000})
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(f"http://127.0.0.1:{listener.getsockname()[1]}")
                expect(page.locator(".measure")).to_have_count(14)
                expect(page.locator(".metric")).to_have_count(50)
                expect(page.locator("#score")).to_have_text("52.56")
                expect(page.locator("#simulate")).to_be_disabled()
                page.locator('[data-toggle="M1"]').click()
                expect(page.locator('[data-toggle="M3"]')).to_be_disabled()
                expect(page.locator("#simulate")).to_be_disabled()
                page.locator("#reset").click()
                page.locator('[data-toggle="M4"]').click()
                expect(page.locator('[data-toggle="M7"]')).to_be_disabled()
                page.locator('[data-district="M7"]').select_option(label="Сарыарка")
                expect(page.locator('[data-toggle="M7"]')).to_be_enabled()
                page.locator('[data-toggle="M7"]').click()
                page.locator('[data-district="M7"]').select_option(label="Нура")
                expect(page.locator("#error")).to_contain_text("несовместимы")
                expect(page.locator('[data-district="M7"]')).to_have_value("Сарыарка")
                page.locator("#reset").click()
                for mid in ("M3", "M5", "M7"):
                    page.locator(f'[data-toggle="{mid}"]').click()
                expect(page.locator("#budget-value")).to_have_text("79 / 100 у.е.")
                expect(page.locator('[data-toggle="M2"]')).to_be_disabled()
                page.locator("#reference").click()
                expect(page.locator("#budget-value")).to_have_text("95 / 100 у.е.")
                page.locator("#simulate").click()
                expect(page.locator("#score")).to_have_text("56.54")
                expect(page.locator("#retry-analysis")).to_be_visible()
                expect(page.locator("#verdict")).to_contain_text("Расчёт сохранён")
                expect(page.locator("#score-delta")).to_have_text("(+3.99)")
                page.locator("#save-A").click()
                expect(page.locator("#comparison-table")).to_contain_text("56.54")
                # Проверяем безопасное отображение полученного текста и повтор AI.
                page.route("**/api/analyze", lambda route: route.fulfill(json={
                    "status": "ok", "analysis": "### Оценка\n<img src=x onerror=alert(1)>\nТестовый анализ"}))
                page.locator("#retry-analysis").click()
                expect(page.locator("#verdict")).to_contain_text("Тестовый анализ")
                expect(page.locator("#verdict img")).to_have_count(0)
                page.locator('[data-district="M7"]').select_option(label="Сарыарка")
                expect(page.locator("#score")).to_have_text("52.56")
                expect(page.locator("#verdict")).not_to_contain_text("Тестовый анализ")
                page.locator("#simulate").click()
                expect(page.locator("#score")).to_have_text("55.24")
                expect(page.locator("#verdict")).to_contain_text("Тестовый анализ")
                page.locator("#save-B").click()
                expect(page.locator("#comparison-note")).to_contain_text("выше сценарий A на 1.30")
                expect(page.locator("#comparison-note")).to_contain_text("Нура")
                expect(page.locator("#comparison-table")).to_contain_text("55.24")
                with page.expect_download() as downloaded:
                    page.locator("#export-scenarios").click()
                import json
                exported = json.loads(Path(downloaded.value.path()).read_text(encoding="utf-8"))
                assert abs(exported["scenarios"]["A"]["result"]["score_after"] - 56.54307) < 1e-8
                assert abs(exported["scenarios"]["B"]["result"]["score_after"] - 55.24387) < 1e-8
                Path("docs").mkdir(exist_ok=True)
                page.locator(".comparison").screenshot(path="docs/comparison.png")
                page.locator("#reset").click()
                expect(page.locator("#save-A")).to_be_disabled()
                expect(page.locator("#comparison-table")).to_contain_text("56.54")
                page.set_viewport_size({"width": 390, "height": 844})
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
                page.locator("#clear-scenarios").click()
                expect(page.locator("#export-scenarios")).to_be_disabled()
                page.screenshot(path=str(Path(".venv") / "mobile-smoke.png"), full_page=True)
                assert not errors, errors
                browser.close()
                print("Browser checks passed: data, validation, calculation, AI retry, safe text, mobile.")
        finally:
            server.should_exit = True
            thread.join(timeout=5)


if __name__ == "__main__":
    run()
