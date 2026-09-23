import unittest

from fastapi.testclient import TestClient

from main import app
from test_engine import REFERENCE


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def test_data(self):
        response = self.client.get("/api/data")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["measures"]), 14)
        self.assertEqual(len(data["districts"]), 5)
        self.assertEqual(data["districts"]["Нура"]["indicators"]["S1"], 38)
        self.assertEqual(data["rules"]["required_measures"], 5)
        self.assertEqual(len(data["rules"]["synergies"]), 3)

    def test_reference_both_body_formats(self):
        for payload in (REFERENCE, {"selected_measures": REFERENCE}):
            with self.subTest(payload=payload):
                response = self.client.post("/api/simulate", json=payload)
                self.assertEqual(response.status_code, 200)
                data = response.json()
                self.assertEqual(data["status"], "ok")
                self.assertAlmostEqual(data["score_before"], 52.55768)
                self.assertAlmostEqual(data["score_after"], 56.54307)
                self.assertAlmostEqual(data["score_delta"], 3.98539)
                nura = data["districts"]["Нура"]
                self.assertEqual(nura["before"]["S1"], 38)
                self.assertEqual(nura["after"]["S1"], 48)
                self.assertEqual(nura["critical_before"], {"S1": 38, "S2": 35})
                self.assertEqual(nura["critical_after"], {})

    def test_validation_errors(self):
        for payload in ([], {}, [42], [{"id": "M99"}] + REFERENCE[1:],
                        [{"id": "M7"}] + REFERENCE[1:]):
            with self.subTest(payload=payload):
                response = self.client.post("/api/simulate", json=payload)
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.json()["status"], "error")
                self.assertTrue(response.json()["error"])
                self.assertTrue(response.json()["errors"])
        response = self.client.post("/api/simulate", content="{broken",
                                    headers={"Content-Type": "application/json"})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["status"], "error")

    def test_cors(self):
        for origin in ("http://localhost:3000", "http://localhost:5173",
                       "http://127.0.0.1:8080", "http://[::1]:5173"):
            with self.subTest(origin=origin):
                headers = {"Origin": origin, "Access-Control-Request-Method": "POST",
                           "Access-Control-Request-Headers": "content-type"}
                response = self.client.options("/api/simulate", headers=headers)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["access-control-allow-origin"], origin)
                response = self.client.post("/api/simulate", json=[], headers={"Origin": origin})
                self.assertEqual(response.headers["access-control-allow-origin"], origin)
        response = self.client.get("/api/data", headers={"Origin": "http://localhost.example.com:3000"})
        self.assertNotIn("access-control-allow-origin", response.headers)


if __name__ == "__main__":
    unittest.main()
