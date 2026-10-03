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

## דרישות

- Node.js >= 22.5 (נדרש עבור `node:sqlite` המובנה, בו משתמש `packages/server`)

## הרצת כל הבדיקות

```bash
npm test
```

## סטטוס

ליבת הדומיין (ארבע החבילות הנ"ל) מיושמת ונבדקת. שכבת ה-HTTP/WebSocket, ה-PWA לטלפון, ומסך המנהל (Electron) עדיין לא נבנו — ראו "מצב נוכחי של הקוד" ו"פריטים פתוחים" ב-`PROJECT-DESIGN.md`.
