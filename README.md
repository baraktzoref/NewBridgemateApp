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
| `packages/pwa` | ה-PWA של טלפון השולחן (Vanilla JS, ללא build step) — נגיש מאותו שרת של `packages/api` ב-`/` | `npm run test:pwa` (יוניט), `npm run test:pwa:e2e` (דפדפן אמיתי) |
| `packages/director-app` | מסך המנהל (Vanilla JS, ללא build step) — נגיש מאותו שרת ב-`/director` | `npm run test:director-app` (יוניט), `npm run test:director-app:e2e` (דפדפן אמיתי) |

## הרצת השרת

```bash
cd packages/api
PORT=8080 DB_PATH=./bridge.sqlite npm start
```

נפתח על `http://0.0.0.0:8080`. נקודות קצה לטלפון השולחן תחת `/api/t/:tableToken/...`, למנהל תחת `/api/events/...`, ו-WebSocket לעדכונים חיים ב-`/ws/:eventId`.

### אימות מנהל (PIN)

`POST /api/events` מחזיר, חד-פעמית, `directorPin` (6 ספרות) — זה חייב להישמר/להימסר למנהל, הוא לא נשמר בשרת כטקסט פתוח ולא ניתן לשחזור. כל נקודת קצה שמשנה מצב בצד המנהל (קידום סבב, נעילה/שחרור שולחן, ניתוק מכשיר, עריכה/Override של תוצאה) דורשת כותרת `X-Director-Token`, שמתקבלת מ:

```bash
curl -X POST http://localhost:8080/api/events/<eventId>/director-login -d '{"pin":"123456"}' -H 'content-type: application/json'
# -> { "directorToken": "...", "eventId": "..." }
```

הטוקן תקף לאותו `eventId` בלבד (לא ניתן לשימוש על אירוע אחר), מתחדש בכל קריאה מאומתת, ופג כעבור 12 שעות חוסר פעילות. `POST /api/events/:eventId/director-logout` מבטל אותו מוקדם. קריאות קריאה (`GET /api/events/:eventId`, `GET .../standings`) נשארות פתוחות ללא אימות, לצפייה חיה.

אותו שרת מגיש גם שתי אפליקציות סטטיות, לפי נתיב:
- כל כתובת שאינה `/api/...`, `/ws/...` או `/director...` — ה-PWA של טלפון השולחן (`packages/pwa/public`). כניסה: `http://<כתובת-השרת>:8080/t/<tableToken>` (ה-token הקבוע שמקודד בברקוד של השולחן).
- `/director` (וכל מה שתחתיו) — מסך המנהל (`packages/director-app/public`). כניסה: `http://<כתובת-השרת>:8080/director`, ואז התחברות עם `eventId` + ה-PIN. מסך המנהל קורא ל-`GET /api/events/:eventId/overview` (גם הוא דורש `X-Director-Token`) לקבלת מצב כל השולחנות — נעילה, מכשיר מחובר, זיהוי NS/EW, ותוצאות שהוזנו/אושרו — ומאפשר נעילה/שחרור, ניתוק מכשיר, עריכת/Override תוצאה, וקידום סבב, עם עדכונים חיים דרך `/ws/:eventId` (כולל קריאות "call-director" מהשולחנות).

שני השרתים הסטטיים חולקים origin אחד עם ה-API (בלי בעיות CORS), בהתאם לארכיטקטורה ב-`PROJECT-DESIGN.md`.

### בדיקות E2E (דפדפן אמיתי)

`npm run test:pwa:e2e` ו-`npm run test:director-app:e2e` מריצים Playwright מול Chromium מותקן-מראש (`/opt/pw-browsers`), נגד שרת `packages/api` אמיתי. מכיוון שאין גישה ל-npm registry בסביבת הפיתוח, חבילת ה-Node של Playwright אינה ניתנת להתקנה רגילה; `packages/pwa/node_modules/playwright` ו-`packages/director-app/node_modules/playwright` (ו-`playwright-core`) הם סימלינקים להתקנה הגלובלית הקיימת בסביבה (`/opt/npm-tools/node_modules`). בסביבה חדשה בלי אותם נתיבים, יש להתקין `playwright`/`playwright-core` כרגיל (`npm install`) או לעדכן את הסימלינקים בהתאם.

## פיילוט על מחשב Windows

להרצת ערב אמיתי במועדון, עם מחשב Windows אחד ושולחנות שמתחברים דרך
WiFi מהטלפונים — ראו [`README-WINDOWS.md`](./README-WINDOWS.md). כולל
סקריפטי `.bat` תחת `windows/` (`install.bat`, `start-server.bat`,
`create-event.bat`) ו-`scripts/create-event.mjs`, שיוצר אירוע מול
שרת רץ ומפיק גיליון הדפסה עם כתובת לכל שולחן, קוד האירוע וה-PIN
החד-פעמי של המנהל.

## דרישות

- Node.js >= 22.5 (נדרש עבור `node:sqlite` המובנה, בו משתמש `packages/server`)

## הרצת כל הבדיקות

```bash
npm test
```

## סטטוס

כל שבע החבילות — ליבת הדומיין, חשיפתה כשרת HTTP/WebSocket (כולל אימות מנהל ע"י PIN), ה-PWA של טלפון השולחן, ומסך המנהל — מיושמות ונבדקות, כולל בדיקות קצה-לקצה בדפדפן אמיתי לשני הצדדים (טלפון שולחן ומסך מנהל). ראו "מצב נוכחי של הקוד" ו"פריטים פתוחים" ב-`PROJECT-DESIGN.md` למה שעדיין חסר (סימולטור, Howell, חצי-שולחן, ועוד).
