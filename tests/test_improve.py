import copy
import unittest

from fastapi.testclient import TestClient

from backend.engine import ValidationError, improve, simulate
from backend.main import app
from tests.test_engine import REFERENCE


class ImprovementTests(unittest.TestCase):
    def test_improvement_is_valid_and_changes_one_decision(self):
        selected = copy.deepcopy(REFERENCE)
        selected[0]["district"] = "Сарыарка"
        before = copy.deepcopy(selected)
        found = improve(selected)
        candidate = found["candidate"]
        self.assertIsNotNone(candidate)
        self.assertGreaterEqual(candidate["score"], 56.54307 - 1e-9)
        self.assertGreater(candidate["score"], found["current"]["score"])
        minimal = [dict(id=m["id"], district=m["district"]) for m in candidate["selected_measures"]]
        self.assertAlmostEqual(simulate(minimal)["score"], candidate["score"])
        old = {(m["id"], m.get("district")) for m in selected}
        new = {(m["id"], m.get("district")) for m in minimal}
        self.assertEqual(len(old & new), 4)
        self.assertLessEqual(candidate["budget"]["spent"], 100)
        self.assertEqual(selected, before)
        self.assertEqual(found, improve(list(reversed(selected))))

    def test_local_optimum_does_not_claim_global_optimum(self):
        selected = REFERENCE
        for _ in range(30):
            result = improve(selected)
            if result["candidate"] is None:
                self.assertGreater(result["checked"], 0)
                self.assertIsNone(result["added"])
                break
            selected = [dict(id=m["id"], district=m["district"])
                        for m in result["candidate"]["selected_measures"]]
        else:
            self.fail("Expected convergence for reference fixture")

    def test_api_and_breakdown(self):
        with TestClient(app) as client:
            response = client.post("/api/improve", json={"selected_measures": REFERENCE})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["scope"], "one_decision")
            data = client.post("/api/simulate", json=REFERENCE).json()
            self.assertAlmostEqual(sum(data["score_breakdown"].values()), data["score_delta"])
            self.assertEqual(data["score_breakdown"]["critical"], 2)
            self.assertEqual(client.post("/api/improve", json={"selected_measures": REFERENCE[:4]}).status_code, 422)
        with self.assertRaises(ValidationError):
            improve([REFERENCE[0]] * 5)


if __name__ == "__main__":
    unittest.main()
