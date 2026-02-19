const { getDatabase, requestSave, saveDatabase } = require('./database');

// ============== НАИМЕНОВАНИЯ УСЛУГ ==============

function loadServiceNames() {
    const db = getDatabase();
    if (!db) return [];
    
    try {
        const result = db.exec('SELECT name FROM service_names ORDER BY name');
        
        if (result.length === 0 || result[0].values.length === 0) {
            return [];
        }
        
        return result[0].values.map(row => row[0]);
    } catch (e) {
        console.error('Ошибка загрузки наименований услуг:', e);
        return [];
    }
}

function saveServiceNames(names) {
    const db = getDatabase();
    if (!db) return false;
    
    try {
        // Сохраняем только переданный список (без подмешивания дефолтных услуг)
        db.run('DELETE FROM service_names');
        
        const stmt = db.prepare('INSERT INTO service_names (name) VALUES (?)');
        names.forEach(name => {
            stmt.run([name]);
        });
        stmt.free();
        
        requestSave();
        return true;
    } catch (e) {
        console.error('Ошибка сохранения наименований услуг:', e);
        return false;
    }
}

/** Одноразово очистить таблицу услуг при первом запуске после обновления (дефолтов больше не добавляем). */
function ensureServiceNamesEmptyOnce() {
    const db = getDatabase();
    if (!db) return;
    try {
        if (getSetting('service_names_empty_default_done')) return;
        db.run('DELETE FROM service_names');
        setSetting('service_names_empty_default_done', '1');
        requestSave();
    } catch (e) {
        console.error('Ошибка одноразовой очистки услуг:', e);
    }
}

// ============== ЧЕКИ (локальное хранилище) ==============

function loadReceipts() {
    const db = getDatabase();
    if (!db) return [];
    
    try {
        const result = db.exec('SELECT * FROM receipts');
        
        if (result.length === 0) return [];
        
        const columns = result[0].columns;
        const values = result[0].values;
        
        return values.map(row => {
            const receipt = {};
            columns.forEach((col, idx) => {
                receipt[col] = row[idx];
            });
            // Преобразуем synced_from_tax обратно в boolean
            receipt.synced_from_tax = receipt.synced_from_tax === 1;
            return receipt;
        });
    } catch (e) {
        console.error('Ошибка загрузки чеков:', e);
        return [];
    }
}

function saveReceipts(receipts) {
    const db = getDatabase();
    if (!db) return false;

    try {
        db.run('BEGIN TRANSACTION');

        const stmt = db.prepare(`
            INSERT INTO receipts 
            (payment_id, receipt_uuid, status, receipt_url_print, receipt_url_json, 
             service_name, amount, sale_date, sent_at, error_message, error_at, 
             canceled_at, synced_from_tax, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(payment_id) DO UPDATE SET
                receipt_uuid=excluded.receipt_uuid,
                status=excluded.status,
                receipt_url_print=excluded.receipt_url_print,
                receipt_url_json=excluded.receipt_url_json,
                service_name=excluded.service_name,
                amount=excluded.amount,
                sale_date=excluded.sale_date,
                sent_at=excluded.sent_at,
                error_message=excluded.error_message,
                error_at=excluded.error_at,
                canceled_at=excluded.canceled_at,
                synced_from_tax=excluded.synced_from_tax,
                updated_at=excluded.updated_at
        `);

        const now = new Date().toISOString();
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
                r.synced_from_tax ? 1 : 0,
                now
            ]);
        });
        stmt.free();

        db.run('COMMIT');
        requestSave();
        return true;
    } catch (e) {
        console.error('Ошибка сохранения чеков:', e);
        try {
            db.run('ROLLBACK');
        } catch (err) {}
        return false;
    }
}

function getReceiptByPaymentId(paymentId) {
    const db = getDatabase();
    if (!db) return null;
    
    try {
        const result = db.exec('SELECT * FROM receipts WHERE payment_id = ?', [paymentId]);
        
        if (result.length === 0 || result[0].values.length === 0) return null;
        
        const columns = result[0].columns;
        const row = result[0].values[0];
        
        const receipt = {};
        columns.forEach((col, idx) => {
            receipt[col] = row[idx];
        });
        receipt.synced_from_tax = receipt.synced_from_tax === 1;
        
        return receipt;
    } catch (e) {
        console.error('Ошибка получения чека:', e);
        return null;
    }
}

