# Документация по коду и API

Описание структуры проекта, модулей, API-эндпоинтов и используемых секретов/конфигурации.

---

## Структура файлов

### Корень проекта

| Файл / папка | Назначение |
|--------------|------------|
| `package.json` | Имя: `taxes-sender`, скрипт `npm start` → `node server/index.js`, зависимость `sql.js`, Node.js >= 16 |
| `start.bat` | Запуск сервера (подставляет локальную `node\` при наличии, иначе системный Node) |
| `stop.bat` | Остановка процесса сервера (Windows) |
| `restart.bat` | Перезапуск (stop + start) |
| `data/` | Локальные данные: конфиг, ключ шифрования, БД, логи (в `.gitignore`) |

### Сервер (`server/`)

| Файл | Назначение |
|------|------------|
| `index.js` | Точка входа: инициализация БД, миграция из JSON, HTTP-сервер на порту **3847**, раздача статики и обработка API через `handleRequest`. На Windows при старте открывает браузер. |

### Серверные модули (`server/lib/`)

| Модуль | Назначение |
|--------|------------|
| **routes.js** | Маршрутизация: статика, авторизация, конфиг, платежи, чеки, налоговая, опасные операции. Вызывает остальные модули. |
| **config.js** | Загрузка/сохранение конфига из/в зашифрованного файла `data/config.enc`. |
| **encryption.js** | AES-256-CBC: ключ в `data/.key` (создаётся при первом запуске), шифрование/расшифровка конфига. |
| **auth.js** | Авторизация веб-интерфейса: дефолт `admin`/`admin`, хеш пароля (SHA-256 + соль), сессии по cookie `auth_token`, защита от брутфорса (блокировка по IP), смена логина/пароля, сброс к дефолту. |
| **database.js** | SQLite (sql.js): инициализация, создание таблиц (`receipts`, `service_names`, `tax_receipts_cache`, `settings`), сохранение на диск, очистка таблиц. |
| **storage.js** | Работа с БД: услуги, чеки (receipts), кэш чеков из налоговой (tax_receipts_cache), сопоставление с платежами, отметки отправки/аннулирования. |
| **migration.js** | Однократная миграция данных из старых JSON-файлов в SQLite (если были). |
| **http.js** | Утилита HTTP-запросов (например, для ЮKassa и ФНС). |
| **yookassa.js** | Загрузка платежей из ЮKassa API (v3): Basic Auth из `yookassa_shop_id` + `yookassa_secret_key`, постранично, кэш. |
| **nalog.js** | Класс `NalogApi`: авторизация в ЛК НПД (`lknpd.nalog.ru`), создание/аннулирование чеков, получение списка доходов, работа с токенами. |
| **serverStart.js** | Сохранение времени старта сервера (для API и проверок). |

### Фронтенд (`public/`)

| Файл / папка | Назначение |
|--------------|------------|
| `index.html` | Единая страница: экран входа, шапка, настройки, платежи, чеки, модальные окна, фильтры. |
| `css/styles.css` | Стили приложения (включая экран авторизации). |
| `css/vendor/` | Bootstrap 5, Bootstrap Icons (минифицированные). |
| `js/init.js` | Инициализация: проверка авторизации, экран входа, смена пароля, загрузка настроек, старт приложения. |
| `js/state.js` | Глобальное состояние (фильтры, выбранные платежи и т.п.). |
| `js/utils.js` | Утилиты: fetch с перехватом 401, тосты, форматирование дат/чисел, escapeHtml. |
| `js/settings.js` | Настройки: конфиг (ЮKassa, налоговая), сохранение, авторизация (вкл/выкл, смена логина/пароля). |
| `js/services.js` | Управление списком наименований услуг (для чеков). |
| `js/payments.js` | Список платежей ЮKassa, пагинация, фильтры, привязка чеков, массовые действия. |
| `js/receipts.js` | Отправка чека, аннулирование, выбор услуги и даты, предупреждения по срокам. |
| `js/sync.js` | Синхронизация с налоговой, автосинхронизация, отображение результата. |
| `js/stats.js` | Блок статистики (суммы, разница и т.д.). |
| `js/filters.js` | UI фильтров по платежам. |
| `js/pagination.js` | Пагинация списков. |
| `js/modals.js` | Открытие/закрытие модальных окон. |
| `js/vendor/` | Bootstrap JS (bundle). |

### Установка

| Путь | Назначение |
|------|------------|
| `install/linux/install.sh` | Установка на Linux: npm install, systemd или crontab @reboot, опционально UFW/firewalld, запуск. Аргумент `uninstall` снимает автозагрузку. |
| `install/linux/COMMANDS.txt` | Шпаргалка: установка, запуск, остановка, логи. |
| `install/windows/install.hta` | Пошаговый установщик Windows (Node, папка, опционально служба NSSM). |
| `install/windows/download-node.ps1` | Скачивание портативной Node.js в папку `node/`. |
| `install/windows/download-nssm.ps1` | Скачивание NSSM для установки службы. |
| `install/windows/ensure-service-logs.ps1` | Настройка логов службы (при необходимости). |

---

## API (эндпоинты)

Базовый URL: `http://&lt;хост&gt;:3847`. Все ответы JSON, кодировка UTF-8.

### Без проверки авторизации

- **GET** `/`, `/index.html` — главная страница (HTML).
- **GET** `/css/*`, `/js/*` — статические файлы.
- **GET** `/api/auth/status` — включена ли авторизация и авторизован ли текущий пользователь (по cookie).
- **POST** `/api/auth/login` — вход: тело `{ "login", "password" }`, в ответ — успех/ошибка, при успехе выставляется cookie.
- **POST** `/api/auth/logout` — выход (удаление сессии и cookie).

### С проверкой авторизации (если включена)

Все остальные `/api/*` при включённой авторизации требуют валидной сессии (cookie `auth_token`). При 401 фронт может показать экран входа.

### Авторизация и настройки безопасности

- **GET** `/api/auth/settings` — включена ли авторизация, текущий логин, есть ли свой пароль, дефолтный логин.
- **POST** `/api/auth/toggle` — включить/выключить авторизацию: тело `{ "enabled": true/false }`.
- **POST** `/api/auth/change` — сменить логин и/или пароль: тело `{ "currentPassword", "newLogin?", "newPassword?" }`.
- **POST** `/api/auth/reset` — сброс учётных данных к дефолту (admin/admin).

### Конфигурация

- **GET** `/api/config/check` — проверка: есть ли конфиг, есть ли ЮKassa/налоговая, время старта сервера.
- **GET** `/api/config` — текущий конфиг для интерфейса (секретный ключ и пароль маскируются).
- **POST** `/api/config` — сохранение конфига: ЮKassa (shop_id, secret_key), налоговая (login, password), max_days_back.

### Услуги

- **GET** `/api/service-names` — список наименований услуг.
- **POST** `/api/service-names` — сохранить список услуг (тело — массив строк).

### Налоговая

- **POST** `/api/nalog/check` — проверка подключения (логин/пароль из конфига).
- **POST** `/api/nalog/sync` — синхронизация чеков из налоговой (загрузка в кэш и сопоставление с платежами).
- **GET** `/api/nalog/incomes` — список доходов из налоговой (с пагинацией/параметрами при необходимости).

### Платежи и чеки

- **GET** `/api/payments` — список платежей ЮKassa (параметры: даты, лимиты и т.д. по реализации).
- **POST** `/api/send-receipt` — отправить чек в налоговую (тело: платёж, услуга, дата и т.д.).
- **POST** `/api/check-receipt` — проверить статус чека по UUID.
- **POST** `/api/cancel-receipt` — аннулировать чек (тело: receiptUuid, причина при необходимости).

### Статистика

- **GET** `/api/stats` — сводная статистика (суммы отправленного, заработок и т.д. — по реализации).

### Опасные операции (Danger Zone)

- **POST** `/api/danger/clear-database` — очистка всех таблиц БД и кэша платежей ЮKassa.
- **POST** `/api/danger/clear-connections` — удаление из конфига данных ЮKassa и налоговой (ключи, логин, пароль, токены).
- **POST** `/api/danger/reset-all` — полный сброс: очистка БД, удаление конфига, сброс сессий и cookie.

---

## Секреты и конфигурация

Никакие ключи и пароли не захардкожены в коде. Они задаются через веб-интерфейс и сохраняются в зашифрованном виде.

| Что | Откуда берётся | Где хранится |
|-----|-----------------|--------------|
| ЮKassa Shop ID | Настройки в UI | `data/config.enc` (AES-256-CBC) |
| ЮKassa Secret Key | Настройки в UI | Там же |
| Логин/пароль ЛК НПД | Настройки в UI | Там же |
| Включение авторизации, логин входа, хеш пароля | Настройки → Безопасность | Там же |
| Ключ шифрования конфига | Генерируется при первом запуске | `data/.key` (текстовый файл, 32 байта hex) |

- В ответе **GET** `/api/config` секретный ключ ЮKassa отдаётся в виде маски (`****` + последние 4 символа), пароль налоговой — как `********` если задан.
- Логин налоговой в GET `/api/config` отдаётся полностью (для отображения в форме настроек).
- База SQLite (`data/database.sqlite`) хранит только чеки, услуги, кэш налоговой и служебные настройки — не пароли и не ключи API.

---

## Основные функции (кратко)

- **config.js:** `loadConfig()`, `saveConfig(config)`.
- **encryption.js:** `encrypt(text)`, `decrypt(text)`; ключ — `getOrCreateEncryptionKey()`.
- **auth.js:** `getAuthConfig()`, `saveAuthConfig()`, `isAuthEnabled()`, `attemptLogin()`, `changePassword()`, `resetAuthToDefaults()`, `toggleAuth()`, `validateSession()`, `createSession()`, `destroySession()`, работа с cookie (`getTokenFromRequest`, `setTokenCookie`, `clearTokenCookie`).
- **database.js:** `initDatabase()`, `getDatabase()`, `requestSave()`, `saveDatabase()`, `clearAllTables()`; внутри — `createTables()`.
- **storage.js:** `loadServiceNames()`, `saveServiceNames()`, `loadReceipts()`, `saveReceipt()`, `loadTaxReceipts()`, `saveTaxReceipts()`, `findMatchingTaxReceipt()`, `markReceiptsSentByUuids()`, `updateReceiptStatusByUuid()`, `markTaxReceiptCanceled()` и др. для чеков и кэша налоговой.
- **yookassa.js:** `getPayments(config, dateFrom, dateTo)`, `clearPaymentsCache()`.
- **nalog.js:** класс `NalogApi(login, password)`: `authenticate()`, `getAccessToken()`, `createReceipt(args)`, `cancelReceipt()`, `getIncomes()`, `getAllIncomes()`, `getCanceledIncomes()`, `getReceiptByUuid()`, `getReceiptByUuidFromList()`; фабрика `getNalogApi(config)`.
- **routes.js:** `handleRequest(req, res)` — раздача статики и вызов перечисленных API в зависимости от `pathname` и метода.
