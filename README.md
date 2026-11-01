# Map Trip Planner

地圖式行程規劃與交通紀錄系統。直接在地圖上點選建立地點、拖曳修正位置、依日期排序，並為「兩個地點之間的路段」記錄交通方式、時間、費用與備註。以 Docker Compose 自架，資料存在 PostgreSQL named volume 中。

規格書：[docs/SPEC.md](docs/SPEC.md)　示範資料：[docs/demo-tokyo-trip.json](docs/demo-tokyo-trip.json)

```
Browser ──> web (Nginx + React 靜態檔, :8080) ──/api/v1──> api (FastAPI) ──> db (PostgreSQL + volume)
```

- `web` 是唯一對外的服務；`api` 與 `db` 沒有對外 port，`db` 位於 `internal` 網路。

---

## 1. 首次部署

需求：Linux 主機、Docker Engine、Docker Compose plugin。

```bash
cp .env.example .env
# 編輯 .env：至少修改 POSTGRES_PASSWORD 與 SECRET_KEY
#   SECRET_KEY 可用：openssl rand -hex 32
docker compose up -d --build
docker compose ps        # 三個服務都應為 healthy
```

開啟 `http://<主機IP>:8080`：

- 若 `.env` 中 **沒有** 設定 `ADMIN_USERNAME` / `ADMIN_PASSWORD`，首次開啟會出現「初始設定」畫面，建立管理者帳號（只能建立一次）。
- 若有設定，系統在第一次啟動且資料庫內沒有使用者時自動建立該帳號。之後修改這兩個值不會改動既有帳號。

匯入示範資料：登入後在「我的專案」對話框按「從 JSON 備份匯入…」，選擇 `docs/demo-tokyo-trip.json`。

## 2. 日常操作

```bash
docker compose ps                 # 服務狀態
docker compose logs -f            # 全部日誌（或 logs -f api）
docker compose down               # 安全停止（保留資料 volume）
docker compose up -d              # 重新啟動
```

> ⚠️ **不要**用 `docker compose down -v` 當作一般關閉指令。`-v` 會刪除 named volume（也就是整個資料庫），若沒有另外備份資料會永久遺失。

### 更新版本

```bash
git pull
docker compose up -d --build      # api 啟動時會自動執行 alembic upgrade head
```

建議更新前先依下方步驟做一次資料庫備份。

## 3. 備份與還原

### 3.1 完整資料庫備份（建議定期執行）

```bash
mkdir -p backups
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backups/trip-$(date +%F).dump
```

還原（會覆蓋現有資料）：

```bash
docker compose stop api web
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < backups/trip-2026-11-01.dump
docker compose start api web
```

可以用 cron 排程，例如每天 03:00：

```cron
0 3 * * * cd /opt/map-trip-planner && docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backups/trip-$(date +\%F).dump
```

> 目前版本沒有附件檔案；未來加入照片／附件時，完整備份必須同時包含附件存放的 volume。

### 3.2 專案 JSON 匯出／匯入

- 匯出：開啟專案 → 頂部「匯出」，下載 `專案名稱-日期.json`。
- 匯入：「我的專案」→「從 JSON 備份匯入…」。匯入一律 **建立新專案**（重新產生所有 ID），不會覆蓋既有專案。
- 匯入時會驗證格式識別、版本、欄位範圍（座標、時間、網址、幣別…）與參照完整性（地點 → 日期、路段 → 地點／日期），任何錯誤都不會留下半套資料。

JSON 匯出只包含單一專案，**不等於** 系統全量備份，請搭配 3.1 使用。

## 4. 設定（.env）

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `WEB_PORT` | `8080` | 對外 port |
| `WEB_BIND` | `0.0.0.0` | 改成 `127.0.0.1` 只允許本機（例如前面還有 HTTPS 反向代理） |
| `POSTGRES_DB` / `POSTGRES_USER` | `trip` | 資料庫名稱／帳號 |
| `POSTGRES_PASSWORD` | **必填** | 資料庫密碼 |
| `SECRET_KEY` | **必填** | Session 簽章金鑰；變更後所有人需重新登入 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 空 | 初始管理者（僅在沒有任何使用者時使用） |
| `COOKIE_SECURE` | `false` | 透過 HTTPS 提供服務時設為 `true` |
| `TZ` / `DEFAULT_TIMEZONE` | `Asia/Taipei` | 容器時區／新專案預設時區 |
| `TILE_URL` / `TILE_ATTRIBUTION` / `TILE_MAX_ZOOM` | OSM | 地圖底圖來源與版權標示 |
| `ENABLE_DOCS` | `true` | 是否開放 `/api/v1/docs`（OpenAPI） |
| `GOOGLE_MAPS_API_KEY` | 空 | 選填。Google Places API (New) 金鑰，用於從 Google 地圖連結帶入地址／電話／網站／營業時間 |
| `GOOGLE_PLACES_LANGUAGE` | `zh-TW` | Places 回傳資料的語言 |

