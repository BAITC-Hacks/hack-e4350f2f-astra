import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from fastapi.testclient import TestClient
from openai import APIConnectionError, APITimeoutError, RateLimitError

from main import ANALYSIS_SYSTEM_PROMPT, app
from test_engine import REFERENCE


class AnalysisTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.payload = self.client.post("/api/simulate", json=REFERENCE).json()
        env = patch.dict(os.environ, {"OPENAI_API_KEY": "test-key", "OPENAI_MODEL": "test-model"})
        env.start()
        self.addCleanup(env.stop)
        sdk = patch("main.AsyncOpenAI")
        self.factory = sdk.start()
        self.addCleanup(sdk.stop)
        self.provider = self.factory.return_value.__aenter__.return_value
        self.provider.responses.create = AsyncMock(return_value=SimpleNamespace(
            status="completed", output_text="### 🏛 Оценка стратегии акима\nТекст анализа."))

    def test_simulation_to_analysis(self):
        response = self.client.post("/api/analyze", json=self.payload)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")
        self.assertIn("Оценка стратегии", response.json()["analysis"])
        call = self.provider.responses.create.call_args.kwargs
        self.assertEqual(call["instructions"], ANALYSIS_SYSTEM_PROMPT)
        facts = json.loads(call["input"].split("\n", 1)[1])
        self.assertEqual(facts, self.payload)
        self.assertEqual(call["model"], "test-model")
        self.assertFalse(call["store"])
        self.assertNotIn("test-key", call["input"])

    def test_missing_configuration(self):
        for variable in ("OPENAI_API_KEY", "OPENAI_MODEL"):
            with self.subTest(variable=variable), patch.dict(os.environ, {variable: ""}):
                response = self.client.post("/api/analyze", json=self.payload)
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.json()["status"], "error")
        self.factory.assert_not_called()

    def test_invalid_payload(self):
        for field in ("selected_measures",):
            with self.subTest(field=field):
                payload = self.payload.copy()
                del payload[field]
                response = self.client.post("/api/analyze", json=payload)
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.json()["status"], "error")
        self.factory.assert_not_called()

    def test_forged_facts_are_replaced(self):
        self.payload["score_after"] = 9999
        self.payload["budget"]["spent"] = 0
        self.payload["selected_measures"][0]["cost"] = 0
        self.payload["selected_measures"][0]["name"] = "Поддельное название"
        self.payload["indicator_info"] = {"S1": {"label": "Поддельный показатель"}}
        self.payload["districts"] = {}
        response = self.client.post("/api/analyze", json=self.payload)
        self.assertEqual(response.status_code, 200)
        facts = json.loads(self.provider.responses.create.call_args.kwargs["input"].split("\n", 1)[1])
        self.assertAlmostEqual(facts["score_after"], 56.54307)
        self.assertEqual(facts["budget"]["spent"], 95)
        self.assertEqual(len(facts["districts"]), 5)
        self.assertEqual(facts["selected_measures"][0]["name"],
                         "Школа + детсад (модульное строительство)")
        self.assertEqual(facts["indicator_info"]["S1"]["label"], "Школы и детсады")

    def test_selection_only_and_invalid_selection(self):
        response = self.client.post("/api/analyze", json={"selected_measures": REFERENCE})
        self.assertEqual(response.status_code, 200)
        self.provider.responses.create.reset_mock()
        response = self.client.post("/api/analyze", json={"selected_measures": [REFERENCE[0]] * 5})
        self.assertEqual(response.status_code, 422)
        self.provider.responses.create.assert_not_called()

    def test_provider_errors(self):
        request = httpx.Request("POST", "https://api.openai.com/v1/responses")
        cases = [
            (APITimeoutError(request=request), 504),
            (APIConnectionError(request=request), 502),
            (RateLimitError("private-provider-details",
                            response=httpx.Response(429, request=request), body=None), 429),
        ]
        for error, status in cases:
            with self.subTest(status=status):
                self.provider.responses.create.side_effect = error
                response = self.client.post("/api/analyze", json=self.payload)
                self.assertEqual(response.status_code, status)
                self.assertEqual(response.json()["status"], "error")
                self.assertNotIn("private-provider-details", response.text)

    def test_empty_or_incomplete_analysis(self):
        for status, text in (("completed", " "), ("incomplete", "Обрезанный ответ")):
            with self.subTest(status=status):
                self.provider.responses.create.return_value = SimpleNamespace(
                    status=status, output_text=text)
                response = self.client.post("/api/analyze", json=self.payload)
                self.assertEqual(response.status_code, 502)
                self.assertEqual(response.json()["status"], "error")


if __name__ == "__main__":
    unittest.main()
