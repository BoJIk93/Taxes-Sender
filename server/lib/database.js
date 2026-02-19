const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'database.sqlite');

let db = null;
let SQL = null;
let dirty = false;

// Инициализация SQLite
async function initDatabase() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    
    SQL = await initSqlJs();
    
    // Загружаем существующую БД или создаем новую
    if (fs.existsSync(DB_FILE)) {
        const buffer = fs.readFileSync(DB_FILE);
        db = new SQL.Database(buffer);
        console.log('База данных загружена из файла');
    } else {
        db = new SQL.Database();
        console.log('Создана новая база данных');
    }
    
    // Параметры производительности
    db.run('PRAGMA journal_mode = MEMORY');
    db.run('PRAGMA synchronous = NORMAL');
    db.run('PRAGMA temp_store = MEMORY');
    db.run('PRAGMA cache_size = -20000');
    
    // Создаем таблицы
    createTables();
    
    // Сохраняем БД
    requestSave();
    saveDatabase(true);
    
    return db;
}

function createTables() {
    // Таблица чеков
    db.run(`
        CREATE TABLE IF NOT EXISTS receipts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            payment_id TEXT UNIQUE NOT NULL,
            receipt_uuid TEXT,
            status TEXT NOT NULL,
            receipt_url_print TEXT,
            receipt_url_json TEXT,
            service_name TEXT,
            amount REAL,
            sale_date TEXT,
            sent_at TEXT,
            error_message TEXT,
            error_at TEXT,
            canceled_at TEXT,
            synced_from_tax INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    // Таблица наименований услуг (при новом проекте — пустая, без дефолтов)
    db.run(`
        CREATE TABLE IF NOT EXISTS service_names (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    // Таблица кэша чеков из налоговой
    db.run(`
        CREATE TABLE IF NOT EXISTS tax_receipts_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            receipt_uuid TEXT UNIQUE NOT NULL,
            total_amount REAL,
            operation_time TEXT,
            request_time TEXT,
            service_name TEXT,
            is_canceled INTEGER DEFAULT 0,
            canceled_at TEXT,
            data TEXT,
            synced_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    // Таблица настроек (для последней синхронизации и тп)
    db.run(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    // Индексы
    db.run(`CREATE INDEX IF NOT EXISTS idx_receipts_payment_id ON receipts(payment_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_receipts_status ON receipts(status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_receipts_sent_at ON receipts(sent_at)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_tax_receipts_uuid ON tax_receipts_cache(receipt_uuid)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_tax_receipts_amount ON tax_receipts_cache(total_amount)`);
    
    // Проверяем структуру таблицы tax_receipts_cache
    try {
        const tableInfo = db.exec(`PRAGMA table_info(tax_receipts_cache)`);
        const columns = tableInfo[0]?.values.map(row => row[1]) || [];
        console.log('📊 Структура tax_receipts_cache:', columns);
        
        // Миграция: добавляем новые поля для аннулированных чеков (если их еще нет)
        if (!columns.includes('is_canceled')) {
            db.run(`ALTER TABLE tax_receipts_cache ADD COLUMN is_canceled INTEGER DEFAULT 0`);
            console.log('✅ Добавлено поле is_canceled в tax_receipts_cache');
        } else {
            console.log('ℹ️ Поле is_canceled уже существует');
        }
        
        if (!columns.includes('canceled_at')) {
            db.run(`ALTER TABLE tax_receipts_cache ADD COLUMN canceled_at TEXT`);
            console.log('✅ Добавлено поле canceled_at в tax_receipts_cache');
        } else {
            console.log('ℹ️ Поле canceled_at уже существует');
        }
    } catch (e) {
        console.error('❌ Ошибка при миграции:', e.message);
    }
    
    console.log('Таблицы и индексы созданы');
}

function requestSave() {
    dirty = true;
}

function saveDatabase(force = false) {
    if (!db) return;
    if (!dirty && !force) return;
    
    try {
        const data = db.export();
        fs.writeFileSync(DB_FILE, data);
        dirty = false;
    } catch (e) {
        console.error('Ошибка сохранения БД:', e);
    }
}

// Автосохранение каждые 5 секунд
setInterval(() => {
    if (db) saveDatabase();
}, 5000);

// Сохранение при завершении процесса
process.on('exit', () => saveDatabase(true));
process.on('SIGINT', () => {
    saveDatabase(true);
    process.exit();
});

function getDatabase() {
    return db;
}

function clearAllTables() {
    if (!db) return false;
    try {
        db.run('DELETE FROM receipts');
        db.run('DELETE FROM tax_receipts_cache');
        db.run('DELETE FROM service_names');
        db.run('DELETE FROM settings');
        requestSave();
        saveDatabase(true);
        return true;
    } catch (e) {
        console.error('Ошибка очистки БД:', e);
        return false;
    }
}

module.exports = { initDatabase, getDatabase, requestSave, saveDatabase, clearAllTables };