function getReceiptsByPaymentIds(paymentIds) {
    const db = getDatabase();
    if (!db || !paymentIds || paymentIds.length === 0) return new Map();

    try {
        const chunks = [];
        const chunkSize = 900;
        for (let i = 0; i < paymentIds.length; i += chunkSize) {
            chunks.push(paymentIds.slice(i, i + chunkSize));
        }

        const receiptMap = new Map();
        chunks.forEach(ids => {
            const placeholders = ids.map(() => '?').join(', ');
            const result = db.exec(`SELECT * FROM receipts WHERE payment_id IN (${placeholders})`, ids);
            if (result.length === 0) return;

            const columns = result[0].columns;
            const values = result[0].values;
            values.forEach(row => {
                const receipt = {};
                columns.forEach((col, idx) => {
                    receipt[col] = row[idx];
                });
                receipt.synced_from_tax = receipt.synced_from_tax === 1;
                receiptMap.set(receipt.payment_id, receipt);
            });
        });

        return receiptMap;
    } catch (e) {
        console.error('Ошибка загрузки чеков по payment_id:', e);
        return new Map();
    }
}

function saveReceipt(receiptData) {
    const db = getDatabase();
    if (!db) return false;
    
    try {
        const existing = getReceiptByPaymentId(receiptData.payment_id);
        
        if (existing) {
            // UPDATE
            const updates = [];
            const values = [];
            
            Object.keys(receiptData).forEach(key => {
                if (key !== 'payment_id' && key !== 'id' && key !== 'created_at') {
                    updates.push(`${key} = ?`);
                    values.push(key === 'synced_from_tax' ? (receiptData[key] ? 1 : 0) : receiptData[key]);
                }
            });
            
            updates.push('updated_at = ?');
            values.push(new Date().toISOString());
            values.push(receiptData.payment_id);
            
            db.run(`UPDATE receipts SET ${updates.join(', ')} WHERE payment_id = ?`, values);
        } else {
            // INSERT
            const keys = ['payment_id'];
            const placeholders = ['?'];
            const values = [receiptData.payment_id];
            
            Object.keys(receiptData).forEach(key => {
                if (key !== 'payment_id' && key !== 'id' && key !== 'created_at') {
                    keys.push(key);
                    placeholders.push('?');
                    values.push(key === 'synced_from_tax' ? (receiptData[key] ? 1 : 0) : receiptData[key]);
                }
            });
            
            db.run(`INSERT INTO receipts (${keys.join(', ')}) VALUES (${placeholders.join(', ')})`, values);
        }
        
        requestSave();
        return true;
    } catch (e) {
        console.error('Ошибка сохранения чека:', e);
        return false;
    }
}

// ============== КЭШ ЧЕКОВ ИЗ НАЛОГОВОЙ ==============

function loadTaxReceipts() {
    const db = getDatabase();
    if (!db) return { receipts: [], lastSync: null };
    
    try {
        const result = db.exec('SELECT * FROM tax_receipts_cache');
        
        let receipts = [];
        if (result.length > 0) {
            const columns = result[0].columns;
            const values = result[0].values;
            
            receipts = values.map(row => {
                const receipt = {};
                columns.forEach((col, idx) => {
                    if (col === 'data') {
                        try {
                            receipt = { ...receipt, ...JSON.parse(row[idx] || '{}') };
                        } catch (e) {}
                    } else {
                        receipt[col] = row[idx];
                    }
                });
                return receipt;
            });
        }
        
        // Получаем lastSync из settings
        const syncResult = db.exec('SELECT value FROM settings WHERE key = ?', ['last_tax_sync']);
        const lastSync = syncResult.length > 0 && syncResult[0].values.length > 0 
            ? syncResult[0].values[0][0] 
            : null;
        
        return { receipts, lastSync };
    } catch (e) {
        console.error('Ошибка загрузки кэша чеков налоговой:', e);
        return { receipts: [], lastSync: null };
    }
}