### 地圖底圖

預設使用 OpenStreetMap 官方圖磚，**僅適合個人、低流量使用**，須遵守 [OSM Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/)。公開或高流量部署請改用商業或自架圖磚服務，只要修改 `.env`：

```ini
TILE_URL=https://{s}.tile.example.com/{z}/{x}/{y}.png?key=XXXX
TILE_ATTRIBUTION='&copy; Example Maps &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
```

改完執行 `docker compose up -d` 即可（不需重建）。地點名稱與備註不會傳給地圖服務。

## 5. 對外公開時

- 前面放 HTTPS 反向代理（Caddy、Traefik、Nginx + certbot 等），並設定 `COOKIE_SECURE=true`、`WEB_BIND=127.0.0.1`。
- 主機防火牆只開放 80/443；`api`、`db` 本來就沒有對外 port。
- 視需要設定 `ENABLE_DOCS=false` 關閉 API 文件。

## 6. 使用說明

| 操作 | 方法 |
| --- | --- |
| 新增地點 | 「＋ 新增地點」→ 點地圖 → 填名稱 → 儲存（取消則移除暫存標記；Esc 可離開新增模式） |
| 從 Google 地圖新增 | 在 Google 地圖 App／網頁開啟地點 →「分享」→ 複製連結 → 貼到左側「從 Google 地圖連結新增」→ 地圖自動定位並帶入資料，確認後儲存 |
| 修正位置 | 直接拖曳地圖標記（放開即儲存），或在詳情面板輸入經緯度 |
| 加入日期 | 新增地點時選擇日期，或在地點詳情改「日期」；頂部日期篩選選定某天時，新地點預設加入該天 |
| 排序 | 左側清單用 ⋮⋮ 把手拖曳（同一天內） |
| 記錄交通 | 點地圖上的連線或清單中的「↓ …」；虛線表示尚未設定交通方式 |
| 顯示／隱藏 | 清單各日期旁「隱藏」，或頂部日期篩選 |
| 專案預設檢視 | 「⚙ 設定」→「以目前地圖位置作為預設」 |

手機版：☰ 開啟清單抽屜，詳情以底部面板顯示；觸控裝置上標記需先點選才可拖曳，避免與拖曳地圖互相干擾。

地圖上的連線是兩點間的 **示意直線**，不代表實際道路或軌道路線；時間與費用皆為人工輸入。

### Google 地圖連結

支援 `maps.app.goo.gl/…` 短網址、`google.com/maps/place/…`、`google.com/maps?q=緯度,經度`、`/maps/search/?api=1&query=…`、`/maps/@緯度,經度,…z` 等格式（含 google.com.tw、google.co.jp 等網域）；分享時一併複製的說明文字會自動略過。

| 未設定 API 金鑰 | 已設定 `GOOGLE_MAPS_API_KEY` |
| --- | --- |
| 從網址解析 **名稱、座標**，原始連結存入「參考網址」 | 另外以 Places API 帶入 **地址、電話、網站、評分、營業時間**（寫入地址與備註欄） |
| 連結沒有座標時（部分手機分享連結只有名稱＋地址），帶入名稱與地址，再請你在地圖上點選位置 | 沒有座標的連結也能自動定位 |

- 系統只解析網址，不下載或擷取 Google 地圖網頁內容。短網址展開時只跟隨導向 Google 網域的轉址。
- 若座標只能取自連結中的「地圖中心」（`@…` 而非地點標記），表單會提示座標可能略有偏差。
- 取得 API 金鑰：Google Cloud Console → 啟用「Places API (New)」→ 建立 API 金鑰（建議限制只能呼叫 Places API）。每次解析呼叫一次 Text Search，依 Google 計價收費；金鑰只存在伺服器端，不會傳到瀏覽器。
- 使用此功能時，連結（及地點名稱）會由伺服器傳給 Google；行程筆記不會傳出。

