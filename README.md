# hack-e4350f2f-astra
Hackathon team repository for Astra

## Backend

Из папки проекта (Python 3.10+):

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements-dev.txt
.venv\Scripts\python -m uvicorn main:app --reload
```

API: http://127.0.0.1:8000. Swagger: http://127.0.0.1:8000/docs.
Для запуска без тестов достаточно `requirements.txt`.

- `GET /api/data`: 14 мер, исходные показатели районов, доли населения, веса и правила.
- `POST /api/simulate`: расчёт через `engine.simulate`; пример тела:

```json
{
  "selected_measures": [
    {"id": "M7", "district": "Нура"},
    {"id": "M8", "district": "Нура"},
    {"id": "M10", "district": "Нура"},
    {"id": "M12"},
    {"id": "M5", "district": "Сарыарка"}
  ]
}
```

Можно отправить и сам массив без обёртки `selected_measures`.
Успех: HTTP 200, `status: "ok"`, `score_before`, `score_after`, `score_delta`,
`districts` с показателями `before`/`after`, дельтами и словарями критических
метрик `critical_before`/`critical_after` (значение строго меньше 40).
Эталон: 52.55768 → 56.54307, прирост 3.98539.
Ошибки формата JSON и правил: HTTP 422, `status: "error"`, текст `error` и список `errors`.

CORS разрешает HTTP/HTTPS с `localhost`, `127.0.0.1` и `[::1]` на любом порту,
включая 3000 и 5173.

## Анализ стратегии через OpenAI

`POST /api/analyze` принимает полный успешный JSON-ответ `/api/simulate`,
включая `selected_measures`, `budget`, `score_delta` и `districts`.
Возвращает `{"status": "ok", "analysis": "текст в Markdown"}`.
Системный промпт задан в `ANALYSIS_SYSTEM_PROMPT` в `main.py`.
Числа передаются модели без пересчёта; достоверность присланного клиентом
результата этот эндпоинт не проверяет.

Перед запуском сервера задайте переменные в PowerShell:

```powershell
$env:OPENAI_API_KEY = "ваш API-ключ"
$env:OPENAI_MODEL = "идентификатор доступной вам модели Responses API"
.venv\Scripts\python -m pip install -r requirements-dev.txt
.venv\Scripts\python -m uvicorn main:app --reload
```

Ключ хранится только на сервере. Файлы `.env` автоматически не загружаются.
Без настройки OpenAI остальные эндпоинты работают; `/api/analyze` возвращает 503.
Ошибки анализа имеют `status: "error"` и текст `error`: 422 — формат входа,
429 — квота/лимит OpenAI, 504 — тайм-аут, 502 — ошибка провайдера или неполный ответ.
Запрос ограничен 45 секундами без автоматических повторов.

Пример вызова с фронтенда:

```javascript
const simulation = await fetch("http://127.0.0.1:8000/api/simulate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ selected_measures: selectedMeasures }),
}).then(response => response.json());
if (simulation.status !== "ok") throw new Error(simulation.error);
const analysis = await fetch("http://127.0.0.1:8000/api/analyze", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(simulation),
}).then(response => response.json());
if (analysis.status !== "ok") throw new Error(analysis.error);
console.log(analysis.analysis);
```

Интеграция использует официальный SDK и
[Responses API](https://developers.openai.com/api/docs/guides/text).
Тесты анализа подменяют ответ SDK и не расходуют API-квоту.

Тесты:

```powershell
.venv\Scripts\python -m unittest -v
```