function getCanceledReceiptUuidsFromTaxCache() {
    const db = getDatabase();
    if (!db) return new Set();
    try {
        const result = db.exec(`SELECT receipt_uuid FROM tax_receipts_cache WHERE is_canceled = 1`);
        if (result.length === 0 || result[0].values.length === 0) return new Set();
        const idx = result[0].columns.indexOf('receipt_uuid');
        if (idx < 0) return new Set();
        const set = new Set();
        result[0].values.forEach(row => {
            const uuid = row[idx];
            if (uuid) set.add(uuid);
        });
        return set;
    } catch (e) {
        console.error('Ошибка получения аннулированных чеков:', e);
        return new Set();
    }
}

function loadTaxReceiptsLite() {
    const db = getDatabase();
    if (!db) return { receipts: [], lastSync: null };

    try {
        const result = db.exec(`
            SELECT receipt_uuid, total_amount, operation_time, request_time, service_name, is_canceled 
            FROM tax_receipts_cache
        `);

        let receipts = [];
        if (result.length > 0) {
            const columns = result[0].columns;
            const values = result[0].values;
            receipts = values.map(row => {
                const receipt = {};
                columns.forEach((col, idx) => {
                    receipt[col] = row[idx];
                });
                return receipt;
            });
        }

        const syncResult = db.exec('SELECT value FROM settings WHERE key = ?', ['last_tax_sync']);
        const lastSync = syncResult.length > 0 && syncResult[0].values.length > 0 
            ? syncResult[0].values[0][0] 
            : null;

        return { receipts, lastSync };
    } catch (e) {
        console.error('Ошибка загрузки кэша чеков налоговой (lite):', e);
        return { receipts: [], lastSync: null };
    }
}

function saveTaxReceipts(data) {
    const db = getDatabase();
    if (!db) {
        console.error('❌ БД не инициализирована при попытке сохранить кэш налоговой');
        return false;
    }
    
    if (!data || !data.receipts || !Array.isArray(data.receipts)) {
        console.error('❌ Некорректные данные для сохранения кэша налоговой:', data);
        return false;
    }
    
    console.log(`🔄 Начинаем сохранение ${data.receipts.length} чеков в кэш...`);
    
    try {
        // Начинаем транзакцию - если что-то пойдет не так, всё откатится
        db.run('BEGIN TRANSACTION');
        
        // Очищаем старый кэш (в рамках транзакции)
        db.run('DELETE FROM tax_receipts_cache');
        console.log('✅ Старый кэш очищен (в транзакции)');
        
        // Вставляем новые чеки
        const stmt = db.prepare(`
            INSERT INTO tax_receipts_cache 
            (receipt_uuid, total_amount, operation_time, request_time, service_name, is_canceled, canceled_at, data) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        let insertedCount = 0;
        let skippedCount = 0;
        let canceledCount = 0;
        
        data.receipts.forEach((receipt, index) => {
            try {
                const uuid = receipt.approvedReceiptUuid || receipt.receiptUuid || receipt.uuid;
                
                if (!uuid) {
                    console.warn(`⚠️ Чек #${index + 1} пропущен: нет UUID`);
                    skippedCount++;
                    return;
                }
                
                const amount = parseFloat(receipt.totalAmount || receipt.amount || 0);
                const opTime = receipt.operationTime || receipt.requestTime;
                const reqTime = receipt.requestTime;
                const serviceName = receipt.services?.[0]?.name || '';
                
                // Проверяем, аннулирован ли чек (правильное поле: cancellationInfo)
                const isCanceled = receipt.cancellationInfo || receipt.canceledInfo || receipt.cancelledInfo || receipt.canceled || receipt.status === 'CANCELED' || false;
                const canceledAt = isCanceled ? 
                    (receipt.cancellationInfo?.operationTime || receipt.canceledInfo?.requestTime || receipt.cancelledInfo?.requestTime || receipt.canceledAt || new Date().toISOString()) 
                    : null;
                
                if (isCanceled) {
                    canceledCount++;
                    console.log(`🚫 Аннулированный чек ${uuid}:`, {
                        comment: receipt.cancellationInfo?.comment,
                        canceledAt: canceledAt
                    });
                }
                
                stmt.run([
                    uuid,
                    amount,
                    opTime,
                    reqTime,
                    serviceName,
                    isCanceled ? 1 : 0,
                    canceledAt,
                    JSON.stringify(receipt)
                ]);
                insertedCount++;
            } catch (err) {
                console.error(`❌ Ошибка при вставке чека #${index + 1}:`, err.message);
                console.error('Данные чека:', JSON.stringify(receipt).substring(0, 200));
                throw err; // Прерываем транзакцию
            }
        });
        
        stmt.free();
        
        // Сохраняем время последней синхронизации
        if (data.lastSync) {
            const updateStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)');
            updateStmt.run(['last_tax_sync', data.lastSync, new Date().toISOString()]);
            updateStmt.free();
        }
        
        // Коммитим транзакцию - только если всё прошло успешно
        db.run('COMMIT');
        
        console.log(`✅ Кэш налоговой сохранен: ${insertedCount} чеков добавлено${skippedCount > 0 ? `, ${skippedCount} пропущено` : ''}${canceledCount > 0 ? `, ❌ ${canceledCount} аннулировано` : ''}`);
        
        // Запрашиваем сохранение БД на диск
        requestSave();
        
        return true;
    } catch (e) {
        // Откатываем транзакцию при ошибке - старый кэш останется нетронутым
        try {
            db.run('ROLLBACK');
            console.error('❌ Транзакция отменена, старый кэш сохранён');
        } catch (rollbackErr) {
            console.error('❌ Ошибка отката транзакции:', rollbackErr);
        }
        
        console.error('❌ Критическая ошибка сохранения кэша налоговой:', e.message);
        console.error('Stack trace:', e.stack);
        return false;
    }
}

