"""Математика городского симулятора без внешних зависимостей.

simulate([{"id": "M7", "district": "Нура"}, ...]) возвращает JSON-совместимый
словарь. Для городской меры district следует опустить или передать None.
Ошибки входа: ValidationError; подробности доступны в exception.errors.
Дельты считаются относительно исходного города, округление оставлено фронтенду.
"""

from collections import Counter
from collections.abc import Mapping
from math import fsum


WEIGHTS = dict(zip(
    ("T1", "T2", "E1", "E2", "S1", "S2", "B1", "B2", "C1", "C2"),
    (0.10, 0.10, 0.09, 0.11, 0.11, 0.11, 0.09, 0.09, 0.10, 0.10),
))
POPULATION = {"Есиль": 0.27, "Алматы": 0.24, "Сарыарка": 0.20,
              "Байконур": 0.13, "Нура": 0.16}
INITIAL = {
    name: dict(zip(WEIGHTS, values))
    for name, values in {
        "Есиль": (45, 62, 68, 72, 48, 55, 78, 60, 75, 70),
        "Алматы": (40, 75, 50, 55, 60, 65, 62, 52, 50, 60),
        "Сарыарка": (50, 70, 42, 40, 62, 68, 58, 55, 45, 55),
        "Байконур": (52, 68, 55, 50, 58, 60, 52, 58, 55, 58),
        "Нура": (55, 40, 45, 65, 38, 35, 55, 50, 60, 50),
    }.items()
}


def _measure(direction, scope, cost, lag, **effects):
    return dict(direction=direction, scope=scope, cost=cost, lag=lag,
                effects=effects)


MEASURES = {
    "M1": _measure("Транспорт", "Район", 18, 2, T1=6, T2=9),
    "M2": _measure("Транспорт", "Город", 22, 2, T1=4, B2=3),
    "M3": _measure("Транспорт", "Район", 30, 4, T1=16, T2=20, E2=4),
    "M4": _measure("Экология", "Район", 15, 2, E1=12, E2=3, B1=2),
    "M5": _measure("Экология", "Район", 25, 3, E2=14, C1=4),
    "M6": _measure("Экология", "Город", 20, 4, E1=5, E2=3),
    "M7": _measure("Соцсфера", "Район", 24, 3, S1=16),
    "M8": _measure("Соцсфера", "Район", 20, 3, S2=14),
    "M9": _measure("Соцсфера", "Район", 10, 1, S1=3, S2=3, B1=3),
    "M10": _measure("Безопасность", "Район", 12, 1, B1=12, B2=2),
    "M11": _measure("Безопасность", "Район", 10, 1, B2=12, T1=-2),
    "M12": _measure("Сервисы", "Город", 14, 1, C2=5),
    "M13": _measure("Сервисы", "Район", 28, 4, C1=18, E2=2),
    "M14": _measure("Сервисы", "Город", 16, 1, C1=5, C2=2),
}
SYNERGIES = (("M1", "M2", "T1", 2), ("M10", "M12", "B1", 2),
             ("M5", "M6", "E2", 2))


class ValidationError(ValueError):
    """errors — список словарей с полями code и message для фронтенда."""

    def __init__(self, errors):
        self.errors = errors
        super().__init__("; ".join(error["message"] for error in errors))


def _validate(selected_measures):
    errors = []

    def error(code, message):
        errors.append(dict(code=code, message=message))

    if not isinstance(selected_measures, (list, tuple)):
        raise ValidationError([dict(code="input_type", message="Ожидается список решений.")])
    if len(selected_measures) != 5:
        error("count", "Требуется ровно 5 решений.")

    selected = []
    for index, item in enumerate(selected_measures):
        if not isinstance(item, Mapping):
            error("item_type", f"Решение {index + 1}: ожидается объект с id и district.")
            continue
        measure_id = item.get("id")
        # Поддерживаются латинская M и кириллическая М из условия.
        if isinstance(measure_id, str):
            measure_id = measure_id.replace("М", "M")
        if not isinstance(measure_id, str) or measure_id not in MEASURES:
            error("unknown_measure", f"Решение {index + 1}: неизвестная мера.")
            continue
        district = item.get("district")
        if MEASURES[measure_id]["scope"] == "Район":
            if not isinstance(district, str) or district not in INITIAL:
                error("district", f"{measure_id}: требуется существующий район.")
                continue
        elif district is not None:
            error("city_district", f"{measure_id}: для городской меры район не указывается.")
            continue
        selected.append(dict(id=measure_id, district=district))

    ids = [item["id"] for item in selected]
    if len(set(ids)) != len(ids):
        error("duplicate", "Каждая мера может использоваться только один раз.")
    cost = sum(MEASURES[mid]["cost"] for mid in ids)
    if cost > 100:
        error("budget", f"Стоимость {cost} превышает бюджет 100.")
    counts = Counter(MEASURES[mid]["direction"] for mid in ids)
    for direction, count in counts.items():
        if count > 2:
            error("direction_limit", f"{direction}: допускается не более 2 мер.")
    by_id = {item["id"]: item["district"] for item in selected}
    if "M1" in by_id and "M3" in by_id:
        error("incompatible", "M1 и M3 несовместимы.")
    for first, second in (("M4", "M7"), ("M5", "M13")):
        if first in by_id and second in by_id and by_id[first] == by_id[second]:
            error("incompatible_district", f"{first} и {second} нельзя применять в одном районе.")
    if errors:
        raise ValidationError(errors)
    return selected, cost


