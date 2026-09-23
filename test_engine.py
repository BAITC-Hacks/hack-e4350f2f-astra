import copy
import json
import unittest

from engine import INITIAL, ValidationError, simulate


REFERENCE = [dict(id="M7", district="Нура"), dict(id="M8", district="Нура"),
             dict(id="M10", district="Нура"), dict(id="M12"),
             dict(id="M5", district="Сарыарка")]


class SimulationTests(unittest.TestCase):
    def test_reference(self):
        result = simulate(REFERENCE)
        self.assertAlmostEqual(result["score"], 56.5, delta=0.05)
        self.assertEqual(result["budget"]["spent"], 95)
        self.assertEqual(result["summary"]["n_crit"], 0)
        nura = result["districts"]["Нура"]
        self.assertEqual(nura["indicators"]["S1"], 48)
        self.assertEqual(nura["indicators"]["S2"], 43.75)
        self.assertEqual(nura["deltas"]["B1"], 12.5)
        self.assertEqual(nura["indicators"]["T2"], 40)
        self.assertEqual(result["districts"]["Сарыарка"]["deltas"]["E2"], 8.75)
        for district in result["districts"].values():
            self.assertEqual(district["deltas"]["C2"], 4.375)
        self.assertAlmostEqual(result["deltas"]["score"],
                               result["score"] - result["baseline"]["score"])
        json.dumps(result, allow_nan=False)

    def test_synergies_and_negative_effect(self):
        result = simulate([dict(id="M1", district="Нура"), dict(id="M2"),
                           dict(id="M10", district="Нура"), dict(id="M12"),
                           dict(id="M11", district="Есиль")])
        self.assertEqual(result["districts"]["Нура"]["deltas"]["T1"], 9.5)
        self.assertEqual(result["districts"]["Есиль"]["deltas"]["T1"], 1.25)
        self.assertEqual(result["districts"]["Нура"]["deltas"]["B1"], 12.5)
        self.assertEqual(result["summary"]["n_crit"], 2)
        result = simulate([dict(id="M5", district="Нура"), dict(id="M6"),
                           dict(id="M9", district="Алматы"), dict(id="M12"),
                           dict(id="M14")])
        self.assertEqual(result["districts"]["Нура"]["deltas"]["E2"], 12.25)
        self.assertEqual(result["districts"]["Алматы"]["deltas"]["E2"], 1.5)

    def test_validation(self):
        cases = [
            (None, "input_type"), (REFERENCE[:4], "count"),
            ([None] + REFERENCE[1:], "item_type"),
            ([dict(id=[])] + REFERENCE[1:], "unknown_measure"),
            ([dict(id="M7", district=[])] + REFERENCE[1:], "district"),
            ([dict(id="M7")] + REFERENCE[1:], "district"),
            (REFERENCE[:3] + [dict(id="M12", district="Нура")] + REFERENCE[4:], "city_district"),
            (REFERENCE[:4] + [REFERENCE[0]], "duplicate"),
            (REFERENCE[:3] + [dict(id="M13", district="Есиль")] + REFERENCE[4:], "budget"),
            (REFERENCE[:4] + [dict(id="M9", district="Есиль")], "direction_limit"),
            ([dict(id="M1", district="Нура"), dict(id="M3", district="Есиль"),
              dict(id="M9", district="Нура"), dict(id="M10", district="Нура"), dict(id="M12")], "incompatible"),
        ]
        for first, second in (("M4", "M7"), ("M5", "M13")):
            cases.append(([dict(id=first, district="Нура"), dict(id=second, district="Нура"),
                           dict(id="M9", district="Есиль"), dict(id="M10", district="Есиль"),
                           dict(id="M12")], "incompatible_district"))
        for selection, code in cases:
            with self.subTest(code=code, selection=selection):
                with self.assertRaises(ValidationError) as caught:
                    simulate(selection)
                self.assertIn(code, [error["code"] for error in caught.exception.errors])

    def test_independence_order_and_aliases(self):
        original = copy.deepcopy(REFERENCE)
        initial = copy.deepcopy(INITIAL)
        result = simulate(REFERENCE)
        self.assertEqual(result["score"], simulate(list(reversed(REFERENCE)))["score"])
        alias = copy.deepcopy(REFERENCE)
        alias[0]["id"] = "М7"
        self.assertEqual(result, simulate(alias))
        result["districts"]["Нура"]["initial"]["S1"] = 0
        self.assertEqual(INITIAL, initial)
        self.assertEqual(REFERENCE, original)
        self.assertEqual(simulate(REFERENCE), simulate(REFERENCE))


if __name__ == "__main__":
    unittest.main()