function findMatchingTaxReceipt(amount, date) {
    const db = getDatabase();
    if (!db) return null;
    
    try {
        const targetAmount = parseFloat(amount);
        const targetDate = date ? date.split('T')[0] : null;
        
        // Ищем по сумме с погрешностью
        const result = db.exec(`
            SELECT * FROM tax_receipts_cache 
            WHERE ABS(total_amount - ?) < 0.01
        `, [targetAmount]);
        
        if (result.length === 0 || result[0].values.length === 0) return null;
        
        const columns = result[0].columns;
        
        for (const row of result[0].values) {
            const receipt = {};
            columns.forEach((col, idx) => {
                receipt[col] = row[idx];
            });
            
            // Проверяем дату
            const receiptDate = (receipt.operation_time || '').split('T')[0];
            if (!targetDate || receiptDate === targetDate) {
                return receipt;
            }
        }
        
        return null;
    } catch (e) {
        console.error('Ошибка поиска чека:', e);
        return null;
    }
}

function markReceiptsSentByUuids(items) {
    const db = getDatabase();
    if (!db || !items || items.length === 0) return 0;

    let updated = 0;
    let canceledUpdated = 0;
    try {
        db.run('BEGIN TRANSACTION');
        
        // Разделяем на обычные и аннулированные чеки
        const normalReceipts = items.filter(item => !item.is_canceled);
        const canceledReceipts = items.filter(item => item.is_canceled);
        
        // Обновляем только pending -> sent. Статусы sent, canceled, error не трогаем (локальный статус приоритетнее синхронизации).
        if (normalReceipts.length > 0) {
            const stmt = db.prepare(`
                UPDATE receipts 
                SET status = 'sent', synced_from_tax = 1, sent_at = ?, updated_at = ?
                WHERE receipt_uuid = ? AND status NOT IN ('sent', 'canceled', 'error')
            `);

            normalReceipts.forEach(item => {
                const sentAt = item.sent_at || new Date().toISOString();
                const now = new Date().toISOString();
                const result = stmt.run([sentAt, now, item.receipt_uuid]);
                if (result.changes > 0) updated++;
            });
            stmt.free();
        }
        
        // Обновляем аннулированные чеки (по основному UUID и по альтернативному — в receipts может быть request id)
        if (canceledReceipts.length > 0) {
            const stmtCanceled = db.prepare(`
                UPDATE receipts 
                SET status = 'canceled', synced_from_tax = 1, sent_at = ?, canceled_at = ?, updated_at = ?
                WHERE receipt_uuid = ?
            `);

            canceledReceipts.forEach(item => {
                const sentAt = item.sent_at || new Date().toISOString();
                const canceledAt = item.canceled_at || new Date().toISOString();
                const now = new Date().toISOString();
                for (const uuid of [item.receipt_uuid, item.receipt_uuid_alt].filter(Boolean)) {
                    const result = stmtCanceled.run([sentAt, canceledAt, now, uuid]);
                    if (result.changes > 0) {
                        canceledUpdated++;
                        updated++;
                        console.log(`🚫 Чек ${uuid} помечен как аннулированный`);
                        break;
                    }
                }
            });
            stmtCanceled.free();
        }
        
        db.run('COMMIT');
        requestSave();
        
        if (canceledUpdated > 0) {
            console.log(`✅ Обновлено чеков: ${updated} (из них аннулировано: ${canceledUpdated})`);
        }
        
        return updated;
    } catch (e) {
        console.error('Ошибка обновления статусов чеков:', e);
        try {
            db.run('ROLLBACK');
        } catch (err) {}
        return 0;
    }
}

