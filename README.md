# NewBridgemateApp

מערכת ניהול טורנירי ברידג' עם הזנת תוצאות בטלפונים — תחליף תוכנתי ל-Bridgemate.
ראו [`PROJECT-DESIGN.md`](./PROJECT-DESIGN.md) לתכנון המלא (ארכיטקטורה, היררכיית הרשאות, מצב כל חבילה).

## חבילות

| חבילה | תיאור | בדיקות |
|---|---|---|
| `packages/movement` | מנוע תנועות Mitchell (כולל זוג פנטום), Howell | `npm run test:movement` |
| `packages/scoring` | מנוע ניקוד חוזים + מטצ'פוינטס + דירוג | `npm run test:scoring` |
| `packages/shared` | טיפוסים ו-DTOs משותפים בין השרת ללקוחות | `npm run test:shared` |
| `packages/server` | שכבת הדומיין: DB (SQLite), אירועים, תוצאות, הרשאות/נעילה, דירוג | `npm run test:server` |
| `packages/api` | שרת HTTP + WebSocket (ללא פריימוורק חיצוני) מעל `server` ו-`shared` | `npm run test:api` |

## הרצת השרת

```bash
cd packages/api
PORT=8080 DB_PATH=./bridge.sqlite npm start
```

נפתח על `http://0.0.0.0:8080`. נקודות קצה לטלפון השולחן תחת `/api/t/:tableToken/...`, למנהל תחת `/api/events/...`, ו-WebSocket לעדכונים חיים ב-`/ws/:eventId`.

## דרישות

- Node.js >= 22.5 (נדרש עבור `node:sqlite` המובנה, בו משתמש `packages/server`)

## הרצת כל הבדיקות

```bash
npm test
```

## סטטוס

ליבת הדומיין וחשיפתה כשרת HTTP/WebSocket (חמש החבילות הנ"ל) מיושמות ונבדקות. ה-PWA לטלפון, מסך המנהל, ואימות מנהל (PIN) עדיין לא נבנו — ראו "מצב נוכחי של הקוד" ו"פריטים פתוחים" ב-`PROJECT-DESIGN.md`. שימו לב: נקודות הקצה של המנהל ב-`packages/api` כרגע ללא אימות (כל מי שמגיע לכתובת השרת יכול לפעול כמנהל) — זה מתוכנן להיסגר לפני פיילוט אמיתי.