def _metrics(indicators):
    district_scores = {
        district: fsum(WEIGHTS[key] * value for key, value in values.items())
        for district, values in indicators.items()
    }
    average = fsum(POPULATION[d] * score for d, score in district_scores.items())
    minimum = min(district_scores.values())
    critical = sum(value < 40 for values in indicators.values() for value in values.values())
    return dict(score=0.7 * average + 0.3 * minimum - critical,
                d_avg=average, d_min=minimum, n_crit=critical), district_scores


def baseline_metrics():
    """Исходные индексы города для API и интерфейса."""
    summary, districts = _metrics(INITIAL)
    return dict(summary=summary, districts=districts)


def simulate(selected_measures):
    """Проверить 5 решений и рассчитать город после 8 кварталов.

    Результат: score, baseline, summary, deltas, budget, selected_measures,
    districts и synergies. districts содержит исходные/итоговые показатели,
    их дельты, индексы района и список критических показателей.
    При невалидном наборе выбрасывается ValidationError, расчёт не выполняется.
    """
    selected, cost = _validate(selected_measures)
    values = {district: indicators.copy() for district, indicators in INITIAL.items()}
    applied = []
    for item in selected:
        measure = MEASURES[item["id"]]
        factor = (8 - measure["lag"]) / 8
        effects = {key: effect * factor for key, effect in measure["effects"].items()}
        targets = [item["district"]] if measure["scope"] == "Район" else list(INITIAL)
        for district in targets:
            for key, effect in effects.items():
                values[district][key] += effect
        applied.append(dict(**item, direction=measure["direction"], scope=measure["scope"],
                            cost=measure["cost"], lag=measure["lag"], factor=factor,
                            realized_effects=effects, target_districts=targets))

    by_id = {item["id"]: item["district"] for item in selected}
    synergies = []
    for first, second, key, bonus in SYNERGIES:
        if first in by_id and second in by_id:
            district = by_id[first]
            values[district][key] += bonus
            synergies.append(dict(measures=[first, second], district=district,
                                  effects={key: bonus}))

    # Ограничение применяется после суммирования всех эффектов и синергий.
    values = {d: {k: min(100, max(0, v)) for k, v in row.items()}
              for d, row in values.items()}
    baseline, initial_scores = _metrics(INITIAL)
    summary, final_scores = _metrics(values)
    districts = {
        d: dict(population_share=POPULATION[d], initial=INITIAL[d].copy(),
                indicators=values[d],
                deltas={k: values[d][k] - INITIAL[d][k] for k in WEIGHTS},
                d_initial=initial_scores[d], d_final=final_scores[d],
                d_delta=final_scores[d] - initial_scores[d],
                critical_indicators=[k for k, v in values[d].items() if v < 40])
        for d in INITIAL
    }
    return dict(valid=True, score=summary["score"], baseline=baseline, summary=summary,
                deltas={key: summary[key] - baseline[key] for key in summary},
                budget=dict(limit=100, spent=cost, remaining=100 - cost),
                selected_measures=applied, districts=districts, synergies=synergies)


def improve(selected_measures):
    """Лучший допустимый сосед: заменить ровно одно решение (меру и/или район).

    Полный перебор соседей, а не поиск глобального оптимума. При равном Score
    предпочитается меньшая стоимость, затем лексикографический порядок решений.
    """
    selected, _ = _validate(selected_measures)
    selected = sorted(selected, key=lambda m: m["id"])
    current = simulate(selected)
    best = None
    checked = 0
    for index, old in enumerate(selected):
        other_ids = {m["id"] for i, m in enumerate(selected) if i != index}
        for mid, measure in MEASURES.items():
            if mid in other_ids:
                continue
            targets = list(INITIAL) if measure["scope"] == "Район" else [None]
            for district in targets:
                replacement = dict(id=mid, district=district)
                if replacement == old:
                    continue
                candidate = selected.copy()
                candidate[index] = replacement
                try:
                    result = simulate(candidate)
                except ValidationError:
                    continue
                checked += 1
                if result["score"] <= current["score"] + 1e-9:
                    continue
                key = (-result["score"], result["budget"]["spent"],
                       tuple(sorted((m["id"], m["district"] or "") for m in candidate)))
                if best is None or key < best[0]:
                    best = (key, result, old, replacement)
    return dict(current=current, candidate=best[1] if best else None,
                removed=best[2] if best else None, added=best[3] if best else None,
                checked=checked)


if __name__ == "__main__":
    import json

    reference = [{"id": "M7", "district": "Нура"},
                 {"id": "M8", "district": "Нура"},
                 {"id": "M10", "district": "Нура"},
                 {"id": "M12"}, {"id": "M5", "district": "Сарыарка"}]
    print(json.dumps(simulate(reference), ensure_ascii=False, indent=2))
