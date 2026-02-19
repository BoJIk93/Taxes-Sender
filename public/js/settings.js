// ==================== SETTINGS ====================

async function openSettings() {
    try {
        const res = await fetch('/api/config');
        const config = await res.json();
        
        if (config) {
            document.getElementById('setYookassaShopId').value = config.yookassa_shop_id || '';
            document.getElementById('setYookassaSecretKey').placeholder = config.yookassa_secret_key || 'Введите ключ';
            document.getElementById('setNalogLogin').value = config.nalog_login || '';
            document.getElementById('setNalogPassword').placeholder = config.nalog_password || 'Введите пароль';
            document.getElementById('setMaxDaysBack').value = config.max_days_back || 30;
        }
    } catch (e) {
        console.error(e);
    }
    
    // Загружаем настройки автосинхронизации
    const autoSyncSettings = localStorage.getItem('autoSyncSettings');
    if (autoSyncSettings) {
        try {
            const settings = JSON.parse(autoSyncSettings);
            document.getElementById('autoSyncEnabledSettings').checked = settings.enabled || false;
            document.getElementById('autoSyncIntervalSelect').value = settings.interval || 30;
            
            if (settings.enabled) {
                document.getElementById('autoSyncIntervalSettings').style.display = 'block';
            }
        } catch (e) {
            console.error('Error loading auto sync settings:', e);
        }
    }
    
    // Загружаем время последней синхронизации
    const lastSync = localStorage.getItem('lastYookassaSync');
    if (lastSync) {
        document.getElementById('lastSyncTimeSettings').textContent = formatDateTime(lastSync);
    } else {
        document.getElementById('lastSyncTimeSettings').textContent = 'не выполнялась';
    }
    
    // Загружаем настройки авторизации
    if (typeof loadAuthSettings === 'function') loadAuthSettings();
    
    // Загружаем настройки отображения платежей
    loadDisplaySettings();
    
    // Загружаем настройки карточек
    loadStatCardsSettings();
    
    openModal('settingsModal');
}

async function saveSettings() {
    const maxDaysBack = parseInt(document.getElementById('setMaxDaysBack').value) || 30;
    
    const config = {
        yookassa_shop_id: document.getElementById('setYookassaShopId').value,
        yookassa_secret_key: document.getElementById('setYookassaSecretKey').value || undefined,
        nalog_login: document.getElementById('setNalogLogin').value,
        nalog_password: document.getElementById('setNalogPassword').value || undefined,
        max_days_back: maxDaysBack
    };
    
    try {
        const res = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
        
        const data = await res.json();
        if (data.success) {
            // Сохраняем настройки отображения
            saveDisplaySettings();
            // Сохраняем настройки карточек
            saveStatCardsSettings();
            applyStatCardsSettings();

            // Сохраняем авторизационные данные, если заполнены
            if (typeof saveAuthCredentials === 'function') {
                const authCur = document.getElementById('authCurrentPassword')?.value;
                const authNewL = document.getElementById('authNewLogin')?.value;
                const authNewP = document.getElementById('authNewPassword')?.value;
                if (authCur && (authNewL || authNewP)) {
                    await saveAuthCredentials(true);
                }
            }

            // Перерисовываем платежи, если они загружены
            if (typeof payments !== 'undefined' && payments.length > 0) {
                renderPayments();
            }

            showToast('Настройки сохранены!', 'success');
            closeModal('settingsModal');
        } else {
            showToast(data.error || 'Ошибка', 'error');
        }
    } catch (e) {
        showToast('Ошибка сети', 'error');
    }
}

// ==================== AUTO SYNC IN SETTINGS ====================

