"""Проверка сайта: Chrome на macOS/Linux, Edge на Windows.

BROWSER_CHANNEL позволяет выбрать другой установленный браузер.
"""
import os
import socket
import sys
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
                channel = os.environ.get("BROWSER_CHANNEL", "msedge" if sys.platform == "win32" else "chrome")
                browser = p.chromium.launch(channel=channel, headless=True)
                page = browser.new_page(viewport={"width": 1440, "height": 1000})
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(f"http://127.0.0.1:{listener.getsockname()[1]}")
                expect(page.locator(".measure")).to_have_count(14)
                expect(page.locator(".metric")).to_have_count(50)
                expect(page.locator("#score")).to_have_text("52.56")
                expect(page.locator("#export-report")).to_be_disabled()
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
                page.reload()
                expect(page.locator("#score")).to_have_text("56.54")
                expect(page.locator("#retry-analysis")).to_be_visible()
                # Печатный диалог подменяем, но CSS и PDF проверяем настоящим Chrome.
                page.evaluate("() => { window.printCalls=0; window.print=()=>{window.printCalls++; window.dispatchEvent(new Event('beforeprint'));}; }")
                page.locator("#export-report").click()
                assert page.evaluate("window.printCalls") == 1, (page.evaluate("window.printCalls"), errors, page.locator("#report-status").text_content())
                report = page.locator("#print-report")
                expect(report).to_contain_text("56.54")
                expect(report).to_contain_text("Школа + детсад")
                expect(report).to_contain_text("AI-анализ не получен")
                expect(report.locator(".report-district")).to_have_count(5)
                expect(report.locator(".report-district tbody tr")).to_have_count(50)
                page.emulate_media(media="print")
                expect(report).to_be_visible()
                expect(page.locator(".dashboard")).not_to_be_visible()
                pdf = page.pdf(path=str(Path(".venv") / "report-smoke.pdf"), prefer_css_page_size=True)
                assert pdf.startswith(b"%PDF-") and len(pdf) > 10000
                page.emulate_media(media="screen")
                expect(report).not_to_be_visible()
                page.locator("#save-A").click()
                expect(page.locator("#comparison-table")).to_contain_text("56.54")
                # Проверяем безопасное отображение полученного текста и повтор AI.
                page.route("**/api/analyze", lambda route: route.fulfill(json={
                    "status": "ok", "analysis": "### Оценка\n<img src=x onerror=alert(1)>\nТестовый анализ"}))
                page.locator("#retry-analysis").click()
                expect(page.locator("#verdict")).to_contain_text("Тестовый анализ")
                expect(page.locator("#verdict img")).to_have_count(0)
                page.locator("#export-report").click()
                expect(report).to_contain_text("Тестовый анализ")
                expect(report.locator("img")).to_have_count(0)
                page.locator('[data-district="M7"]').select_option(label="Сарыарка")
                expect(page.locator("#score")).to_have_text("52.56")
                expect(page.locator("#verdict")).not_to_contain_text("Тестовый анализ")
                expect(page.locator("#export-report")).to_be_disabled()
                expect(report).to_be_empty()
                page.locator("#simulate").click()
                expect(page.locator("#score")).to_have_text("55.24")
                expect(page.locator("#verdict")).to_contain_text("Тестовый анализ")
                page.locator("#save-B").click()
                page.reload()
                expect(page.locator("#score")).to_have_text("55.24")
                expect(page.locator("#verdict")).to_contain_text("Тестовый анализ")
                expect(page.locator("#decision-count")).to_have_text("5")
                expect(page.locator("#comparison-measures details")).to_contain_text("Тестовый анализ")
                expect(page.locator("#comparison-note")).to_contain_text("выше сценарий A на 1.30")
                expect(page.locator("#comparison-note")).to_contain_text("Нура")
                expect(page.locator("#comparison-table")).to_contain_text("55.24")
                with page.expect_download() as downloaded:
                    page.locator("#export-scenarios").click()
                import json
                exported = json.loads(Path(downloaded.value.path()).read_text(encoding="utf-8"))
                assert abs(exported["scenarios"]["A"]["result"]["score_after"] - 56.54307) < 1e-8
                assert abs(exported["scenarios"]["B"]["result"]["score_after"] - 55.24387) < 1e-8
                assert "Тестовый анализ" in exported["scenarios"]["B"]["analysis"]
                page.locator(".comparison").screenshot(path=str(Path(".venv") / "comparison-smoke.png"))
                page.locator("#reset").click()
                expect(page.locator("#save-A")).to_be_disabled()
                expect(page.locator("#comparison-table")).to_contain_text("56.54")
                page.reload()
                expect(page.locator("#comparison-table")).to_contain_text("56.54")
                expect(page.locator("#decision-count")).to_have_text("0")
                page.set_viewport_size({"width": 390, "height": 844})
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
                page.locator("#clear-scenarios").click()
                expect(page.locator("#export-scenarios")).to_be_disabled()
                page.reload()
                expect(page.locator("#export-scenarios")).to_be_disabled()
                page.screenshot(path=str(Path(".venv") / "mobile-smoke.png"), full_page=True)
                # Новый выбор без расчёта, район и категория переживают перезагрузку.
                page.locator("#reference").click()
                page.locator('[data-district="M7"]').select_option(label="Сарыарка")
                page.locator('[data-category="Соцсфера"]').click()
                page.reload()
                expect(page.locator('[data-category="Соцсфера"]')).to_have_attribute("aria-pressed", "true")
                expect(page.locator("#decision-count")).to_have_text("5")
                expect(page.locator("#budget-value")).to_have_text("95 / 100 у.е.")
                expect(page.locator('[data-district="M7"]')).to_have_value("Сарыарка")
                expect(page.locator('[data-toggle="M7"]')).to_have_attribute("aria-pressed", "true")
                expect(page.locator("#score")).to_have_text("52.56")
                expect(page.locator("#export-report")).to_be_disabled()
                page.locator("#reset").click()
                page.reload()
                expect(page.locator("#decision-count")).to_have_text("0")
                expect(page.locator('[data-category="Соцсфера"]')).to_have_attribute("aria-pressed", "true")
                page.evaluate("localStorage.setItem('akim-selection-v1', '{broken')")
                page.reload()
                expect(page.locator(".measure")).to_have_count(14)
                expect(page.locator("#decision-count")).to_have_text("0")
                page.evaluate("localStorage.setItem('akim-selection-v1', JSON.stringify({version:1, selected:['M1','M3','M99'], targets:{M1:'Нура',M3:'Нура'}, category:'Missing'}))")
                page.reload()
                expect(page.locator("#decision-count")).to_have_text("1")
                expect(page.locator("#error")).to_contain_text("была убрана")
                expect(page.locator('[data-toggle="M1"]')).to_have_attribute("aria-pressed", "true")
                # Изменение версии данных сбрасывает результаты, но сохраняет валидный выбор.
                page.locator("#reference").click()
                page.locator("#simulate").click()
                expect(page.locator("#verdict")).to_contain_text("Тестовый анализ")
                page.locator("#save-A").click()
                page.evaluate("""() => {
                    const key='akim-selection-v1', saved=JSON.parse(localStorage.getItem(key));
                    saved.dataset='old-dataset'; localStorage.setItem(key,JSON.stringify(saved));
                }""")
                page.reload()
                expect(page.locator("#storage-status")).to_contain_text("Данные модели изменились")
                expect(page.locator("#score")).to_have_text("52.56")
                expect(page.locator("#decision-count")).to_have_text("5")
                expect(page.locator("#export-scenarios")).to_be_disabled()
                page.locator("#delete-saved").click()
                assert page.evaluate("localStorage.getItem('akim-selection-v1')") is None
                page.reload()
                expect(page.locator("#decision-count")).to_have_text("0")
                expect(page.locator("#score")).to_have_text("52.56")
                # Отключённый localStorage не должен мешать загрузке и выбору.
                page.add_init_script("Storage.prototype.getItem=()=>{throw new Error('blocked')}; Storage.prototype.setItem=()=>{throw new Error('blocked')};")
                page.reload()
                expect(page.locator(".measure")).to_have_count(14)
                page.locator('[data-toggle="M1"]').click()
                expect(page.locator("#decision-count")).to_have_text("1")
                assert not errors, errors
                browser.close()
                print("Browser checks passed: data, validation, calculation, AI retry, safe text, PDF report, export invalidation, mobile, selection persistence and recovery.")
        finally:
            server.should_exit = True
            thread.join(timeout=5)


if __name__ == "__main__":
    run()