function updateReceiptStatusByUuid(receiptUuid, status, fields = {}) {
    const db = getDatabase();
    if (!db || !receiptUuid) return false;

    try {
        const updates = ['status = ?'];
        const values = [status];

        Object.keys(fields).forEach(key => {
            updates.push(`${key} = ?`);
            values.push(fields[key]);
        });

        updates.push('updated_at = ?');
        values.push(new Date().toISOString());
        values.push(receiptUuid);

        db.run(`UPDATE receipts SET ${updates.join(', ')} WHERE receipt_uuid = ?`, values);
        requestSave();
        return true;
    } catch (e) {
        console.error('Ошибка обновления статуса чека:', e);
        return false;
    }
}

/**
 * Помечает чек в кэше налоговой как аннулированный (is_canceled = 1).
 * Это нужно чтобы при следующей загрузке платежей кэш не возвращал
 * аннулированный чек как действующий.
 */
function markTaxReceiptCanceled(receiptUuid) {
    const db = getDatabase();
    if (!db || !receiptUuid) return false;

    try {
        db.run(
            `UPDATE tax_receipts_cache SET is_canceled = 1, canceled_at = ? WHERE receipt_uuid = ?`,
            [new Date().toISOString(), receiptUuid]
        );
        requestSave();
        return true;
    } catch (e) {
        console.error('Ошибка пометки чека как аннулированного в кэше:', e);
        return false;
    }
}

// ============== SETTINGS ==============

function getSetting(key) {
    const db = getDatabase();
    if (!db) return null;
    
    try {
        const result = db.exec('SELECT value FROM settings WHERE key = ?', [key]);
        return result.length > 0 && result[0].values.length > 0 ? result[0].values[0][0] : null;
    } catch (e) {
        return null;
    }
}

function setSetting(key, value) {
    const db = getDatabase();
    if (!db) return false;
    
    try {
        db.run('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)', 
            [key, value, new Date().toISOString()]);
        requestSave();
        return true;
    } catch (e) {
        console.error('Ошибка сохранения настройки:', e);
        return false;
    }
}

module.exports = {
    loadServiceNames,
    saveServiceNames,
    ensureServiceNamesEmptyOnce,
    loadReceipts,
    saveReceipts,
    getReceiptByPaymentId,
    getReceiptsByPaymentIds,
    saveReceipt,
    loadTaxReceipts,
    loadTaxReceiptsLite,
    getCanceledReceiptUuidsFromTaxCache,
    saveTaxReceipts,
    findMatchingTaxReceipt,
    markReceiptsSentByUuids,
    updateReceiptStatusByUuid,
    markTaxReceiptCanceled,
    getSetting,
    setSetting
};
