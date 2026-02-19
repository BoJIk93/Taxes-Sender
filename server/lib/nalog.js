const crypto = require('crypto');
const { makeRequest } = require('./http');

class NalogApi {
    constructor(login, password, timezone = 'Europe/Moscow') {
        this.login = login;
        this.password = password;
        this.timezone = timezone;
        this.refreshToken = null;
        this.accessToken = null;
        this.deviceId = crypto.randomUUID();
    }
    
    getDeviceInfo() {
        return {
            sourceDeviceId: this.deviceId,
            sourceType: 'WEB',
            appVersion: '1.0.0',
            metaDetails: {
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                platform: 'WEB'
            }
        };
    }
    
    async authenticate() {
        const maxRetries = 3;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const authData = JSON.stringify({
                username: this.login,
                password: this.password,
                deviceInfo: this.getDeviceInfo()
            });
            
            const options = {
                hostname: 'lknpd.nalog.ru',
                port: 443,
                path: '/api/v1/auth/lkfl',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(authData),
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            };
            
            try {
                if (attempt > 1) console.log(`🔐 Авторизация (попытка ${attempt}/${maxRetries})...`);
                const response = await makeRequest(options, authData);
                
                if (response.statusCode === 200 && response.data) {
                    this.refreshToken = response.data.refreshToken || response.data.refresh_token;
                    this.accessToken = response.data.token || response.data.accessToken;
                    return { success: true };
                }
                
                console.warn(`⚠️ Авторизация не удалась: статус ${response.statusCode}`);
                return { 
                    success: false, 
                    error: response.data?.message || `Ошибка авторизации: ${response.statusCode}`,
                    needsSms: response.data?.requireSms || false
                };
            } catch (e) {
                if (attempt === 1) console.warn(`⚠️ Налоговая timeout, повтор...`);
                
                if (attempt < maxRetries) {
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                    await new Promise(r => setTimeout(r, delay));
                } else {
                    console.error(`❌ Не удалось авторизоваться после ${maxRetries} попыток`);
                    return { success: false, error: e.message };
                }
            }
        }
        
