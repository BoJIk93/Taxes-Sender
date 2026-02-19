const { makeRequest } = require('./http');

const CACHE_TTL_MS = 15000;
const MAX_RETRIES = 3;
const cache = new Map();

async function getPayments(config, dateFrom, dateTo) {
    const cacheKey = `${dateFrom || ''}|${dateTo || ''}`;
    const cached = cache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
        console.log(`📦 Используем кэш YooKassa (${cached.data.length} платежей)`);
        return cached.data;
    }

    const auth = Buffer.from(`${config.yookassa_shop_id}:${config.yookassa_secret_key}`).toString('base64');
    
    let allPayments = [];
    let cursor = null;
    let pageNum = 0;
    
    do {
        pageNum++;
        const params = new URLSearchParams();
        params.append('limit', '100');
        if (dateFrom) params.append('created_at.gte', dateFrom);
        if (dateTo) params.append('created_at.lte', dateTo);
        params.append('status', 'succeeded');
        if (cursor) params.append('cursor', cursor);
        
        const options = {
            hostname: 'api.yookassa.ru',
            port: 443,
            path: `/v3/payments?${params.toString()}`,
            method: 'GET',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/json'
            }
        };
        
        // Retry logic для каждого запроса
        let success = false;
        let lastError = null;
        
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                if (attempt > 1) console.log(`📥 Страница ${pageNum}, попытка ${attempt}/${MAX_RETRIES}...`);
                const response = await makeRequest(options);
                
                if (response.statusCode === 200 && response.data) {
                    const items = response.data.items || [];
                    allPayments = allPayments.concat(items);
                    cursor = response.data.next_cursor || null;
                    
                    if (pageNum === 1 || !cursor) {
                        console.log(`✅ YooKassa: загружено ${allPayments.length} платежей`);
                    }
                    success = true;
                    break;
                } else {
                    console.error(`❌ YooKassa вернул статус ${response.statusCode}:`, response.raw);
                    lastError = `HTTP ${response.statusCode}`;
                    
                    // Если не 500-ая ошибка, не повторяем
                    if (response.statusCode < 500) {
                        break;
                    }
                }
            } catch (e) {
                lastError = e.message;
                if (attempt === 1) {
                    console.warn(`⚠️ YooKassa timeout, повтор...`);
                }
                
                if (attempt < MAX_RETRIES) {
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                    await new Promise(r => setTimeout(r, delay));
                }
            }
        }
        
        if (!success) {
            console.error(`❌ YooKassa: не удалось загрузить страницу ${pageNum}: ${lastError}`);
            break;
        }
        
        // Задержка между страницами
        if (cursor) {
            await new Promise(r => setTimeout(r, 300));
        }
    } while (cursor);
    cache.set(cacheKey, { ts: Date.now(), data: allPayments });
    return allPayments;
}

function clearPaymentsCache() {
    cache.clear();
}

module.exports = { getPayments, clearPaymentsCache };