async function syncYookassaFromSettings() {
    const btn = document.getElementById('syncYookassaBtnSettings');
    const originalText = btn.innerHTML;
    
    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-arrow-repeat me-1"></i>Синхронизация...';
    
    try {
        await syncYookassa();
        
        // Обновляем время последней синхронизации в настройках
        const lastSync = localStorage.getItem('lastYookassaSync');
        if (lastSync) {
            document.getElementById('lastSyncTimeSettings').textContent = formatDateTime(lastSync);
        }
    } catch (e) {
        console.error('Sync error:', e);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

function toggleAutoSyncInSettings() {
    const enabled = document.getElementById('autoSyncEnabledSettings').checked;
    const intervalDiv = document.getElementById('autoSyncIntervalSettings');
    
    if (enabled) {
        intervalDiv.style.display = 'block';
        
        // Включаем автосинхронизацию
        autoSyncEnabled = true;
        autoSyncInterval = parseInt(document.getElementById('autoSyncIntervalSelect').value);
        startAutoSync();
        updateDropdownText();
        showToast(`Автосинхронизация включена (${autoSyncInterval}с)`, 'success');
    } else {
        intervalDiv.style.display = 'none';
        
        // Выключаем автосинхронизацию
        autoSyncEnabled = false;
        stopAutoSync();
        updateDropdownText();
        showToast('Автосинхронизация отключена', 'warning');
    }
    
    saveAutoSyncSettings();
}

function updateAutoSyncIntervalFromSettings() {
    const interval = parseInt(document.getElementById('autoSyncIntervalSelect').value);
    
    autoSyncInterval = interval;
    
    // Если автосинхронизация включена, перезапускаем с новым интервалом
    if (autoSyncEnabled) {
        stopAutoSync();
        startAutoSync();
        showToast(`Интервал изменен на ${interval} секунд`, 'success');
    }
    
    updateDropdownText();
    saveAutoSyncSettings();
}

// ==================== DISPLAY SETTINGS ====================

const displayFieldsDefinitions = [
    { id: 'description', label: 'Описание платежа', description: 'Описание платежа (обычно название товара/услуги)' },
    { id: 'paymentId', label: 'ID платежа', description: 'Уникальный идентификатор платежа из ЮКассы' },
    { id: 'metadata', label: 'Метаданные (metadata)', description: 'Дополнительные данные: TG ID, User ID, Email и т.д.' },
    { id: 'paymentMethod', label: 'Способ оплаты', description: 'Банковская карта, СБП, электронный кошелек и т.д.' },
    { id: 'dateTime', label: 'Дата и время', description: 'Когда был совершен платеж' },
    { id: 'amount', label: 'Сумма платежа', description: 'Сумма в рублях (всегда видна как основная информация)' },
    { id: 'receiptStatus', label: 'Статус чека', description: 'Отправлен, ожидает, ошибка и т.д.' },
    { id: 'receiptInfo', label: 'Информация о чеке', description: 'Данные из налоговой: услуга, сумма, совпадения' }
];

function loadDisplaySettings() {
    const saved = localStorage.getItem('paymentDisplaySettings');
    
    if (!saved) {
        // Defaults - все поля включены в порядке по умолчанию
        window.displayFieldsOrder = displayFieldsDefinitions.map(f => ({ id: f.id, enabled: true }));
    } else {
        const settings = JSON.parse(saved);
        
        // Если старый формат - конвертируем
        if (!Array.isArray(settings)) {
            window.displayFieldsOrder = displayFieldsDefinitions.map(f => ({
                id: f.id,
                enabled: settings[f.id] !== false
            }));
        } else {
            window.displayFieldsOrder = settings;
        }
    }
    
    renderDisplayFieldsList();
}

function renderDisplayFieldsList() {
    const container = document.getElementById('displayFieldsList');
    if (!container) return;
    
    const order = window.displayFieldsOrder || [];
    
    container.innerHTML = order.map((item, index) => {
        const def = displayFieldsDefinitions.find(d => d.id === item.id);
        if (!def) return '';
        
        return `
            <div class="display-field-item" data-field-id="${item.id}">
                <div class="display-field-order">${index + 1}</div>
                <input type="checkbox" class="display-field-checkbox" 
                       id="display_${item.id}" 
                       ${item.enabled ? 'checked' : ''}
                       onchange="toggleDisplayField('${item.id}')">
                <label for="display_${item.id}" class="display-field-info">
                    <strong>${def.label}</strong>
                    <small>${def.description}</small>
                </label>
                <div class="display-field-controls">
                    <button onclick="moveDisplayFieldUp('${item.id}')" 
                            ${index === 0 ? 'disabled' : ''} 
                            title="Переместить вверх"><i class="bi bi-arrow-up"></i></button>
                    <button onclick="moveDisplayFieldDown('${item.id}')" 
                            ${index === order.length - 1 ? 'disabled' : ''} 
                            title="Переместить вниз"><i class="bi bi-arrow-down"></i></button>
                </div>
            </div>
        `;
    }).join('');
}

function toggleDisplayField(fieldId) {
    const field = window.displayFieldsOrder.find(f => f.id === fieldId);
    if (field) {
        field.enabled = !field.enabled;
    }
}

function moveDisplayFieldUp(fieldId) {
    const index = window.displayFieldsOrder.findIndex(f => f.id === fieldId);
    if (index > 0) {
        const temp = window.displayFieldsOrder[index];
        window.displayFieldsOrder[index] = window.displayFieldsOrder[index - 1];
        window.displayFieldsOrder[index - 1] = temp;
        renderDisplayFieldsList();
    }
}

function moveDisplayFieldDown(fieldId) {
    const index = window.displayFieldsOrder.findIndex(f => f.id === fieldId);
    if (index < window.displayFieldsOrder.length - 1) {
        const temp = window.displayFieldsOrder[index];
        window.displayFieldsOrder[index] = window.displayFieldsOrder[index + 1];
        window.displayFieldsOrder[index + 1] = temp;
        renderDisplayFieldsList();
    }
}

function saveDisplaySettings() {
    // Сохраняем порядок и состояние полей
    localStorage.setItem('paymentDisplaySettings', JSON.stringify(window.displayFieldsOrder));
}

// ==================== STAT CARDS SETTINGS ====================

const statCardsDefinitions = [
    { id: 'pending', label: 'Ожидают отправки' },
    { id: 'sent', label: 'Отправлено всего' },
    { id: 'amount', label: 'Сумма к отправке' },
    { id: 'amountPeriod', label: 'Отправлено в налоговую' },
    { id: 'earnings', label: 'Заработок' },
    { id: 'difference', label: 'Разница' }
];

function loadStatCardsSettings() {
    const saved = localStorage.getItem('statCardsSettings');
    
    if (!saved) {
        window.statCardsOrder = statCardsDefinitions.map(c => ({ id: c.id, enabled: true }));
        window.cardsEnabled = true;
    } else {
        try {
            const data = JSON.parse(saved);
            window.cardsEnabled = data.enabled !== false;
            window.statCardsOrder = data.order || statCardsDefinitions.map(c => ({ id: c.id, enabled: true }));
        } catch (e) {
            window.statCardsOrder = statCardsDefinitions.map(c => ({ id: c.id, enabled: true }));
            window.cardsEnabled = true;
        }
    }
    
    document.getElementById('cardsEnabled').checked = window.cardsEnabled;
    renderStatCardsList();
}

function renderStatCardsList() {
    const container = document.getElementById('cardsSettingsList');
    if (!container) return;
    
    const order = window.statCardsOrder || [];
    
    container.innerHTML = order.map((item, index) => {
        const def = statCardsDefinitions.find(d => d.id === item.id);
        if (!def) return '';
        
        return `
            <div class="display-field-item" data-card-id="${item.id}">
                <div class="display-field-order">${index + 1}</div>
                <input type="checkbox" class="display-field-checkbox" 
                       id="card_${item.id}" 
                       ${item.enabled ? 'checked' : ''}
                       onchange="toggleStatCard('${item.id}')">
                <label for="card_${item.id}" class="display-field-info">
                    <strong>${def.label}</strong>
                </label>
                <div class="display-field-controls">
                    <button onclick="moveStatCardUp('${item.id}')" 
                            ${index === 0 ? 'disabled' : ''} 
                            title="Переместить вверх"><i class="bi bi-arrow-up"></i></button>
                    <button onclick="moveStatCardDown('${item.id}')" 
                            ${index === order.length - 1 ? 'disabled' : ''} 
                            title="Переместить вниз"><i class="bi bi-arrow-down"></i></button>
                </div>
            </div>
        `;
    }).join('');
}

function toggleCardsEnabled() {
    window.cardsEnabled = document.getElementById('cardsEnabled').checked;
}

function toggleStatCard(cardId) {
    const card = window.statCardsOrder.find(c => c.id === cardId);
    const checkbox = document.getElementById('card_' + cardId);
    if (card && checkbox) card.enabled = checkbox.checked;
}

function moveStatCardUp(cardId) {
    const index = window.statCardsOrder.findIndex(c => c.id === cardId);
    if (index > 0) {
        [window.statCardsOrder[index], window.statCardsOrder[index - 1]] = 
            [window.statCardsOrder[index - 1], window.statCardsOrder[index]];
        renderStatCardsList();
    }
}

function moveStatCardDown(cardId) {
    const index = window.statCardsOrder.findIndex(c => c.id === cardId);
    if (index < window.statCardsOrder.length - 1) {
        [window.statCardsOrder[index], window.statCardsOrder[index + 1]] = 
            [window.statCardsOrder[index + 1], window.statCardsOrder[index]];
        renderStatCardsList();
    }
}

function saveStatCardsSettings() {
    localStorage.setItem('statCardsSettings', JSON.stringify({
        enabled: window.cardsEnabled,
        order: window.statCardsOrder
    }));
}

function applyStatCardsSettings() {
    const wrapper = document.getElementById('statsWrapper');
    const section = document.getElementById('statsSection');
    const row = document.getElementById('statsContainer');
    const skeletonRow = document.getElementById('statsSkeleton');
    if (!section || !row) return;

    const enabled = window.cardsEnabled !== false;
    if (wrapper) wrapper.style.display = enabled ? '' : 'none';

    if (!enabled) return;

    const order = window.statCardsOrder || [];
    order.forEach((item, index) => {
        const col = row.querySelector(`.stat-card-col[data-card-id="${item.id}"]`);
        if (col) {
            col.style.display = item.enabled ? '' : 'none';
            col.style.order = String(index);
        }
        const skeletonCol = skeletonRow?.querySelector(`.stat-skeleton-col[data-card-id="${item.id}"]`);
        if (skeletonCol) {
            skeletonCol.style.display = item.enabled ? '' : 'none';
            skeletonCol.style.order = String(index);
        }
    });
}

function getDisplaySettings() {
    const saved = localStorage.getItem('paymentDisplaySettings');
    
    if (!saved) {
        // Defaults
        return {
            order: displayFieldsDefinitions.map(f => f.id),
            fields: {
                paymentId: true,
                description: true,
                dateTime: true,
                amount: true,
                metadata: true,
                paymentMethod: true,
                receiptStatus: true,
                receiptInfo: true
            }
        };
    }
    
    const settings = JSON.parse(saved);
    
    // Если старый формат - конвертируем
    if (!Array.isArray(settings)) {
        return {
            order: displayFieldsDefinitions.map(f => f.id),
            fields: settings
        };
    }
    
    // Новый формат с порядком
    return {
        order: settings.map(s => s.id),
        fields: settings.reduce((acc, s) => {
            acc[s.id] = s.enabled;
            return acc;
        }, {})
    };
}