        return { success: false, error: 'Не удалось авторизоваться' };
    }
    
    async getAccessToken() {
        if (!this.refreshToken) {
            return this.authenticate();
        }
        
        const maxRetries = 3;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const tokenData = JSON.stringify({
                refreshToken: this.refreshToken,
                deviceInfo: this.getDeviceInfo()
            });
            
            const options = {
                hostname: 'lknpd.nalog.ru',
                port: 443,
                path: '/api/v1/auth/token',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(tokenData),
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            };
            
            try {
                const response = await makeRequest(options, tokenData);
                
                if (response.statusCode === 200 && response.data) {
                    this.accessToken = response.data.token || response.data.accessToken;
                    return { success: true };
                }
                
                if (response.statusCode === 401) {
                    return this.authenticate();
                }
                
                console.warn(`⚠️ Обновление токена не удалось: статус ${response.statusCode}`);
                return { success: false, error: `Ошибка получения токена: ${response.statusCode}` };
            } catch (e) {
                if (attempt < maxRetries) {
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                    await new Promise(r => setTimeout(r, delay));
                } else {
                    return this.authenticate();
                }
            }
        }
        
        return { success: false, error: 'Не удалось обновить токен' };
    }
    
    async createReceipt(args) {
        if (!this.accessToken) {
            const authResult = await this.getAccessToken();
            if (!authResult.success) {
                return authResult;
            }
        }
        
        // Получаем текущее московское время (UTC+3)
        const getMoscowTime = () => {
            const now = new Date();
            const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
            return new Date(utcTime + (3 * 3600000)); // +3 часа
        };
        
        // Парсим дату как московское время (если приходит без таймзоны — это МСК с фронта)
        const parseMoscowDate = (dateStr) => {
            if (!dateStr) return null;
            
            // Если уже в ISO формате с Z или +XX:XX — парсим как есть
            if (dateStr.includes('Z') || dateStr.match(/[+-]\d{2}:\d{2}$/)) {
                return new Date(dateStr);
            }
            // Строка без таймзоны (например "2026-02-17T00:04" из datetime-local) — это МСК.
            // Иначе сервер в UTC трактует как 00:04 UTC и дата/время в налоговой расходятся с сайтом.
            let normalized = String(dateStr).trim();
            if (normalized.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)) {
                normalized += ':00';
            }
            if (!normalized.match(/[+-]\d{2}:\d{2}$/)) {
                normalized += '+03:00';
            }
            return new Date(normalized);
        };
        
        const nowMoscow = getMoscowTime();
        let operationTime;
        
        if (args.sale_date) {
            // Парсим дату как московское время
            operationTime = parseMoscowDate(args.sale_date);
            
            // Проверяем, что время не в будущем относительно московского времени
            if (operationTime > nowMoscow) {
                console.log(`⚠️ operationTime (${operationTime.toISOString()}) в будущем относительно МСК, используем текущее московское время: ${nowMoscow.toISOString()}`);
                operationTime = nowMoscow;
            }
        } else {
            operationTime = nowMoscow;
        }
        
        // requestTime должен быть >= operationTime
        // Всегда используем текущее московское время для requestTime
        let requestTime = nowMoscow;
        if (requestTime < operationTime) {
            // Если по какой-то причине requestTime < operationTime, 
            // делаем requestTime = operationTime + 1 сек
            requestTime = new Date(operationTime.getTime() + 1000);
        }
        
        const formatDateTime = (date) => {
            const offset = '+03:00';
            return date.toISOString().replace('Z', '').split('.')[0] + offset;
        };
        
        const incomeData = JSON.stringify({
            operationTime: formatDateTime(operationTime),
            requestTime: formatDateTime(requestTime),
            services: [{
                name: args.name,
                amount: parseFloat(args.amount),
                quantity: parseInt(args.quantity || 1)
            }],
            totalAmount: String(parseFloat(args.amount)),
            client: {
                contactPhone: args.clientContactPhone || null,
                displayName: args.clientDisplayName || null,
                inn: args.clientInn || null,
                incomeType: args.incomeType || 'FROM_INDIVIDUAL'
            },
            paymentType: args.paymentType || 'WIRE',
            ignoreMaxTotalIncomeRestriction: false
        });
        
        const maxRetries = 3;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const options = {
                hostname: 'lknpd.nalog.ru',
                port: 443,
                path: '/api/v1/income',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(incomeData),
                    'Authorization': `Bearer ${this.accessToken}`,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            };
            
            try {
                if (attempt > 1) console.log(`📤 Отправка чека (попытка ${attempt}/${maxRetries})...`);
                const response = await makeRequest(options, incomeData);
                
                if (response.statusCode === 200 || response.statusCode === 201) {
                    const receiptUuid = response.data?.approvedReceiptUuid || response.data?.receiptUuid;
                    if (receiptUuid) {
                        console.log(`✅ Чек создан: ${receiptUuid}`);
                        return {
                            success: true,
                            receiptUuid: receiptUuid,
                            receiptUrlPrint: `https://lknpd.nalog.ru/api/v1/receipt/${this.login}/${receiptUuid}/print`,
                            receiptUrlJson: `https://lknpd.nalog.ru/api/v1/receipt/${this.login}/${receiptUuid}/json`
                        };
                    }
                }
                
                // Если 401 - токен истёк, обновляем и пробуем еще раз
                if (response.statusCode === 401 && attempt < maxRetries) {
                    const authResult = await this.getAccessToken();
                    if (authResult.success) {
                        continue; // Повторяем попытку с новым токеном
                    }
                }
                
                console.warn(`⚠️ Отправка чека не удалась: статус ${response.statusCode}`);
                return { 
                    success: false, 
                    error: response.data?.message || response.data?.errors?.[0] || `Ошибка: ${response.statusCode}` 
                };
            } catch (e) {
                if (attempt === 1) console.warn(`⚠️ Налоговая timeout, повтор...`);
                
                if (attempt < maxRetries) {
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                    await new Promise(r => setTimeout(r, delay));
                } else {
                    console.error(`❌ Не удалось отправить чек после ${maxRetries} попыток`);
                    return { success: false, error: e.message };
                }
            }
        }
        
        return { success: false, error: 'Не удалось отправить чек' };
    }
    
    async cancelReceipt(receiptUuid, reason = 'CANCEL') {
        if (!this.accessToken) {
            const authResult = await this.getAccessToken();
            if (!authResult.success) {
                return authResult;
            }
        }
        
        const now = new Date();
        const formatDateTime = (date) => {
            const offset = '+03:00';
            return date.toISOString().replace('Z', '').split('.')[0] + offset;
        };
        
        const reasonText = reason === 'REFUND' ? 'Возврат средств' : 'Чек сформирован ошибочно';
        
        const cancelData = JSON.stringify({
            operationTime: formatDateTime(now),
            requestTime: formatDateTime(now),
            receiptUuid: receiptUuid,
            comment: reasonText,
            partnerCode: null
        });
        
        const maxRetries = 3;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const options = {
                hostname: 'lknpd.nalog.ru',
                port: 443,
                path: '/api/v1/cancel',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(cancelData),
                    'Authorization': `Bearer ${this.accessToken}`,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            };
            
            try {
                if (attempt > 1) console.log(`❌ Аннулирование (попытка ${attempt}/${maxRetries})...`);
                const response = await makeRequest(options, cancelData);
                
                if (response.statusCode === 200) {
                    console.log(`✅ Чек аннулирован`);
                    return { success: true };
                }
                
                // Если 401 - токен истёк, обновляем и пробуем еще раз
                if (response.statusCode === 401 && attempt < maxRetries) {
                    const authResult = await this.getAccessToken();
                    if (authResult.success) {
                        continue; // Повторяем попытку с новым токеном
                    }
                }
                
                console.warn(`⚠️ Аннулирование чека не удалось: статус ${response.statusCode}`);
                return { success: false, error: response.data?.message || `Ошибка: ${response.statusCode}` };
            } catch (e) {
                if (attempt < maxRetries) {
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                    await new Promise(r => setTimeout(r, delay));
                } else {
                    console.error(`❌ Не удалось аннулировать чек после ${maxRetries} попыток`);
                    return { success: false, error: e.message };
                }
            }
        }
        
        return { success: false, error: 'Не удалось аннулировать чек' };
    }
    
    async getIncomes(limit = 100, offset = 0, receiptType = null) {
        if (!this.accessToken) {
            const authResult = await this.getAccessToken();
            if (!authResult.success) {
                return authResult;
            }
        }
        
        let path = `/api/v1/incomes?limit=${limit}&offset=${offset}&sortBy=operation_time:desc`;
        if (receiptType) {
            path += `&receiptType=${receiptType}`;
        }
        
        const options = {
            hostname: 'lknpd.nalog.ru',
            port: 443,
            path: path,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        };
        
        try {
            const response = await makeRequest(options);
            if (response.statusCode === 200) {
                let items = [];
                if (Array.isArray(response.data)) {
                    items = response.data.filter(item => 
                        item && typeof item === 'object' && 
                        (item.approvedReceiptUuid || item.receiptUuid || item.uuid)
                    );
                } else if (response.data?.content) {
                    items = response.data.content.filter(item => 
                        item && typeof item === 'object' &&
                        (item.approvedReceiptUuid || item.receiptUuid || item.uuid)
                    );
                }
                return { success: true, incomes: items };
            }
            return { success: false, error: `Ошибка: ${response.statusCode}` };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }
    
    async getAllIncomes() {
        const allIncomes = [];
        let offset = 0;
        const limit = 100;
        let hasMore = true;
        const maxRetries = 3;
        
        console.log('🔄 Начинаем загрузку чеков из налоговой...');
        
        while (hasMore) {
            let success = false;
            let lastError = null;
            
            // Попытки с retry
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                const result = await this.getIncomes(limit, offset);
                
                if (result.success) {
                    allIncomes.push(...result.incomes);
                    console.log(`✅ Загружено ${result.incomes.length} чеков (offset: ${offset}, всего: ${allIncomes.length})`);
                    
                    if (result.incomes.length < limit) {
                        hasMore = false;
                    } else {
                        offset += limit;
                    }
                    
                    success = true;
                    break;
                } else {
                    lastError = result.error;
                    console.warn(`⚠️ Попытка ${attempt}/${maxRetries} не удалась: ${result.error}`);
                    
                    if (attempt < maxRetries) {
                        // Экспоненциальная задержка перед retry
                        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                        console.log(`⏳ Повтор через ${delay}мс...`);
                        await new Promise(r => setTimeout(r, delay));
                    }
                }
            }
            
            // Если после всех попыток не удалось
            if (!success) {
                console.error(`❌ Не удалось загрузить чеки после ${maxRetries} попыток: ${lastError}`);
                return { 
                    success: false, 
                    error: `Ошибка загрузки после ${maxRetries} попыток: ${lastError}`,
                    partialData: allIncomes.length > 0 ? allIncomes : null
                };
            }
            
            // Небольшая задержка между успешными запросами
            if (hasMore) {
                await new Promise(r => setTimeout(r, 300));
            }
        }
        
        console.log(`✅ Загрузка завершена! Всего чеков: ${allIncomes.length}`);
        return { success: true, incomes: allIncomes };
    }
    
    async getCanceledIncomes() {
        const allCanceled = [];
        let offset = 0;
        const limit = 100;
        let hasMore = true;
        const maxRetries = 3;
        
        console.log('🔄 Начинаем загрузку АННУЛИРОВАННЫХ чеков из налоговой...');
        
        while (hasMore) {
            let success = false;
            let lastError = null;
            
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                const result = await this.getIncomes(limit, offset, 'CANCELLED');
                
                if (result.success) {
                    allCanceled.push(...result.incomes);
                    console.log(`✅ Загружено ${result.incomes.length} аннулированных чеков (offset: ${offset}, всего: ${allCanceled.length})`);
                    
                    if (result.incomes.length < limit) {
                        hasMore = false;
                    } else {
                        offset += limit;
                    }
                    
                    success = true;
                    break;
                } else {
                    lastError = result.error;
                    console.warn(`⚠️ Попытка ${attempt}/${maxRetries} не удалась: ${result.error}`);
                    
                    if (attempt < maxRetries) {
                        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                        await new Promise(r => setTimeout(r, delay));
                    }
                }
            }
            
            if (!success) {
                console.error(`❌ Не удалось загрузить аннулированные чеки после ${maxRetries} попыток: ${lastError}`);
                return { 
                    success: false, 
                    error: `Ошибка загрузки аннулированных чеков: ${lastError}`,
                    partialData: allCanceled.length > 0 ? allCanceled : null
                };
            }
            
            if (hasMore) {
                await new Promise(r => setTimeout(r, 300));
            }
        }
        
        console.log(`✅ Загрузка аннулированных чеков завершена! Всего: ${allCanceled.length}`);
        return { success: true, incomes: allCanceled };
    }
    
    async getReceiptByUuid(receiptUuid) {
        if (!this.accessToken) {
            const authResult = await this.getAccessToken();
            if (!authResult.success) {
                return authResult;
            }
        }
        
        // Пробуем получить чек напрямую через API
        const options = {
            hostname: 'lknpd.nalog.ru',
            port: 443,
            path: `/api/v1/receipt/${this.login}/${receiptUuid}`,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        };
        
        try {
            const response = await makeRequest(options);
            
            if (response.statusCode === 200 && response.data) {
                console.log(`✅ Чек ${receiptUuid.substring(0, 12)}... получен напрямую`);
                
                // Проверяем, аннулирован ли чек (правильное поле: cancellationInfo)
                const isCanceled = response.data.cancellationInfo || response.data.canceledInfo || response.data.cancelledInfo || response.data.canceled || false;
                if (isCanceled) {
                    console.log(`🚫 Чек АННУЛИРОВАН!`, {
                        cancellationInfo: response.data.cancellationInfo,
                        comment: response.data.cancellationInfo?.comment
                    });
                }
                
                return { success: true, receipt: response.data, isCanceled: isCanceled };
            } else if (response.statusCode === 404) {
                console.log(`⏳ Чек ${receiptUuid.substring(0, 12)}... не найден напрямую (404), ищем в списке...`);
                // Fallback: пробуем найти в списке последних чеков (список обновляется быстрее)
                return this.getReceiptByUuidFromList(receiptUuid);
            } else {
                console.log(`⚠️ Ошибка получения чека: ${response.statusCode}`);
                // Fallback: ищем в списке последних чеков
                return this.getReceiptByUuidFromList(receiptUuid);
            }
        } catch (e) {
            console.error(`❌ Ошибка запроса чека:`, e.message);
            // Fallback: ищем в списке последних чеков
            return this.getReceiptByUuidFromList(receiptUuid);
        }
    }
    
    async getReceiptByUuidFromList(receiptUuid) {
        // Получаем последние чеки и ищем нужный
        try {
            const result = await this.getIncomes(100, 0);
            
            if (!result.success) {
                return result;
            }
            
            const receipt = result.incomes.find(income => {
                const uuid = income.approvedReceiptUuid || income.receiptUuid || income.uuid;
                return uuid === receiptUuid;
            });
            
            if (receipt) {
                console.log(`✅ Чек ${receiptUuid.substring(0, 12)}... найден в списке чеков`);
                
                // Проверяем, аннулирован ли чек
                const isCanceled = receipt.cancellationInfo || receipt.canceledInfo || receipt.cancelledInfo || receipt.canceled || receipt.status === 'CANCELED' || false;
                
                return { success: true, receipt: receipt, isCanceled: isCanceled };
            } else {
                console.log(`❌ Чек ${receiptUuid.substring(0, 12)}... не найден в списке (проверено ${result.incomes.length} чеков)`);
                return { success: false, error: 'Чек не найден в налоговой', notFound: true };
            }
        } catch (e) {
            console.error(`❌ Ошибка поиска в списке чеков:`, e.message);
            return { success: false, error: e.message, notFound: true };
        }
    }
}

let nalogApiInstance = null;

function getNalogApi(config) {
    if (!nalogApiInstance || nalogApiInstance.login !== config.nalog_login) {
        nalogApiInstance = new NalogApi(config.nalog_login, config.nalog_password);
    }
    return nalogApiInstance;
}

module.exports = { NalogApi, getNalogApi };