### 路段規則

- 同一天中相鄰的地點自動形成路段（A→B、B→C）。路段以 *(日期, 起點, 終點)* 識別，**永遠不會被改指向別的地點組合**。
- 重新排序 A→B→C 成 A→C→B 時，A→C、C→B 是全新的「未設定」路段；原本 A→B、B→C 的紀錄若有內容會被保留為非作用中，順序改回來時自動恢復。
- 刪除地點、把地點移到其他日期或未排程時，涉及該地點的路段會一併刪除，並重建新的相鄰路段。
- 刪除日期時，該日的地點會移到「未排程」，該日的路段刪除。

## 7. 疑難排除

| 症狀 | 檢查 |
| --- | --- |
| `docker compose up` 顯示 `Set POSTGRES_PASSWORD in .env` | 尚未建立 `.env` 或缺少必填值 |
| `api` 一直 unhealthy | `docker compose logs api`；常見為資料庫密碼與既有 volume 不符（volume 建立後改 `POSTGRES_PASSWORD` 不會改到資料庫內的密碼） |
| 地圖空白但標記存在 | 檢查 `TILE_URL`、主機能否連到圖磚服務、瀏覽器 console 是否被阻擋 |
| 登入後立刻被登出 | 用 HTTP 存取卻設定 `COOKIE_SECURE=true`；或 `SECRET_KEY` 被更改 |
| 「登入失敗次數過多」 | 同一 IP 5 分鐘內失敗 10 次，稍候再試或重啟 api |
| 忘記管理者密碼 | 見下方指令 |

重設管理者密碼：

```bash
docker compose exec api python -c "
from app.db import SessionLocal; from app.models import User; from app.security import hash_password
db = SessionLocal(); u = db.query(User).first(); u.password_hash = hash_password('新密碼至少8碼'); db.commit(); print('reset', u.username)"
```

## 8. 開發

```
backend/    FastAPI + SQLAlchemy 2 + Alembic（app/、alembic/、tests/）
frontend/   React 18 + TypeScript + Vite + React Leaflet + Tailwind + dnd-kit + zustand
deploy/     nginx.conf
tests/e2e/  Playwright 端對端測試
docs/       規格書與示範資料
```

### 後端

```bash
cd backend
uv venv && uv pip install -r requirements-dev.txt     # 或 python -m venv .venv && pip install ...
.venv/bin/python -m pytest                             # API 測試（SQLite）
DATABASE_URL=sqlite:///./dev.db .venv/bin/alembic upgrade head
DATABASE_URL=sqlite:///./dev.db SECRET_KEY=dev .venv/bin/uvicorn app.main:app --reload --port 8000
```

API 文件：`http://localhost:8000/api/v1/docs`。修改模型後產生 migration：

```bash
DATABASE_URL=sqlite:///./dev.db .venv/bin/alembic revision --autogenerate -m "describe change"
```

所有寫入 API 都需要 `X-Requested-With: fetch` 標頭（CSRF 防護，搭配 SameSite cookie）。錯誤回應格式一致：

```json
{ "error": { "code": "validation_error", "message": "輸入資料有誤", "fields": { "latitude": "..." } } }
```

### 前端

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173，/api 代理到 :8000
npm test           # vitest：儲存狀態、表單驗證、交通編輯、儲存失敗
npm run build
```

### E2E

```bash
cd tests/e2e
npm install && npx playwright install chromium
BASE_URL=http://localhost:8080 E2E_USER=admin E2E_PASS='你的密碼' npx playwright test
```

測試會建立一個新專案（若系統尚未初始化則用 `E2E_USER`/`E2E_PASS` 完成初始設定），涵蓋：新增地點、交通紀錄、拖曳標記、重新整理後資料一致、重排不串資料、API 斷線時顯示「儲存失敗」並可重試。請對測試環境執行。

AC-06（`docker compose down` / `up -d` 後資料仍在）可手動驗證：

```bash
docker compose down && docker compose up -d
BASE_URL=http://localhost:8080 ... npx playwright test   # 或登入確認專案仍在
```
