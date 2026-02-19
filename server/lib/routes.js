const url = require('url');
const path = require('path');
const fs = require('fs');
const { loadConfig, saveConfig } = require('./config');
const { 
    loadServiceNames, 
    saveServiceNames,
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
    markTaxReceiptCanceled
} = require('./storage');
const { getPayments } = require('./yookassa');
const { getNalogApi } = require('./nalog');
const { parseBody } = require('./http');
const {
    isAuthEnabled,
    getAuthConfig,
    attemptLogin,
    createSession,
    changePassword,
    resetAuthToDefaults,
    toggleAuth,
    validateSession,
    destroySession,
    clearAllSessions,
    getTokenFromRequest,
    setTokenCookie,
    clearTokenCookie,
    DEFAULT_LOGIN,
    DEFAULT_PASSWORD
} = require('./auth');

/** Дата по Москве (YYYY-MM-DD) из ISO-строки ЮKassa (UTC). Налоговая отдаёт даты в МСК — сопоставление только по одной зоне. */
function getMoscowDateStr(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return isoStr.split('T')[0] || '';
    return new Date(d.getTime() + 3 * 3600000).toISOString().split('T')[0];
}

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

const staticCache = new Map();

function sendResponse(res, statusCode, data, contentType = 'application/json') {
    res.writeHead(statusCode, { 
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    if (typeof data === 'object') {
        res.end(JSON.stringify(data));
    } else {
        res.end(data);
    }
}

function serveStaticFile(res, filePath) {
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.stat(filePath, (statErr, stat) => {
        if (statErr || !stat.isFile()) {
            sendResponse(res, 404, { error: 'File not found' });
            return;
        }

        const cached = staticCache.get(filePath);
        if (cached && cached.mtimeMs === stat.mtimeMs) {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(cached.data);
            return;
        }

        fs.readFile(filePath, (err, data) => {
            if (err) {
                sendResponse(res, 404, { error: 'File not found' });
                return;
            }
            staticCache.set(filePath, { mtimeMs: stat.mtimeMs, data });
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        });
    });
}

async function handleRequest(req, res) {
  try {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const query = parsedUrl.query;
    
    // CORS preflight
    if (req.method === 'OPTIONS') {
        sendResponse(res, 200, '');
        return;
    }
    
    // Статические файлы
    if (pathname === '/' || pathname === '/index.html') {
        serveStaticFile(res, path.join(__dirname, '..', '..', 'public', 'index.html'));
        return;
    }
    
    if (pathname.startsWith('/css/') || pathname.startsWith('/js/') || pathname.endsWith('.css') || pathname.endsWith('.js')) {
        const filePath = path.join(__dirname, '..', '..', 'public', pathname);
        serveStaticFile(res, filePath);
        return;
    }
    
    // ============== AUTH API (доступны без авторизации) ==============
    
    if (pathname === '/api/auth/status' && req.method === 'GET') {
        const authEnabled = isAuthEnabled();
        const token = getTokenFromRequest(req);
        const authenticated = authEnabled ? validateSession(token) : true;
        sendResponse(res, 200, { authEnabled, authenticated });
        return;
    }
    
    if (pathname === '/api/auth/login' && req.method === 'POST') {
        const body = await parseBody(req);
        const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
        const result = attemptLogin(body.login, body.password, clientIp);
        if (result.success) {
            setTokenCookie(res, result.token);
            sendResponse(res, 200, { success: true });
        } else {
            const resp = { success: false, error: result.error };
            if (result.locked) resp.locked = true;
            if (result.retryAfter) resp.retryAfter = result.retryAfter;
            sendResponse(res, result.locked ? 429 : 401, resp);
        }
        return;
    }
    
    if (pathname === '/api/auth/logout' && req.method === 'POST') {
        const token = getTokenFromRequest(req);
        destroySession(token);
        clearTokenCookie(res);
        sendResponse(res, 200, { success: true });
        return;
    }
    
    // ============== ПРОВЕРКА АВТОРИЗАЦИИ ==============
    
    if (isAuthEnabled()) {
        const token = getTokenFromRequest(req);
        if (!validateSession(token)) {
            sendResponse(res, 401, { success: false, error: 'Требуется авторизация', authRequired: true });
            return;
        }
    }
    
    // ============== AUTH SETTINGS API (требуют авторизации) ==============
    
    if (pathname === '/api/auth/settings' && req.method === 'GET') {
        const auth = getAuthConfig();
        sendResponse(res, 200, {
            enabled: auth.enabled,
            login: auth.login,
            hasCustomPassword: !!auth.passwordHash,
            defaultLogin: DEFAULT_LOGIN
        });
        return;
    }
    
    if (pathname === '/api/auth/toggle' && req.method === 'POST') {
        const body = await parseBody(req);
        const result = toggleAuth(!!body.enabled);
        // При включении — автоматически создаём сессию, чтобы текущий пользователь не был разлогинен
        if (result.success && body.enabled) {
            const auth = getAuthConfig();
            const token = createSession(auth.login);
            setTokenCookie(res, token);
        }
        sendResponse(res, 200, result);
        return;
    }
    
    if (pathname === '/api/auth/change' && req.method === 'POST') {
        const body = await parseBody(req);
        const result = changePassword(body.currentPassword, body.newLogin, body.newPassword);
        if (result.success && isAuthEnabled()) {
            // Пересоздаём сессию с актуальным логином
            const auth = getAuthConfig();
            clearAllSessions();
            const token = createSession(auth.login);
            setTokenCookie(res, token);
        }
        sendResponse(res, result.success ? 200 : 400, result);
        return;
    }
    
    if (pathname === '/api/auth/reset' && req.method === 'POST') {
        const result = resetAuthToDefaults();
        if (result.success && isAuthEnabled()) {
            // Сессии сброшены, создаём новую чтобы пользователь не был разлогинен
            const token = createSession(DEFAULT_LOGIN);
            setTokenCookie(res, token);
        } else if (result.success) {
            clearTokenCookie(res);
        }
        sendResponse(res, 200, result);
        return;
    }
    
    // ============== DANGER ZONE API ==============
    
    if (pathname === '/api/danger/clear-database' && req.method === 'POST') {
        const { clearAllTables } = require('./database');
        const { clearPaymentsCache } = require('./yookassa');
        const ok = clearAllTables();
        clearPaymentsCache();
        if (ok) {
            sendResponse(res, 200, { success: true, message: 'База данных очищена' });
        } else {
            sendResponse(res, 500, { success: false, error: 'Ошибка очистки базы данных' });
        }
        return;
    }
    
    if (pathname === '/api/danger/clear-connections' && req.method === 'POST') {
        const { clearPaymentsCache } = require('./yookassa');
        const config = loadConfig() || {};
        delete config.yookassa_shop_id;
        delete config.yookassa_secret_key;
        delete config.nalog_login;
        delete config.nalog_password;
        delete config.nalog_token;
        delete config.nalog_refresh_token;
        delete config.inn;
        delete config.device_id;
        delete config.source_device_id;
        const ok = saveConfig(config);
        clearPaymentsCache();
        if (ok) {
            sendResponse(res, 200, { success: true, message: 'Данные подключений удалены' });
        } else {
            sendResponse(res, 500, { success: false, error: 'Ошибка очистки подключений' });
        }
        return;
    }
    
    if (pathname === '/api/danger/reset-all' && req.method === 'POST') {
        const { clearAllTables } = require('./database');
        const { clearPaymentsCache } = require('./yookassa');
        clearAllTables();
        clearPaymentsCache();
        const DATA_DIR = path.join(__dirname, '..', '..', 'data');
        const CONFIG_FILE = path.join(DATA_DIR, 'config.enc');
        try { if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE); } catch (e) {}
        clearAllSessions();
        clearTokenCookie(res);
        sendResponse(res, 200, { success: true, message: 'Все данные сброшены' });
        return;
    }
    
    // ============== CONFIG API ==============
    
    if (pathname === '/api/config/check') {
        const config = loadConfig();
        const { getServerStartedAt } = require('./serverStart');
        sendResponse(res, 200, { 
            configured: config !== null,
            hasYookassa: config?.yookassa_shop_id ? true : false,
            hasNalog: config?.nalog_login ? true : false,
            serverStartedAt: getServerStartedAt()
        });
        return;
    }
    
    if (pathname === '/api/config' && req.method === 'GET') {
        const config = loadConfig();
        if (config) {
            sendResponse(res, 200, {
                yookassa_shop_id: config.yookassa_shop_id,
                yookassa_secret_key: config.yookassa_secret_key ? '****' + config.yookassa_secret_key.slice(-4) : '',
                nalog_login: config.nalog_login,
                nalog_password: config.nalog_password ? '********' : '',
                max_days_back: config.max_days_back || 30
            });
        } else {
            sendResponse(res, 200, null);
        }
        return;
    }
    
    if (pathname === '/api/config' && req.method === 'POST') {
        try {
            const newConfig = await parseBody(req);
            const existingConfig = loadConfig() || {};
            
            // Сохраняем все существующие поля (включая auth_*), обновляя только переданные
            const config = { ...existingConfig };
            
            if (newConfig.yookassa_shop_id) config.yookassa_shop_id = newConfig.yookassa_shop_id;
            if (newConfig.yookassa_secret_key && !newConfig.yookassa_secret_key.startsWith('****')) {
                config.yookassa_secret_key = newConfig.yookassa_secret_key;
            }
            if (newConfig.nalog_login) config.nalog_login = newConfig.nalog_login;
            if (newConfig.nalog_password && newConfig.nalog_password !== '********') {
                config.nalog_password = newConfig.nalog_password;
            }
            if (newConfig.max_days_back !== undefined) {
                config.max_days_back = parseInt(newConfig.max_days_back) || 30;
            }
            
            if (saveConfig(config)) {
                sendResponse(res, 200, { success: true });
            } else {
                sendResponse(res, 500, { error: 'Ошибка сохранения' });
            }
        } catch (e) {
            sendResponse(res, 400, { error: e.message });
        }
        return;
    }
    
    // ============== SERVICE NAMES API ==============
    
    if (pathname === '/api/service-names' && req.method === 'GET') {
        const names = loadServiceNames();
        sendResponse(res, 200, { success: true, service_names: names });
        return;
    }
    
    if (pathname === '/api/service-names' && req.method === 'POST') {
        try {
            const { name } = await parseBody(req);
            
            if (!name || !name.trim()) {
                sendResponse(res, 400, { error: 'Название не может быть пустым' });
                return;
            }
            
            const trimmed = name.trim();
            // Не сохраняем в БД дефолтные подстановки — только реальные названия от пользователя
            const defaultPlaceholders = ['Услуги VPN', 'Услуга'];
            if (defaultPlaceholders.some(p => p === trimmed)) {
                sendResponse(res, 400, { error: 'Это служебное название. Введите своё наименование услуги.' });
                return;
            }
            
            const names = loadServiceNames();
            if (names.includes(trimmed)) {
                sendResponse(res, 400, { error: 'Такое наименование уже существует' });
                return;
            }
            
            names.push(trimmed);
            names.sort();
            saveServiceNames(names);
            sendResponse(res, 200, { success: true, service_names: names });
        } catch (e) {
            sendResponse(res, 400, { error: e.message });
        }
        return;
    }
    
    if (pathname === '/api/service-names/clear' && req.method === 'POST') {
        try {
            saveServiceNames([]);
            sendResponse(res, 200, { success: true, service_names: [] });
        } catch (e) {
            sendResponse(res, 400, { error: e.message });
        }
        return;
    }
    
    if (pathname.startsWith('/api/service-names/') && pathname !== '/api/service-names/clear' && req.method === 'DELETE') {
        try {
            const nameToDelete = decodeURIComponent(pathname.replace('/api/service-names/', ''));
            const names = loadServiceNames();
            const filtered = names.filter(n => n !== nameToDelete);
            saveServiceNames(filtered);
            sendResponse(res, 200, { success: true, service_names: filtered });
        } catch (e) {
            sendResponse(res, 400, { error: e.message });
        }
        return;
    }
    
    // ============== NALOG API ==============
    
    if (pathname === '/api/nalog/check' && req.method === 'POST') {
        const config = loadConfig();
        if (!config?.nalog_login) {
            sendResponse(res, 400, { success: false, error: 'Не настроены данные налоговой' });
            return;
        }
        
        const nalog = getNalogApi(config);
        const result = await nalog.authenticate();
        sendResponse(res, 200, result);
        return;
    }
    
    if (pathname === '/api/nalog/sync' && req.method === 'POST') {
        const config = loadConfig();
        if (!config?.nalog_login) {
            console.warn('⚠️ Попытка синхронизации без настроенных данных налоговой');
            sendResponse(res, 400, { success: false, error: 'Не настроены данные налоговой' });
            return;
        }
        
        console.log('🔄 Запущена синхронизация с налоговой...');
        const syncStartTime = Date.now();
        
        try {
            const nalog = getNalogApi(config);
            
            // Загружаем обычные чеки
            const result = await nalog.getAllIncomes();
            
            if (!result.success) {
                throw new Error(result.error);
            }
            
            console.log(`✅ Получено ${result.incomes.length} активных чеков за ${Date.now() - syncStartTime}мс`);
            
            // Загружаем аннулированные чеки
            const canceledResult = await nalog.getCanceledIncomes();
            
            if (!canceledResult.success) {
                console.warn(`⚠️ Не удалось загрузить аннулированные чеки: ${canceledResult.error}`);
            }
            
            const canceledIncomes = canceledResult.success ? canceledResult.incomes : [];
            console.log(`✅ Получено ${canceledIncomes.length} аннулированных чеков`);
            
            // Объединяем чеки, удаляя дубликаты (приоритет - аннулированным)
            const uuidMap = new Map();
            
            // Сначала добавляем обычные чеки
            result.incomes.forEach(receipt => {
                const uuid = receipt.approvedReceiptUuid || receipt.receiptUuid || receipt.uuid;
                if (uuid) {
                    uuidMap.set(uuid, receipt);
                }
            });
            
            // Затем перезаписываем аннулированными (они имеют приоритет)
            canceledIncomes.forEach(receipt => {
                const uuid = receipt.approvedReceiptUuid || receipt.receiptUuid || receipt.uuid;
                if (uuid) {
                    uuidMap.set(uuid, receipt); // Перезапишет, если был в обычных
                }
            });
            
            const allIncomes = Array.from(uuidMap.values());
            const duplicatesRemoved = (result.incomes.length + canceledIncomes.length) - allIncomes.length;
            
            console.log(`✅ Всего чеков для обработки: ${allIncomes.length} (активных: ${result.incomes.length}, аннулированных: ${canceledIncomes.length}${duplicatesRemoved > 0 ? `, удалено дублей: ${duplicatesRemoved}` : ''})`);
            
            if (allIncomes.length > 0) {
                
                // Сохраняем в кэш
                const saveSuccess = saveTaxReceipts({
                    receipts: allIncomes,
                    lastSync: new Date().toISOString()
                });
                
                if (!saveSuccess) {
                    console.error('❌ Не удалось сохранить кэш налоговой в БД');
                    sendResponse(res, 500, { 
                        success: false, 
                        error: 'Не удалось сохранить данные в базу. Проверьте логи сервера.'
                    });
                    return;
                }
                
                // Сопоставляем с нашими платежами (передаём оба UUID: в БД может быть request id, в кэше — approved)
                const updates = allIncomes
                    .map(taxReceipt => {
                        const isCanceled = taxReceipt.cancellationInfo || taxReceipt.canceledInfo || taxReceipt.cancelledInfo || taxReceipt.canceled || taxReceipt.status === 'CANCELED' || false;
                        const primary = taxReceipt.approvedReceiptUuid || taxReceipt.receiptUuid || taxReceipt.uuid;
                        const alt = taxReceipt.receiptUuid && taxReceipt.receiptUuid !== primary ? taxReceipt.receiptUuid : (taxReceipt.approvedReceiptUuid && taxReceipt.approvedReceiptUuid !== primary ? taxReceipt.approvedReceiptUuid : null);
                        return {
                            receipt_uuid: primary,
                            receipt_uuid_alt: alt || undefined,
                            sent_at: taxReceipt.operationTime || taxReceipt.requestTime || new Date().toISOString(),
                            is_canceled: isCanceled,
                            canceled_at: isCanceled ? 
                                (taxReceipt.cancellationInfo?.operationTime || taxReceipt.canceledInfo?.requestTime || taxReceipt.cancelledInfo?.requestTime || taxReceipt.canceledAt || new Date().toISOString()) 
                                : null
                        };
                    })
                    .filter(item => !!item.receipt_uuid);

                const updated = updates.length > 0 ? markReceiptsSentByUuids(updates) : 0;
                const canceledFromSync = updates.filter(u => u.is_canceled).length;
                
                console.log(`✅ Синхронизация завершена: загружено ${allIncomes.length}, обновлено статусов ${updated}${canceledFromSync > 0 ? `, аннулировано ${canceledFromSync}` : ''}`);
                
                sendResponse(res, 200, { 
                    success: true, 
                    count: allIncomes.length,
                    active: result.incomes.length,
                    canceled: canceledIncomes.length,
                    updated: updated,
                    matched: updated,
                    lastSync: new Date().toISOString()
                });
            } else {
                // Нет чеков
                sendResponse(res, 200, { 
                    success: true, 
                    count: 0,
                    active: 0,
                    canceled: 0,
                    updated: 0,
                    matched: 0,
                    lastSync: new Date().toISOString()
                });
            }
        } catch (e) {
            console.error('❌ Критическая ошибка при синхронизации:', e);
            console.error('Stack trace:', e.stack);
            sendResponse(res, 500, { 
                success: false, 
                error: `Критическая ошибка: ${e.message}. Проверьте логи сервера.`
            });
        }
        return;
    }
    
    if (pathname === '/api/nalog/incomes' && req.method === 'GET') {
        const { receipts, lastSync } = loadTaxReceipts();
        sendResponse(res, 200, { 
            success: true, 
            incomes: receipts,
            lastSync: lastSync 
        });
        return;
    }
    
    // ============== PAYMENTS API ==============
    
    if (pathname === '/api/payments' && req.method === 'GET') {
        const config = loadConfig();
        if (!config?.yookassa_shop_id) {
            sendResponse(res, 400, { error: 'Не настроены данные YooKassa' });
            return;
        }
        
        try {
            const ignoreDates = query.ignore_dates === '1';
            const payments = await getPayments(config, ignoreDates ? null : query.date_from, ignoreDates ? null : query.date_to);
            
            // Используем все успешные платежи (не фильтруем по описанию)
            const filteredPayments = payments;
            
            const { receipts: taxReceipts } = loadTaxReceiptsLite();
            const taxReceiptsByUuid = new Map();
            const taxReceiptQuickMatch = new Set();
            const taxReceiptByDateAmount = new Map();

            taxReceipts.forEach(tr => {
                const isCanceled = !!(tr.is_canceled === 1 || tr.is_canceled === true);
                if (isCanceled) return;
                const trUuid = tr.receipt_uuid;
                const trAmount = parseFloat(tr.total_amount || 0);
                const trDate = (tr.operation_time || tr.request_time || '').split('T')[0];
                if (trUuid) {
                    taxReceiptsByUuid.set(trUuid, {
                        receipt_uuid: trUuid,
                        total_amount: tr.total_amount,
                        operation_time: tr.operation_time,
                        request_time: tr.request_time,
                        service_name: tr.service_name
                    });
                }
                if (trDate) {
                    const key = `${trDate}|${trAmount.toFixed(2)}`;
                    taxReceiptQuickMatch.add(key);
                    if (!taxReceiptByDateAmount.has(key)) {
                        taxReceiptByDateAmount.set(key, tr);
                    }
                }
            });

            const paymentIds = filteredPayments.map(p => p.id);
            const receiptsByPaymentId = getReceiptsByPaymentIds(paymentIds);
            // Ключ date|amount -> сколько платежей без локального чека имеют этот ключ (нужно для однозначности)
            const keyCountNoReceipt = new Map();
            filteredPayments.forEach(p => {
                const localReceipt = receiptsByPaymentId.get(p.id);
                if (localReceipt) return;
                const paidAt = p.captured_at || p.created_at;
                const amount = p.amount?.value || 0;
                const dateStr = getMoscowDateStr(paidAt);
                const key = `${dateStr}|${parseFloat(amount).toFixed(2)}`;
                keyCountNoReceipt.set(key, (keyCountNoReceipt.get(key) || 0) + 1);
            });

            // Один чек в налоговой (один receipt_uuid) — только одному платежу: первый по времени оплаты получает «Отправлен»
            const usedTaxReceiptUuids = new Set();
            const sortedPayments = [...filteredPayments].sort((a, b) => {
                const ta = a.captured_at || a.created_at || '';
                const tb = b.captured_at || b.created_at || '';
                return ta.localeCompare(tb) || (a.id || '').localeCompare(b.id || '');
            });

            const paymentsWithReceipts = sortedPayments.map(p => {
                const localReceipt = receiptsByPaymentId.get(p.id);
                const paidAt = p.captured_at || p.created_at;
                const amount = p.amount?.value || 0;
                
                let taxReceipt = null;
                if (localReceipt?.receipt_uuid) {
                    taxReceipt = taxReceiptsByUuid.get(localReceipt.receipt_uuid);
                }
                
                let matchedInTax = false;
                let matchedTaxReceipt = null;
                if (!localReceipt) {
                    const dateStr = getMoscowDateStr(paidAt);
                    const key = `${dateStr}|${parseFloat(amount).toFixed(2)}`;
                    const uniqueKey = keyCountNoReceipt.get(key) === 1;
                    if (taxReceiptQuickMatch.has(key) && uniqueKey) {
                        matchedTaxReceipt = taxReceiptByDateAmount.get(key);
                        const uuid = matchedTaxReceipt?.receipt_uuid;
                        if (uuid && !usedTaxReceiptUuids.has(uuid)) {
                            matchedInTax = true;
                            usedTaxReceiptUuids.add(uuid);
                        }
                    }
                }
                
                // По UUID: «Отправлен» только если этот receipt_uuid ещё не использован другим платежом
                let inTax = false;
                if (taxReceipt?.receipt_uuid) {
                    if (!usedTaxReceiptUuids.has(taxReceipt.receipt_uuid)) {
                        inTax = true;
                        usedTaxReceiptUuids.add(taxReceipt.receipt_uuid);
                    }
                } else {
                    inTax = matchedInTax;
                }
                const nalogLogin = config?.nalog_login || '';
                // Чек привязываем только по payment_id (localReceipt) или при реальном совпадении (matchedInTax).
                // Иначе два платежа с одной суммой и датой получали бы один и тот же receipt_uuid/print — баг.
                const receiptUuid = localReceipt?.receipt_uuid || (matchedInTax && matchedTaxReceipt?.receipt_uuid) || null;
                const receiptUrlPrint = localReceipt?.receipt_url_print || 
                    (receiptUuid && nalogLogin ? `https://lknpd.nalog.ru/api/v1/receipt/${nalogLogin}/${receiptUuid}/print` : null);
                // Локальная БД — источник истины для статуса (отражает последние действия пользователя).
                // Кэш налоговой — вторичный источник для чеков без локальной записи.
                let effectiveStatus;
                if (localReceipt) {
                    effectiveStatus = localReceipt.status || 'pending';
                } else if (inTax) {
                    effectiveStatus = 'sent';
                } else {
                    effectiveStatus = 'pending';
                }
                // Если чек аннулирован или с ошибкой — не считаем его «в налоговой»
                const effectiveInTax = (effectiveStatus === 'canceled' || effectiveStatus === 'error') ? false : inTax;
                const matchedReceipt = matchedInTax ? matchedTaxReceipt : null;
                return {
                    id: p.id,
                    amount: amount,
                    currency: p.amount?.currency || 'RUB',
                    description: p.description,
                    created_at: p.created_at,
                    paid_at: paidAt,
                    payment_method: p.payment_method?.type || 'unknown',
                    metadata: p.metadata || {},
                    receipt_status: effectiveStatus,
                    receipt_uuid: receiptUuid,
                    receipt_url_print: receiptUrlPrint,
                    service_name: localReceipt?.service_name || matchedReceipt?.service_name || null,
                    receipt_amount: localReceipt?.amount || null,
                    receipt_date: localReceipt?.sale_date || null,
                    error_message: localReceipt?.error_message || null,
                    canceled_at: localReceipt?.canceled_at || null,
                    sent_at: localReceipt?.sent_at || null,
                    in_tax_service: effectiveInTax,
                    tax_service_name: taxReceipt?.service_name || matchedReceipt?.service_name || null,
                    tax_amount: taxReceipt?.total_amount || matchedReceipt?.total_amount || null
                };
            });
            
            sendResponse(res, 200, { success: true, payments: paymentsWithReceipts });
        } catch (e) {
            sendResponse(res, 500, { error: e.message });
        }
        return;
    }
    
    // ============== SEND RECEIPT API ==============
    
    if (pathname === '/api/send-receipt' && req.method === 'POST') {
        const config = loadConfig();
        if (!config?.nalog_login) {
            console.warn('⚠️ Попытка отправить чек без настроенных данных налоговой');
            sendResponse(res, 400, { error: 'Не настроены данные налоговой' });
            return;
        }
        
        try {
            const data = await parseBody(req);
            const existingReceipt = getReceiptByPaymentId(data.payment_id);
            if (existingReceipt && existingReceipt.status === 'sent') {
                console.log(`⚠️ Чек для платежа ${data.payment_id} уже отправлен в налоговую, повторная отправка отклонена`);
                sendResponse(res, 200, {
                    success: true,
                    alreadySent: true,
                    receiptUuid: existingReceipt.receipt_uuid || null,
                    receiptUrlPrint: existingReceipt.receipt_url_print || null
                });
                return;
            }
            console.log(`📤 Отправка чека: платёж ${data.payment_id}, услуга "${data.service_name}", сумма ${data.amount}₽`);
            
            const nalog = getNalogApi(config);
            
            const result = await nalog.createReceipt({
                name: data.service_name || 'Услуги VPN',
                amount: data.amount,
                sale_date: data.sale_date,
                paymentType: 'WIRE'
            });
            
            if (result.success) {
                console.log(`✅ Чек успешно отправлен: UUID ${result.receiptUuid}`);
                
                const saveSuccess = saveReceipt({
                    payment_id: data.payment_id,
                    receipt_uuid: result.receiptUuid,
                    status: 'sent',
                    receipt_url_print: result.receiptUrlPrint,
                    receipt_url_json: result.receiptUrlJson,
                    service_name: data.service_name,
                    amount: data.amount,
                    sale_date: data.sale_date,
                    sent_at: new Date().toISOString(),
                    // Очищаем старые поля ошибок при повторной отправке
                    error_message: null,
                    error_at: null,
                    canceled_at: null
                });
                
                if (!saveSuccess) {
                    console.error('❌ Не удалось сохранить информацию о чеке в БД');
                }
                
                // Автоматическая проверка статуса - ОДНА попытка через 10 секунд
                // (Даем налоговой время на обработку и появление в списке чеков)
                (async () => {
                    try {
                        await new Promise(r => setTimeout(r, 10000));
                        
                        const checkResult = await nalog.getReceiptByUuid(result.receiptUuid);
                        if (checkResult.success && checkResult.receipt) {
                            const receipt = checkResult.receipt;
                            
                            // Сохраняем в кеш налоговой (с проверкой дублей)
                            const { receipts } = loadTaxReceipts();
                            const receiptUuid = receipt.approvedReceiptUuid || receipt.receiptUuid || receipt.uuid;
                            
                            // Проверяем, нет ли уже этого чека в кэше
                            const existingIndex = receipts.findIndex(r => {
                                const uuid = r.approvedReceiptUuid || r.receiptUuid || r.uuid;
                                return uuid === receiptUuid;
                            });
                            
                            if (existingIndex >= 0) {
                                receipts[existingIndex] = receipt;
                                console.log(`🔄 Обновлён чек в кэше: ${receiptUuid}`);
                            } else {
                                receipts.push(receipt);
                                console.log(`➕ Добавлен новый чек в кэш: ${receiptUuid}`);
                            }
                            
                            saveTaxReceipts({
                                receipts: receipts,
                                lastSync: new Date().toISOString()
                            });
                            
                            console.log(`✅ Чек ${receiptUuid} успешно подтвержден налоговой`);
                        } else if (checkResult.notFound) {
                            console.log(`⏳ Чек ${result.receiptUuid} обрабатывается налоговой (требуется время)`);
                        }
                    } catch (asyncErr) {
                        console.error('❌ Ошибка при автопроверке чека:', asyncErr.message);
                    }
                })();
            } else {
                console.error(`❌ Ошибка отправки чека: ${result.error}`);
                // Сохраняем ошибку только если чек ещё не отправлен/аннулирован (не перезаписываем финальные статусы)
                const mayOverwrite = !existingReceipt || (existingReceipt.status !== 'sent' && existingReceipt.status !== 'canceled');
                if (mayOverwrite) {
                    saveReceipt({
                        payment_id: data.payment_id,
                        status: 'error',
                        error_message: result.error,
                        service_name: data.service_name,
                        amount: data.amount,
                        sale_date: data.sale_date,
                        error_at: new Date().toISOString()
                    });
                }
            }
            
            sendResponse(res, 200, result);
        } catch (e) {
            console.error('❌ Критическая ошибка при отправке чека:', e);
            console.error('Stack trace:', e.stack);
            sendResponse(res, 400, { error: e.message });
        }
        return;
    }
    
    // ============== CHECK RECEIPT STATUS API ==============
    
    if (pathname === '/api/check-receipt' && req.method === 'POST') {
        const config = loadConfig();
        if (!config?.nalog_login) {
            sendResponse(res, 400, { error: 'Не настроены данные налоговой' });
            return;
        }
        
        try {
            const data = await parseBody(req);
            console.log(`🔍 Проверка статуса чека: ${data.receipt_uuid}`);
            
            const nalog = getNalogApi(config);
            const result = await nalog.getReceiptByUuid(data.receipt_uuid);
            
            if (result.success) {
                console.log(`✅ Чек найден в налоговой:`, data.receipt_uuid);
            } else if (result.notFound) {
                console.log(`⏳ Чек еще не появился в налоговой:`, data.receipt_uuid);
            } else {
                console.log(`❌ Ошибка при проверке чека:`, result.error);
            }
            
            if (result.success && result.receipt) {
                const receipt = result.receipt;
                const serviceName = receipt.services?.[0]?.name || '';
                const totalAmount = parseFloat(receipt.totalAmount || receipt.amount || 0);
                const isCanceled = result.isCanceled || false;
                
                // Обновляем кеш налоговой
                const { receipts } = loadTaxReceipts();
                const existingIndex = receipts.findIndex(r => 
                    (r.approvedReceiptUuid || r.receiptUuid || r.uuid) === data.receipt_uuid
                );
                
                if (existingIndex >= 0) {
                    receipts[existingIndex] = receipt;
                } else {
                    receipts.push(receipt);
                }
                
                saveTaxReceipts({
                    receipts: receipts,
                    lastSync: new Date().toISOString()
                });
                
                console.log(`💾 Сохранены данные чека: ${serviceName} - ${totalAmount} ₽${isCanceled ? ' (АННУЛИРОВАН)' : ''}`);
                
                // Если чек аннулирован - обновляем статус в БД и кэше
                if (isCanceled) {
                    const canceledAt = receipt.cancellationInfo?.operationTime || receipt.canceledInfo?.requestTime || receipt.cancelledInfo?.requestTime || new Date().toISOString();
                    
                    updateReceiptStatusByUuid(data.receipt_uuid, 'canceled', {
                        canceled_at: canceledAt,
                        synced_from_tax: 1
                    });
                    markTaxReceiptCanceled(data.receipt_uuid);
                    
                    console.log(`🚫 Чек ${data.receipt_uuid} помечен как аннулированный в БД и кэше`);
                }
                
                sendResponse(res, 200, { 
                    success: true,
                    is_canceled: isCanceled,
                    receipt: {
                        service_name: serviceName,
                        total_amount: totalAmount,
                        operation_time: receipt.operationTime,
                        request_time: receipt.requestTime,
                        canceled_info: isCanceled ? (receipt.canceledInfo || receipt.cancelledInfo) : null
                    }
                });
            } else {
                sendResponse(res, 200, result);
            }
        } catch (e) {
            sendResponse(res, 400, { error: e.message });
        }
        return;
    }
    
    // ============== CANCEL RECEIPT API ==============
    
    if (pathname === '/api/cancel-receipt' && req.method === 'POST') {
        const config = loadConfig();
        if (!config?.nalog_login) {
            sendResponse(res, 400, { error: 'Не настроены данные налоговой' });
            return;
        }
        
        try {
            const data = await parseBody(req);
            const nalog = getNalogApi(config);
            
            const result = await nalog.cancelReceipt(data.receipt_uuid, data.reason || 'CANCEL');
            
            if (result.success) {
                console.log(`🚫 Аннулирование чека ${data.receipt_uuid}: обновляем локальную БД и кэш налоговой`);
                updateReceiptStatusByUuid(data.receipt_uuid, 'canceled', {
                    canceled_at: new Date().toISOString()
                });
                markTaxReceiptCanceled(data.receipt_uuid);
                // Верификация: проверяем что статус действительно записался
                const verifyReceipt = getReceiptByPaymentId(data.payment_id);
                console.log(`🔍 Верификация после аннулирования: payment_id=${data.payment_id}, status=${verifyReceipt?.status}, receipt_uuid=${verifyReceipt?.receipt_uuid}`);
            }
            
            sendResponse(res, 200, result);
        } catch (e) {
            sendResponse(res, 400, { error: e.message });
        }
        return;
    }
    
    // ============== STATS API ==============
    
    if (pathname === '/api/stats' && req.method === 'GET') {
        const config = loadConfig();
        if (!config?.yookassa_shop_id) {
            sendResponse(res, 200, { 
                pending: 0, 
                sent: 0, 
                total_amount: 0,
                today_sent: 0,
                today_amount: 0,
                week_sent: 0
            });
            return;
        }
        
        try {
            const payments = await getPayments(config, null, null);
            // Используем все успешные платежи (не фильтруем по описанию)
            const filteredPayments = payments;
            
            // Загружаем данные из налоговой для проверки
            const { receipts: taxReceipts } = loadTaxReceiptsLite();
            const canceledTaxUuids = getCanceledReceiptUuidsFromTaxCache();
            const taxReceiptQuickMatch = new Set();
            taxReceipts.forEach(tr => {
                const isCanceled = tr.is_canceled === 1 || tr.is_canceled === true || tr.is_canceled === '1';
                if (isCanceled) return;
                const trAmount = parseFloat(tr.total_amount || 0);
                const trDate = (tr.operation_time || tr.request_time || '').split('T')[0];
                if (trDate) {
                    taxReceiptQuickMatch.add(`${trDate}|${trAmount.toFixed(2)}`);
                }
            });
            
            const now = new Date();
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const yesterdayStart = new Date(todayStart);
            yesterdayStart.setDate(yesterdayStart.getDate() - 1);
            const weekStart = new Date(now);
            weekStart.setDate(weekStart.getDate() - 7);
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
            const quarterStart = new Date(now.getFullYear(), quarterMonth, 1);
            const yearStart = new Date(now.getFullYear(), 0, 1);
            
            let pending = 0, sent = 0, totalAmount = 0;
            
            // Статистика по отправленным чекам по периодам
            const sentByPeriod = {
                today: { count: 0, amount: 0 },
                yesterday: { count: 0, amount: 0 },
                week: { count: 0, amount: 0 },
                month: { count: 0, amount: 0 },
                quarter: { count: 0, amount: 0 },
                year: { count: 0, amount: 0 },
                all: { count: 0, amount: 0 }
            };
            
            const paymentIds = filteredPayments.map(p => p.id);
            const receiptsByPaymentId = getReceiptsByPaymentIds(paymentIds);
            const keyCountNoReceiptStats = new Map();
            filteredPayments.forEach(p => {
                if (receiptsByPaymentId.get(p.id)) return;
                const paidAt = p.captured_at || p.created_at;
                const amount = parseFloat(p.amount?.value || 0);
                const dateStr = getMoscowDateStr(paidAt);
                const key = `${dateStr}|${amount.toFixed(2)}`;
                keyCountNoReceiptStats.set(key, (keyCountNoReceiptStats.get(key) || 0) + 1);
            });

            for (const p of filteredPayments) {
                const receipt = receiptsByPaymentId.get(p.id);
                const amount = parseFloat(p.amount?.value || 0);
                const paidAt = p.captured_at || p.created_at;
                
                let inTaxService = false;
                if (!receipt) {
                    const dateStr = getMoscowDateStr(paidAt);
                    const key = `${dateStr}|${amount.toFixed(2)}`;
                    const uniqueKey = keyCountNoReceiptStats.get(key) === 1;
                    inTaxService = taxReceiptQuickMatch.has(key) && uniqueKey;
                }
                
                const isCanceledInTax = receipt?.receipt_uuid ? canceledTaxUuids.has(receipt.receipt_uuid) : false;
                const isCanceled = receipt?.status === 'canceled' || isCanceledInTax;
                const isSent = (receipt?.status === 'sent' || inTaxService) && !isCanceled;
                
                if (isSent) {
                    sent++;
                    
                    // Для статистики по времени: sent_at из чека или paid_at как fallback
                    const sentAt = receipt?.sent_at || paidAt;
                    if (sentAt) {
                        const sentDate = new Date(sentAt);
                        
                        // Все время — всегда добавляем
                        sentByPeriod.all.count++;
                        sentByPeriod.all.amount += amount;
                        
                        // Сегодня
                        if (sentDate >= todayStart) {
                            sentByPeriod.today.count++;
                            sentByPeriod.today.amount += amount;
                        }
                        
                        // Вчера
                        if (sentDate >= yesterdayStart && sentDate < todayStart) {
                            sentByPeriod.yesterday.count++;
                            sentByPeriod.yesterday.amount += amount;
                        }
                        
                        // Неделя
                        if (sentDate >= weekStart) {
                            sentByPeriod.week.count++;
                            sentByPeriod.week.amount += amount;
                        }
                        
                        // Месяц
                        if (sentDate >= monthStart) {
                            sentByPeriod.month.count++;
                            sentByPeriod.month.amount += amount;
                        }
                        
                        // Квартал
                        if (sentDate >= quarterStart) {
                            sentByPeriod.quarter.count++;
                            sentByPeriod.quarter.amount += amount;
                        }
                        
                        // Год
                        if (sentDate >= yearStart) {
                            sentByPeriod.year.count++;
                            sentByPeriod.year.amount += amount;
                        }
                    }
                } else if (!isCanceled) {
                    pending++;
                    totalAmount += amount;
                }
            }
            
            // Расчет заработка (все поступления от ЮКассы) по периодам
            const earnings = {
                today: 0,
                yesterday: 0,
                week: 0,
                month: 0,
                year: 0,
                all: 0
            };
            
            for (const p of filteredPayments) {
                const amount = parseFloat(p.amount?.value || 0);
                const paidAt = p.captured_at || p.created_at;
                const paidDate = paidAt ? new Date(paidAt) : null;
                
                if (paidDate) {
                    // Все время
                    earnings.all += amount;
                    
                    // Сегодня
                    if (paidDate >= todayStart) {
                        earnings.today += amount;
                    }
                    
                    // Вчера
                    if (paidDate >= yesterdayStart && paidDate < todayStart) {
                        earnings.yesterday += amount;
                    }
                    
                    // Неделя
                    if (paidDate >= weekStart) {
                        earnings.week += amount;
                    }
                    
                    // Месяц
                    if (paidDate >= monthStart) {
                        earnings.month += amount;
                    }
                    
                    // Год
                    if (paidDate >= yearStart) {
                        earnings.year += amount;
                    }
                }
            }
            
            // Расчет разницы между ЮКасса и налоговой по периодам
            const differences = {
                today: { yookassa: 0, tax: 0 },
                week: { yookassa: 0, tax: 0 },
                month: { yookassa: 0, tax: 0 },
                quarter: { yookassa: 0, tax: 0 },
                all: { yookassa: 0, tax: 0 }
            };
            
            for (const p of filteredPayments) {
                const receipt = receiptsByPaymentId.get(p.id);
                const yookassaAmount = parseFloat(p.amount?.value || 0);
                const taxAmount = receipt?.amount ? parseFloat(receipt.amount) : 0;
                const paidAt = p.captured_at || p.created_at;
                const paidDate = paidAt ? new Date(paidAt) : null;
                
                if (receipt?.status === 'sent' && paidDate) {
                    // Все время
                    differences.all.yookassa += yookassaAmount;
                    differences.all.tax += taxAmount;
                    
                    // Сегодня
                    if (paidDate >= todayStart) {
                        differences.today.yookassa += yookassaAmount;
                        differences.today.tax += taxAmount;
                    }
                    
                    // Неделя
                    if (paidDate >= weekStart) {
                        differences.week.yookassa += yookassaAmount;
                        differences.week.tax += taxAmount;
                    }
                    
                    // Месяц
                    if (paidDate >= monthStart) {
                        differences.month.yookassa += yookassaAmount;
                        differences.month.tax += taxAmount;
                    }
                    
                    // Квартал
                    if (paidDate >= quarterStart) {
                        differences.quarter.yookassa += yookassaAmount;
                        differences.quarter.tax += taxAmount;
                    }
                }
            }
            
            const { lastSync } = loadTaxReceipts();
            
            sendResponse(res, 200, { 
                pending, 
                sent, 
                total_amount: totalAmount,
                sent_by_period: sentByPeriod,
                earnings: earnings,
                differences: differences,
                last_sync: lastSync
            });
        } catch (e) {
            sendResponse(res, 500, { error: e.message });
        }
        return;
    }
    
    // 404
    sendResponse(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error('Ошибка обработки запроса:', e.message);
    try {
        sendResponse(res, 500, { error: 'Internal server error' });
    } catch (ignored) {}
  }
}

module.exports = { handleRequest };
