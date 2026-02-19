const fs = require('fs');
const path = require('path');
const { getDatabase, requestSave, saveDatabase } = require('./database');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const RECEIPTS_JSON = path.join(DATA_DIR, 'receipts.json');
const SERVICE_NAMES_JSON = path.join(DATA_DIR, 'service_names.json');
const TAX_RECEIPTS_JSON = path.join(DATA_DIR, 'tax_receipts.json');

function migrateFromJSON() {
    const db = getDatabase();
    if (!db) {
        console.error('БД не инициализирована');
        return false;
    }
    
    console.log('Начало миграции данных из JSON в SQLite...');
    let migrated = false;
    
    // Миграция чеков
    if (fs.existsSync(RECEIPTS_JSON)) {
        try {
            const receipts = JSON.parse(fs.readFileSync(RECEIPTS_JSON, 'utf8'));
            console.log(`Найдено ${receipts.length} чеков для миграции`);
            
            const stmt = db.prepare(`
                INSERT OR REPLACE INTO receipts 
                (payment_id, receipt_uuid, status, receipt_url_print, receipt_url_json, 
                 service_name, amount, sale_date, sent_at, error_message, error_at, 
                 canceled_at, synced_from_tax)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            
            receipts.forEach(r => {
                stmt.run([
                    r.payment_id,
                    r.receipt_uuid || null,
                    r.status,
                    r.receipt_url_print || null,
                    r.receipt_url_json || null,
                    r.service_name || null,
                    r.amount || null,
                    r.sale_date || null,
                    r.sent_at || null,
                    r.error_message || null,
                    r.error_at || null,
                    r.canceled_at || null,
                    r.synced_from_tax ? 1 : 0
                ]);
            });
            stmt.free();
            
            console.log(`✅ Мигрировано ${receipts.length} чеков`);
            
            // Переименовываем старый файл
            fs.renameSync(RECEIPTS_JSON, RECEIPTS_JSON + '.backup');
            migrated = true;
        } catch (e) {
            console.error('Ошибка миграции чеков:', e);
        }
    }
    
    // Наименования услуг не мигрируем из JSON: при первом входе список должен быть пустым,
    // пользователь добавляет услуги сам в «Управление услугами».
    if (fs.existsSync(SERVICE_NAMES_JSON)) {
        try {
            fs.renameSync(SERVICE_NAMES_JSON, SERVICE_NAMES_JSON + '.backup');
            console.log('Файл service_names.json сохранён как .backup (услуги не переносятся в БД — только ручное добавление)');
        } catch (e) {
            console.error('Ошибка переименования service_names.json:', e);
        }
    }

    
    // Миграция кэша налоговой
    if (fs.existsSync(TAX_RECEIPTS_JSON)) {
        try {
            const taxData = JSON.parse(fs.readFileSync(TAX_RECEIPTS_JSON, 'utf8'));
            const receipts = taxData.receipts || [];
            console.log(`Найдено ${receipts.length} чеков налоговой для миграции`);
            
            const stmt = db.prepare(`
                INSERT OR REPLACE INTO tax_receipts_cache 
                (receipt_uuid, total_amount, operation_time, request_time, service_name, data)
                VALUES (?, ?, ?, ?, ?, ?)
            `);
            
            receipts.forEach(r => {
                const uuid = r.approvedReceiptUuid || r.receiptUuid || r.uuid;
                const amount = parseFloat(r.totalAmount || r.amount || 0);
                const opTime = r.operationTime || r.requestTime;
                const reqTime = r.requestTime;
                const serviceName = r.services?.[0]?.name || '';
                
                stmt.run([
                    uuid,
                    amount,
                    opTime,
                    reqTime,
                    serviceName,
                    JSON.stringify(r)
                ]);
            });
            stmt.free();
            
            // Сохраняем lastSync
            if (taxData.lastSync) {
                db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 
                    ['last_tax_sync', taxData.lastSync]);
            }
            
            console.log(`✅ Мигрировано ${receipts.length} чеков налоговой`);
            
            // Переименовываем старый файл
            fs.renameSync(TAX_RECEIPTS_JSON, TAX_RECEIPTS_JSON + '.backup');
            migrated = true;
        } catch (e) {
            console.error('Ошибка миграции кэша налоговой:', e);
        }
    }
    
    if (migrated) {
        requestSave();
        saveDatabase(true);
        console.log('Миграция завершена! Старые JSON файлы сохранены с расширением .backup');
    } else {
        console.log('JSON файлы не найдены, миграция не требуется');
    }
    
    return migrated;
}

module.exports = { migrateFromJSON };
