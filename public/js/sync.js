// ==================== YOOKASSA SYNC ====================

async function syncYookassa() {
    if (isSyncing) {
        showToast('Синхронизация уже выполняется', 'warning');
        return;
    }
    
    isSyncing = true;
    const btn = document.getElementById('syncYookassaBtn');
    
    // Находим иконку и добавляем анимацию через inline стили
    let icon = document.getElementById('yookassaSyncIcon');
    if (icon) {
        icon.style.animation = 'spin 2s linear infinite';
        icon.style.display = 'inline-block';
        icon.style.transformOrigin = 'center center';
        console.log('Manual sync: animation added to icon:', icon, 'Styles:', icon.style.animation);
    } else {
        console.warn('Manual sync: icon not found!');
    }
    
    if (btn) {
        btn.disabled = true;
    }
    
    try {
        // Ручная синхронизация: не сбрасываем страницу, но можем показать скелетоны,
        // только если данных ещё не было
        const hasExistingData = Array.isArray(payments) && payments.length > 0;
        const prevIds = new Set((allPaymentsRaw || []).map(p => p.id));
        await loadPayments({ showSkeleton: !hasExistingData, resetPagination: false });
        await loadStats(); // полная перезагрузка статистики с её собственными скелетонами
        
        showToast('Синхронизация с ЮKassa завершена!', 'success');
        
        const syncTime = new Date().toISOString();
        localStorage.setItem('lastYookassaSync', syncTime);
        
        const dropdownTime = document.getElementById('dropdownLastSync');
        if (dropdownTime) {
            dropdownTime.textContent = formatDateTime(syncTime);
        }
        await runAutoSendIfEnabled(prevIds);
    } catch (e) {
        showToast('Ошибка синхронизации', 'error');
    } finally {
        isSyncing = false;
        // Находим иконку заново (на случай если DOM обновился)
        icon = document.getElementById('yookassaSyncIcon');
        if (icon) {
            icon.style.animation = '';
            icon.style.display = '';
            icon.style.transformOrigin = '';
            console.log('Manual sync: animation removed');
        }
        if (btn) {
            btn.disabled = false;
        }
    }
}

// ==================== DROPDOWN ====================

function toggleAutoSyncDropdown() {
    const dropdown = document.getElementById('autoSyncDropdown');
    const dropdownIcon = document.getElementById('autoSyncDropdownIcon');
    const isShown = dropdown.classList.contains('show');
    
    if (isShown) {
        closeAutoSyncDropdown();
        // Стрелка вниз
        if (dropdownIcon) {
            dropdownIcon.classList.remove('bi-chevron-up');
            dropdownIcon.classList.add('bi-chevron-down');
        }
    } else {
        dropdown.classList.add('show');
        // Стрелка вверх
        if (dropdownIcon) {
            dropdownIcon.classList.remove('bi-chevron-down');
            dropdownIcon.classList.add('bi-chevron-up');
        }
        updateDropdownText();
        
        // Обновляем время последней синхронизации
        const lastSync = localStorage.getItem('lastYookassaSync');
        if (lastSync) {
            const dropdownTime = document.getElementById('dropdownLastSync');
            if (dropdownTime) {
                dropdownTime.textContent = formatDateTime(lastSync);
            }
        }
        
        // Закрыть при клике вне dropdown
        setTimeout(() => {
            document.addEventListener('click', closeDropdownOnClickOutside);
        }, 0);
    }
}

function closeAutoSyncDropdown() {
    const dropdown = document.getElementById('autoSyncDropdown');
    const dropdownIcon = document.getElementById('autoSyncDropdownIcon');
    dropdown.classList.remove('show');
    // Стрелка вниз при закрытии
    if (dropdownIcon) {
        dropdownIcon.classList.remove('bi-chevron-up');
        dropdownIcon.classList.add('bi-chevron-down');
    }
    document.removeEventListener('click', closeDropdownOnClickOutside);
}

function closeDropdownOnClickOutside(e) {
    const dropdown = document.getElementById('autoSyncDropdown');
    const btn = document.getElementById('autoSyncDropdownBtn');
    
    if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
        closeAutoSyncDropdown();
    }
}

function updateDropdownText() {
    const text = document.getElementById('autoSyncToggleText');
    if (text) {
        if (autoSyncEnabled) {
            text.innerHTML = `<i class="bi bi-check-circle-fill me-1"></i>Отключить (${autoSyncInterval}с)`;
        } else {
            text.innerHTML = 'Включить автосинхронизацию';
        }
    }
}

function updateSyncButtonText() {
    const btn = document.getElementById('syncYookassaBtn');
    if (!btn) return;
    
    if (autoSyncEnabled) {
        // Форматируем интервал
        let intervalText;
        if (autoSyncInterval < 60) {
            intervalText = `${autoSyncInterval}с`;
        } else if (autoSyncInterval === 60) {
            intervalText = '1м';
        } else if (autoSyncInterval === 120) {
            intervalText = '2м';
        } else if (autoSyncInterval === 300) {
            intervalText = '5м';
        } else {
            intervalText = `${Math.floor(autoSyncInterval / 60)}м`;
        }
        
        // Обновляем текст кнопки с сохранением иконки
        btn.innerHTML = '<i class="bi bi-arrow-repeat me-1" id="yookassaSyncIcon"></i>' + intervalText;
    } else {
        // Если выключена, показываем "Автосинхронизация"
        btn.innerHTML = '<i class="bi bi-arrow-repeat me-1" id="yookassaSyncIcon"></i>Автосинхронизация';
    }
}

function quickToggleAutoSync() {
    closeAutoSyncDropdown();
    autoSyncEnabled = !autoSyncEnabled;
    
    if (autoSyncEnabled) {
        startAutoSync();
        showToast(`Автосинхронизация включена (${autoSyncInterval}с)`, 'success');
    } else {
        stopAutoSync();
        showToast('Автосинхронизация отключена', 'warning');
    }
    
    updateDropdownText();
    updateSyncButtonText();
    saveAutoSyncSettings();
}

async function setAutoSyncInterval(seconds) {
    closeAutoSyncDropdown();
    autoSyncInterval = seconds;
    
    // Если автосинхронизация выключена, включаем её
    if (!autoSyncEnabled) {
        autoSyncEnabled = true;
        startAutoSync();
        // Выполняем первую синхронизацию немедленно
        await performAutoSync();
        showToast(`Автосинхронизация включена (${seconds}с)`, 'success');
    } else {
        // Если включена, просто меняем интервал
        stopAutoSync();
        startAutoSync();
        // Выполняем синхронизацию немедленно при смене интервала
        await performAutoSync();
        showToast(`Интервал изменен на ${seconds} секунд`, 'success');
    }
    
    updateDropdownText();
    updateSyncButtonText();
    saveAutoSyncSettings();
}

// ==================== AUTO SYNC ====================

function loadAutoSyncSettings() {
    const saved = localStorage.getItem('autoSyncSettings');
    if (saved) {
        try {
            const settings = JSON.parse(saved);
            autoSyncEnabled = settings.enabled || false;
            autoSyncInterval = settings.interval || 30;
            
            if (autoSyncEnabled) {
                startAutoSync();
                updateDropdownText();
                updateSyncButtonText();
                console.log('Auto sync loaded and started');
            } else {
                updateSyncButtonText();
            }
        } catch (e) {
            console.error('Error loading auto sync settings:', e);
        }
    } else {
        updateSyncButtonText();
    }
    
    // Загружаем время последней синхронизации
    const lastSync = localStorage.getItem('lastYookassaSync');
    if (lastSync) {
        const dropdownTime = document.getElementById('dropdownLastSync');
        if (dropdownTime) {
            dropdownTime.textContent = formatDateTime(lastSync);
        }
    }
    // Показываем кнопку только после подстановки текста (нет мигания «Автосинхронизация» → интервал)
    const syncBtnGroup = document.getElementById('syncBtnGroup');
    if (syncBtnGroup) syncBtnGroup.classList.add('sync-btn-group-ready');
}

async function performAutoSync() {
    if (isSyncing) {
        console.log('Auto sync: already syncing, skipping...');
        return;
    }
    
    const now = new Date().toLocaleTimeString();
    console.log(`[${now}] ⏳ Auto sync started`);
    
    // Добавляем анимацию иконке
    const icon = document.getElementById('yookassaSyncIcon');
    if (icon) {
        icon.style.animation = 'spin 2s linear infinite';
        icon.style.display = 'inline-block';
        icon.style.transformOrigin = 'center center';
    }
    
    try {
        isSyncing = true;
        const prevIds = new Set((allPaymentsRaw || []).map(p => p.id));
        await loadPayments({ showSkeleton: false, resetPagination: false, isAuto: true });
        await loadStatsQuietly({ useSkeleton: false });
        await runAutoSendIfEnabled(prevIds);
        console.log(`[${new Date().toLocaleTimeString()}] ✓ Auto sync completed`);
    } catch (e) {
        console.error(`[${new Date().toLocaleTimeString()}] ✗ Auto sync error:`, e);
    } finally {
        isSyncing = false;
        
        // Убираем анимацию сразу после завершения
        const iconFinal = document.getElementById('yookassaSyncIcon');
        if (iconFinal) {
            iconFinal.style.animation = '';
            iconFinal.style.display = '';
            iconFinal.style.transformOrigin = '';
        }
    }
}

function startAutoSync() {
    stopAutoSync();
    
    const now = new Date().toLocaleTimeString();
    console.log(`[${now}] Auto sync started: interval ${autoSyncInterval}s`);
    
    // Функция для планирования следующей синхронизации
    function scheduleNextSync() {
        if (!autoSyncEnabled) return; // Если выключена, не планируем
        
        const nextTime = new Date(Date.now() + autoSyncInterval * 1000).toLocaleTimeString();
        console.log(`[${new Date().toLocaleTimeString()}] Next sync scheduled at: ${nextTime}`);
        
        autoSyncTimer = setTimeout(async () => {
            await performAutoSync();
            scheduleNextSync(); // Планируем следующую ПОСЛЕ завершения текущей
        }, autoSyncInterval * 1000);
    }
    
    // Запускаем первую итерацию
    scheduleNextSync();
}

function stopAutoSync() {
    if (autoSyncTimer) {
        clearTimeout(autoSyncTimer);
        autoSyncTimer = null;
        console.log('Auto sync stopped');
    }
    
    // Убираем анимацию при остановке
    const icon = document.getElementById('yookassaSyncIcon');
    if (icon) {
        icon.style.animation = '';
        icon.style.display = '';
        icon.style.transformOrigin = '';
    }
}

function saveAutoSyncSettings() {
    localStorage.setItem('autoSyncSettings', JSON.stringify({
        enabled: autoSyncEnabled,
        interval: autoSyncInterval
    }));
}

// ==================== TAX SERVICE SYNC ====================

function syncWithTaxService() {
    // Сброс состояния модального окна
    document.getElementById('syncInitialState').classList.remove('hidden');
    document.getElementById('syncProgressState').classList.add('hidden');
    document.getElementById('syncResultState').classList.add('hidden');
    document.getElementById('syncStartBtn').classList.remove('hidden');
    document.getElementById('syncCancelBtn').classList.remove('hidden');
    document.getElementById('syncCloseBtn').classList.add('hidden');
    document.getElementById('syncModalClose').style.display = 'block';
    
    openModal('syncModal');
}

function closeSyncModal() {
    closeModal('syncModal');
}

function showSyncShutter() {
    const el = document.getElementById('syncShutter');
    if (el) {
        el.classList.remove('hidden');
        el.setAttribute('aria-hidden', 'false');
    }
    document.body.style.overflow = 'hidden';
}

function hideSyncShutter() {
    const el = document.getElementById('syncShutter');
    if (el) {
        el.classList.add('hidden');
        el.setAttribute('aria-hidden', 'true');
    }
    document.body.style.overflow = '';
}

/** При запуске приложения — синхронизация с налоговой, чтобы корректно считались «ожидают» и «всего отправлено». */
async function runTaxSyncOnStartup() {
    showSyncShutter();
    // Страховочный таймер: если синхронизация зависнет, скроем шторку через 30 сек
    const safetyTimer = setTimeout(() => {
        console.warn('Синхронизация при запуске: превышен таймаут 30с, скрываем шторку');
        hideSyncShutter();
    }, 30000);
    try {
        const controller = new AbortController();
        const fetchTimer = setTimeout(() => controller.abort(), 25000);
        const res = await fetch('/api/nalog/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal
        });
        clearTimeout(fetchTimer);
        const data = await res.json();
        if (data.success) {
            if (typeof loadPayments === 'function') {
                await loadPayments({ showSkeleton: false, resetPagination: false });
            }
            if (typeof loadStats === 'function') await loadStats();
            if (data.updated > 0) {
                showToast('Данные с налоговой обновлены', 'success');
            }
        }
    } catch (e) {
        if (e.name === 'AbortError') {
            console.warn('Синхронизация при запуске: таймаут запроса');
        } else {
            console.warn('Синхронизация с налоговой при запуске:', e);
        }
    } finally {
        clearTimeout(safetyTimer);
        hideSyncShutter();
    }
}

async function confirmSync() {
    // Индикатор загрузки (если кнопка существует)
    const taxIcon = document.getElementById('taxSyncIcon');
    const taxBtn = document.getElementById('syncBtn');
    if (taxIcon) taxIcon.classList.add('icon-loading');
    if (taxBtn) taxBtn.disabled = true;
    
    // Переход в режим прогресса
    document.getElementById('syncInitialState').classList.add('hidden');
    document.getElementById('syncProgressState').classList.remove('hidden');
    document.getElementById('syncResultState').classList.add('hidden');
    document.getElementById('syncStartBtn').classList.add('hidden');
    document.getElementById('syncCancelBtn').classList.add('hidden');
    document.getElementById('syncModalClose').style.display = 'none';
    
    // Сброс прогресса
    updateSyncProgress(0, 0, 0, 'Подключение к налоговой...');
    
    // Симуляция прогресса
    const progressSteps = [
        { percent: 10, loaded: 0, text: '<i class="bi bi-shield-lock me-1"></i>Авторизация в налоговой...' },
        { percent: 25, loaded: 0, text: '<i class="bi bi-wifi me-1"></i>Подключение к API...' },
        { percent: 40, loaded: 0, text: '<i class="bi bi-download me-1"></i>Загрузка данных...' },
        { percent: 55, loaded: 0, text: '<i class="bi bi-file-earmark-text me-1"></i>Получение чеков...' },
        { percent: 70, loaded: 0, text: '<i class="bi bi-arrow-repeat me-1"></i>Обработка данных...' },
        { percent: 85, loaded: 0, text: '<i class="bi bi-save me-1"></i>Сохранение в базу...' },
        { percent: 95, loaded: 0, text: '<i class="bi bi-stars me-1"></i>Финализация...' }
    ];
    let currentStep = 0;
    
    const progressInterval = setInterval(() => {
        if (currentStep < progressSteps.length) {
            const step = progressSteps[currentStep];
            updateSyncProgress(step.percent, step.loaded, 0, step.text);
            currentStep++;
        }
    }, 1200); // Обновляем каждые 1.2 секунды
    
    try {
        const res = await fetch('/api/nalog/sync', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        
        // Останавливаем симуляцию
        clearInterval(progressInterval);
        
        const count = Number(data.count) || 0;
        const updated = Number(data.updated) ?? Number(data.matched) ?? 0;
        const matched = Number(data.matched) ?? updated;
        
        if (data.success) {
            // Сразу обновляем цифры в блоке прогресса, затем доводим до 100%
            updateSyncProgress(100, count, updated, 'Готово!');
            await new Promise(r => setTimeout(r, 600)); // Даем увидеть актуальные цифры
            
            // Показываем результат с теми же числами
            document.getElementById('syncProgressState').classList.add('hidden');
            document.getElementById('syncResultState').classList.remove('hidden');
            document.getElementById('syncCloseBtn').classList.remove('hidden');
            
            document.getElementById('syncResultIcon').innerHTML = '<i class="bi bi-check-circle-fill text-success" style="font-size: 4rem;"></i>';
            document.getElementById('syncResultTitle').textContent = 'Синхронизация завершена!';
            document.getElementById('syncResultDetails').innerHTML = `
                <div class="sync-detail-item">
                    <span><i class="bi bi-download me-2"></i>Загружено чеков из налоговой:</span>
                    <strong>${count}</strong>
                </div>
                <div class="sync-detail-item">
                    <span><i class="bi bi-arrow-repeat me-2"></i>Обновлено платежей (отмечено как отправленные):</span>
                    <strong>${updated}</strong>
                </div>
                <div class="sync-detail-item">
                    <span><i class="bi bi-clock me-2"></i>Время синхронизации:</span>
                    <strong>${formatDateTime(new Date().toISOString())}</strong>
                </div>
            `;
            
            showToast(`Синхронизация завершена! Загружено: ${count}, обновлено: ${updated}`, 'success');
            await Promise.all([loadPayments(), loadStats()]);
        } else {
            // Проверяем, это частичная синхронизация или полная ошибка
            if (data.partialSync) {
                // Частичная синхронизация
                updateSyncProgress(50, data.partialCount || 0, 0, 'Частичная загрузка');
                await new Promise(r => setTimeout(r, 500));
                
                document.getElementById('syncProgressState').classList.add('hidden');
                document.getElementById('syncResultState').classList.remove('hidden');
                document.getElementById('syncCloseBtn').classList.remove('hidden');
                
                document.getElementById('syncResultIcon').innerHTML = '<i class="bi bi-exclamation-triangle-fill text-warning" style="font-size: 4rem;"></i>';
                document.getElementById('syncResultTitle').textContent = 'Частичная синхронизация';
                document.getElementById('syncResultDetails').innerHTML = `
                    <div class="sync-detail-item">
                        <span><i class="bi bi-download me-2"></i>Загружено частично:</span>
                        <strong>${data.partialCount || 0} чеков</strong>
                    </div>
                    <p style="color: var(--warning); text-align: center; margin-top: 16px;">
                        ${escapeHtml(data.message || data.error || 'Синхронизация не завершена из-за ошибок. Старый кэш сохранён.')}
                    </p>
                `;
                
                showToast(`Частичная синхронизация: ${data.partialCount || 0} чеков`, 'warning');
            } else {
                // Полная ошибка
                document.getElementById('syncProgressState').classList.add('hidden');
                document.getElementById('syncResultState').classList.remove('hidden');
                document.getElementById('syncCloseBtn').classList.remove('hidden');
                
                document.getElementById('syncResultIcon').innerHTML = '<i class="bi bi-x-circle-fill text-danger" style="font-size: 4rem;"></i>';
                document.getElementById('syncResultTitle').textContent = 'Ошибка синхронизации';
                document.getElementById('syncResultDetails').innerHTML = `
                    <p style="color: var(--danger); text-align: center;">${escapeHtml(data.error || 'Неизвестная ошибка')}</p>
                `;
                
                showToast(`Ошибка: ${data.error}`, 'error');
            }
        }
    } catch (e) {
        // Останавливаем симуляцию
        clearInterval(progressInterval);
        
        // Показываем ошибку сети
        document.getElementById('syncProgressState').classList.add('hidden');
        document.getElementById('syncResultState').classList.remove('hidden');
        document.getElementById('syncCloseBtn').classList.remove('hidden');
        
        document.getElementById('syncResultIcon').innerHTML = '<i class="bi bi-x-circle-fill text-danger" style="font-size: 4rem;"></i>';
        document.getElementById('syncResultTitle').textContent = 'Ошибка подключения';
        document.getElementById('syncResultDetails').innerHTML = `
            <p style="color: var(--danger); text-align: center;">${escapeHtml(e.message)}</p>
        `;
        
        showToast('Ошибка сети', 'error');
    } finally {
        // Останавливаем симуляцию (на всякий случай, если где-то не очистили)
        clearInterval(progressInterval);
        
        // Убираем индикатор загрузки
        const taxIcon = document.getElementById('taxSyncIcon');
        const taxBtn = document.getElementById('syncBtn');
        if (taxIcon) taxIcon.classList.remove('icon-loading');
        if (taxBtn) taxBtn.disabled = false;
    }
}

function updateSyncProgress(percent, loaded, updated, statusText) {
    const progressFill = document.getElementById('syncProgressFill');
    const progressText = document.getElementById('syncProgressText');
    const progressCount = document.getElementById('syncProgressCount');
    const statusTextEl = document.getElementById('syncStatusText');
    const loadedCount = document.getElementById('syncLoadedCount');
    const updatedCount = document.getElementById('syncUpdatedCount');
    const matchedCount = document.getElementById('syncMatchedCount');
    
    const loadedNum = Number(loaded) || 0;
    const updatedNum = Number(updated) || 0;
    
    if (progressFill) {
        progressFill.style.width = percent + '%';
        progressFill.style.transition = 'width 0.5s ease-out';
    }
    
    if (progressText) progressText.textContent = Math.round(percent) + '%';
    if (progressCount) progressCount.textContent = loadedNum > 0 ? `${loadedNum} чеков · обновлено ${updatedNum}` : 'Загрузка...';
    if (statusTextEl) statusTextEl.innerHTML = statusText || '';
    if (loadedCount) loadedCount.textContent = loadedNum;
    if (updatedCount) updatedCount.textContent = updatedNum;
    if (matchedCount) matchedCount.textContent = updatedNum;
}

// ==================== CHECK CONNECTION ====================

let checkConnectionResultTimeout = null;

function setCheckConnectionResult(message, type) {
    const el = document.getElementById('checkConnectionResult');
    if (!el) return;
    if (checkConnectionResultTimeout) {
        clearTimeout(checkConnectionResultTimeout);
        checkConnectionResultTimeout = null;
    }
    el.textContent = '';
    el.className = 'check-connection-result mt-2';
    if (type) el.classList.add('check-connection-result--' + type);
    el.textContent = message;
    if (message) {
        checkConnectionResultTimeout = setTimeout(() => {
            el.textContent = '';
            el.className = 'check-connection-result mt-2';
            checkConnectionResultTimeout = null;
        }, 5000);
    }
}

async function checkConnection() {
    const checkBtn = document.getElementById('checkBtn');
    const checkIcon = checkBtn?.querySelector('i');

    if (checkBtn) checkBtn.disabled = true;
    if (checkIcon) checkIcon.classList.add('icon-loading');

    setCheckConnectionResult('Проверка подключений...', 'info');

    let yookassaOk = false;
    let nalogOk = false;
    let yookassaError = '';
    let nalogError = '';

    try {
        const yookassaRes = await fetch('/api/payments?limit=1');
        const yookassaData = await yookassaRes.json();
        if (yookassaData.success !== false) {
            yookassaOk = true;
        } else {
            yookassaError = yookassaData.error || 'Неизвестная ошибка';
        }
    } catch (e) {
        yookassaError = 'Ошибка сети или сервер недоступен';
    }

    try {
        const nalogRes = await fetch('/api/nalog/check', { method: 'POST' });
        const nalogData = await nalogRes.json();
        if (nalogData.success) {
            nalogOk = true;
        } else {
            nalogError = nalogData.error || 'Неизвестная ошибка';
        }
    } catch (e) {
        nalogError = 'Ошибка сети или сервер недоступен';
    }

    if (checkBtn) checkBtn.disabled = false;
    if (checkIcon) checkIcon.classList.remove('icon-loading');

    if (yookassaOk && nalogOk) {
        setCheckConnectionResult('Подключение к ЮКасса и налоговой успешно!', 'success');
    } else if (!yookassaOk && !nalogOk) {
        const parts = ['Нет подключения к ЮКасса и налоговой.'];
        if (yookassaError) parts.push(' ЮКасса: ' + yookassaError);
        if (nalogError) parts.push(' Налоговая: ' + nalogError);
        setCheckConnectionResult(parts.join(''), 'error');
    } else if (!yookassaOk) {
        setCheckConnectionResult('Нет подключения к ЮКасса. ' + (yookassaError || '') + ' Налоговая: OK.', 'error');
    } else {
        setCheckConnectionResult('Нет подключения к налоговой. ' + (nalogError || '') + ' ЮКасса: OK.', 'error');
    }
}

// ==================== AUTO SEND ====================

let autoSendAbortRequested = false;

function getAutoSendParamsForPayment(payment) {
    const defaultServiceName = serviceNames.length > 0 ? serviceNames[0] : 'Услуга';
    if (autoSendSettings.useYookassaData) {
        return {
            serviceName: payment.description || defaultServiceName,
            saleDate: payment.paid_at || payment.created_at,
            price: payment.amount
        };
    }
    const r = autoSendSettings.random;
    let serviceName = defaultServiceName;
    if (r.serviceName.enabled && r.serviceName.names && r.serviceName.names.length > 0) {
        serviceName = r.serviceName.names[Math.floor(Math.random() * r.serviceName.names.length)];
    }
    let saleDate = payment.paid_at || payment.created_at;
    if (r.date.enabled && r.date.from && r.date.to) {
        const from = new Date(r.date.from + 'T00:00:00');
        const to = new Date(r.date.to + 'T23:59:59');
        const diff = to.getTime() - from.getTime();
        const randomDateTime = new Date(from.getTime() + Math.random() * diff);
        const utcTime = randomDateTime.getTime() + (randomDateTime.getTimezoneOffset() * 60000);
        const moscowTime = new Date(utcTime + (3 * 3600000));
        saleDate = moscowTime.toISOString();
    }
    let price = payment.amount;
    if (r.price.enabled && r.price.from != null && r.price.to != null) {
        const pFrom = parseFloat(r.price.from);
        const pTo = parseFloat(r.price.to);
        if (!isNaN(pFrom) && !isNaN(pTo)) {
            price = (pFrom + Math.random() * (pTo - pFrom)).toFixed(2);
        }
    }
    return { serviceName, saleDate, price };
}

/** После авто-отправки проверить, что чек попал в налоговую (1–2 запроса с паузой) */
async function verifyReceiptInTaxAfterAutoSend(receiptUuid, paymentId) {
    const delayFirst = 5000;
    const delayRetry = 6000;
    await new Promise(r => setTimeout(r, delayFirst));
    try {
        const res = await fetch('/api/check-receipt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ receipt_uuid: receiptUuid })
        });
        const data = await res.json();
        if (data.success && data.receipt) {
            if (typeof updateSinglePayment === 'function') await updateSinglePayment(paymentId);
            return true;
        }
        if (data.notFound) {
            await new Promise(r => setTimeout(r, delayRetry));
            const res2 = await fetch('/api/check-receipt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ receipt_uuid: receiptUuid })
            });
            const data2 = await res2.json();
            if (data2.success && data2.receipt && typeof updateSinglePayment === 'function') {
                await updateSinglePayment(paymentId);
                return true;
            }
        }
    } catch (e) {
        console.warn('Авто-отправка: проверка чека в налоговой не удалась:', e.message);
    }
    return false;
}

async function autoSendNewPayments(previousPaymentIds) {
    if (!Array.isArray(allPaymentsRaw) || allPaymentsRaw.length === 0) return;
    autoSendAbortRequested = false;
    let pending = allPaymentsRaw.filter(p =>
        (p.receipt_status === 'pending' && !p.in_tax_service) ||
        p.receipt_status === 'canceled' ||
        (p.receipt_status === 'error' && !p.in_tax_service)
    );
    if (autoSendSettings.onlyNew) {
        if (!previousPaymentIds || previousPaymentIds.size === 0) {
            return;
        }
        pending = pending.filter(p => !previousPaymentIds.has(p.id));
    }
    if (pending.length === 0) return;
    if (autoSendSettings.useYookassaData === false) {
        const r = autoSendSettings.random;
        if (!r.serviceName.enabled || !r.serviceName.names || r.serviceName.names.length === 0) {
            console.warn('Авто-отправка: рандом включён, но не выбраны услуги — пропуск');
            return;
        }
    }
    
    const total = pending.length;
    let success = 0, failed = 0, skipped = 0, done = 0;
    
    // Прогресс-бар всегда для авто-отправки (кнопка «Отменить» на баре — единственный способ прервать)
    const useBulkProgress = typeof showBulkProgress === 'function';
    if (useBulkProgress) {
        showBulkProgress({ total, label: 'Авто-отправка чеков' });
    }
    showToast(`Авто-отправка: ${total} чеков...`, 'info');
    
    for (const payment of pending) {
        if (autoSendAbortRequested || bulkOperationAborted) {
            showToast('Авто-отправка отменена', 'warning');
            break;
        }
        if (typeof tryAcquireSendLock === 'function' && !tryAcquireSendLock(payment.id)) {
            console.warn('Авто-отправка: платёж уже отправляется, пропуск', payment.id);
            skipped++;
            done++;
            if (useBulkProgress) updateBulkProgress({ total, done, success, failed, skipped });
            continue;
        }
        const { serviceName, saleDate, price } = getAutoSendParamsForPayment(payment);
        try {
            const res = await fetch('/api/send-receipt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    payment_id: payment.id,
                    amount: price,
                    service_name: serviceName,
                    sale_date: saleDate
                })
            });
            const data = await res.json();
            if (data.success && !data.alreadySent) {
                success++;
                if (typeof applyOptimisticSent === 'function') {
                    applyOptimisticSent(payment, { receiptUuid: data.receiptUuid, receiptUrlPrint: data.receiptUrlPrint });
                }
                if (data.receiptUuid) {
                    verifyReceiptInTaxAfterAutoSend(data.receiptUuid, payment.id);
                }
            } else if (data.success && data.alreadySent) {
                skipped++;
                if (typeof applyOptimisticSent === 'function') {
                    applyOptimisticSent(payment, { receiptUuid: data.receiptUuid, receiptUrlPrint: data.receiptUrlPrint });
                }
            } else if (!data.success) {
                failed++;
            }
        } catch (e) {
            failed++;
            console.error('Авто-отправка чека:', e);
        } finally {
            if (typeof releaseSendLock === 'function') releaseSendLock(payment.id);
        }
        done++;
        if (useBulkProgress) updateBulkProgress({ total, done, success, failed, skipped });
        // Проверяем отмену перед задержкой — мгновенная реакция на кнопку «Отменить»
        if (autoSendAbortRequested || bulkOperationAborted) {
            showToast('Авто-отправка отменена', 'warning');
            break;
        }
        const delayMs = autoSendSettings.onlyNew ? 400 : 10000;
        await new Promise(r => setTimeout(r, delayMs));
    }
    
    if (useBulkProgress) hideBulkProgress();
    
    const aborted = autoSendAbortRequested || bulkOperationAborted;
    if (success > 0 || skipped > 0) {
        let msg = `Авто-отправка: отправлено ${success}`;
        if (skipped > 0) msg += `, уже были: ${skipped}`;
        if (failed > 0) msg += `, ошибок: ${failed}`;
        if (aborted) msg += ' (прервано)';
        showToast(msg, aborted ? 'warning' : 'success');
        if (typeof loadStats === 'function') await loadStats();
    } else if (failed > 0) {
        showToast(`Авто-отправка: ошибок ${failed}`, 'error');
    } else if (aborted && done === 0) {
        showToast('Авто-отправка отменена', 'warning');
    }
}

async function runAutoSendIfEnabled(previousPaymentIds) {
    if (typeof loadAutoSendSettings !== 'function') return;
    loadAutoSendSettings();
    if (!autoSendSettings.enabled) return;
    await autoSendNewPayments(previousPaymentIds || new Set());
}

function cancelAutoSend() {
    autoSendAbortRequested = true;
    if (typeof bulkOperationAborted !== 'undefined') bulkOperationAborted = true;
    autoSendSettings.enabled = false;
    if (typeof saveAutoSendSettings === 'function') saveAutoSendSettings();
    const btn = document.getElementById('autoSendBtn');
    if (btn) {
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-outline-secondary');
    }
    // Снимаем галочку и скрываем блок опций и кнопку в модалке
    const elEnabled = document.getElementById('autoSendEnabled');
    const opt = document.getElementById('autoSendOptions');
    const cancelBtn = document.getElementById('autoSendCancelBtn');
    if (elEnabled) elEnabled.checked = false;
    if (opt) opt.classList.add('hidden');
    if (cancelBtn) cancelBtn.classList.add('hidden');
    showToast('Авто-отправка выключена', 'warning');
}

function getAutoSyncIntervalLabel(seconds) {
    if (seconds < 60) return `${seconds} сек`;
    if (seconds === 60) return '1 мин';
    if (seconds === 120) return '2 мин';
    if (seconds === 300) return '5 мин';
    return `${Math.floor(seconds / 60)} мин`;
}

function updateAutoSendSyncStatusText() {
    const el = document.getElementById('autoSendSyncStatusText');
    if (!el) return;
    if (typeof loadAutoSyncSettings === 'function') loadAutoSyncSettings();
    if (autoSyncEnabled) {
        el.textContent = `У вас включена автосинхронизация с ЮКассой (каждые ${getAutoSyncIntervalLabel(autoSyncInterval)}).`;
        el.classList.remove('text-muted');
        el.classList.add('text-success');
    } else {
        el.textContent = 'У вас выключена автосинхронизация с ЮКассой. Включите её выше, чтобы авто-отправка срабатывала по таймеру.';
        el.classList.remove('text-success');
        el.classList.add('text-muted');
    }
}

function toggleAutoSyncFromAutoSendModal() {
    const checked = document.getElementById('autoSendModalAutoSyncCheck')?.checked;
    const intervalBlock = document.getElementById('autoSendModalAutoSyncInterval');
    autoSyncEnabled = !!checked;
    if (intervalBlock) intervalBlock.classList.toggle('hidden', !autoSyncEnabled);
    if (autoSyncEnabled && intervalBlock) autoSendModalScrollToRevealed(intervalBlock);
    if (autoSyncEnabled) {
        autoSyncInterval = parseInt(document.getElementById('autoSendModalAutoSyncSelect')?.value || 30, 10);
        startAutoSync();
        if (typeof updateDropdownText === 'function') updateDropdownText();
        if (typeof updateSyncButtonText === 'function') updateSyncButtonText();
        showToast(`Автосинхронизация включена (каждые ${getAutoSyncIntervalLabel(autoSyncInterval)})`, 'success');
    } else {
        stopAutoSync();
        if (typeof updateDropdownText === 'function') updateDropdownText();
        if (typeof updateSyncButtonText === 'function') updateSyncButtonText();
        showToast('Автосинхронизация отключена', 'warning');
    }
    if (typeof saveAutoSyncSettings === 'function') saveAutoSyncSettings();
    updateAutoSendSyncStatusText();
}

function changeAutoSyncIntervalFromAutoSendModal() {
    const val = document.getElementById('autoSendModalAutoSyncSelect')?.value;
    if (val == null) return;
    autoSyncInterval = parseInt(val, 10);
    if (autoSyncEnabled) {
        stopAutoSync();
        startAutoSync();
        showToast(`Интервал изменён: каждые ${getAutoSyncIntervalLabel(autoSyncInterval)}`, 'success');
    }
    if (typeof updateDropdownText === 'function') updateDropdownText();
    if (typeof updateSyncButtonText === 'function') updateSyncButtonText();
    if (typeof saveAutoSyncSettings === 'function') saveAutoSyncSettings();
    updateAutoSendSyncStatusText();
}

function openAutoSendModal() {
    if (typeof loadAutoSendSettings === 'function') loadAutoSendSettings();
    if (typeof loadAutoSyncSettings === 'function') loadAutoSyncSettings();
    const autoSyncCheck = document.getElementById('autoSendModalAutoSyncCheck');
    const autoSyncIntervalBlock = document.getElementById('autoSendModalAutoSyncInterval');
    const autoSyncSelect = document.getElementById('autoSendModalAutoSyncSelect');
    if (autoSyncCheck) autoSyncCheck.checked = autoSyncEnabled;
    if (autoSyncSelect) autoSyncSelect.value = String(autoSyncInterval);
    if (autoSyncIntervalBlock) autoSyncIntervalBlock.classList.toggle('hidden', !autoSyncEnabled);
    updateAutoSendSyncStatusText();
    const elEnabled = document.getElementById('autoSendEnabled');
    const elYookassa = document.getElementById('autoSendUseYookassaData');
    const elRandom = document.getElementById('autoSendUseRandom');
    const elAllUnsent = document.getElementById('autoSendAllUnsent');
    if (elEnabled) elEnabled.checked = autoSendSettings.enabled;
    if (elYookassa) elYookassa.checked = autoSendSettings.useYookassaData;
    if (elRandom) elRandom.checked = !autoSendSettings.useYookassaData;
    if (elAllUnsent) elAllUnsent.checked = autoSendSettings.onlyNew === false;
    const opt = document.getElementById('autoSendOptions');
    if (opt) opt.classList.toggle('hidden', !autoSendSettings.enabled);
    toggleAutoSendRandomSection();
    document.getElementById('autoSendEnableRandomServiceName').checked = autoSendSettings.random.serviceName.enabled;
    document.getElementById('autoSendEnableRandomDate').checked = autoSendSettings.random.date.enabled;
    document.getElementById('autoSendEnableRandomPrice').checked = autoSendSettings.random.price.enabled;
    document.getElementById('autoSendRandomDateFrom').value = autoSendSettings.random.date.from || '';
    document.getElementById('autoSendRandomDateTo').value = autoSendSettings.random.date.to || '';
    document.getElementById('autoSendRandomPriceFrom').value = autoSendSettings.random.price.from || '';
    document.getElementById('autoSendRandomPriceTo').value = autoSendSettings.random.price.to || '';
    const today = new Date();
    const tenDaysAgo = new Date(today);
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    const dateFrom = document.getElementById('autoSendRandomDateFrom');
    const dateTo = document.getElementById('autoSendRandomDateTo');
    if (dateFrom) { dateFrom.min = tenDaysAgo.toISOString().split('T')[0]; }
    if (dateTo) { dateTo.max = today.toISOString().split('T')[0]; }
    updateAutoSendServiceNamesList();
    toggleAutoSendRandomServiceSection();
    toggleAutoSendRandomDateSection();
    toggleAutoSendRandomPriceSection();
    const cancelBtn = document.getElementById('autoSendCancelBtn');
    if (cancelBtn) cancelBtn.classList.toggle('hidden', !autoSendSettings.enabled);
    openModal('autoSendModal');
}

function updateAutoSendServiceNamesList() {
    const list = document.getElementById('autoSendRandomServiceNamesList');
    if (!list) return;
    const names = Array.isArray(serviceNames) ? serviceNames : [];
    const selected = autoSendSettings.random.serviceName.names || [];
    list.innerHTML = names.map(n => `
        <label>
            <input type="checkbox" value="${escapeHtml(n)}" ${selected.includes(n) ? 'checked' : ''}>
            ${escapeHtml(n)}
        </label>
    `).join('');
}

/** Прокрутить модалку «Авто отправка» к элементу, чтобы раскрытый блок был виден */
function autoSendModalScrollToRevealed(el) {
    if (!el) return;
    const modal = document.getElementById('autoSendModal');
    const modalBody = modal?.querySelector('.modal-body');
    if (!modalBody) return;
    requestAnimationFrame(() => {
        setTimeout(() => {
            const bodyRect = modalBody.getBoundingClientRect();
            const elRect = el.getBoundingClientRect();
            const contentTopOfEl = elRect.top - bodyRect.top + modalBody.scrollTop;
            const targetScroll = Math.max(0, contentTopOfEl - 12);
            modalBody.scrollTo({ top: targetScroll, behavior: 'smooth' });
        }, 80);
    });
}

function toggleAutoSendOptionsVisibility() {
    const enabled = document.getElementById('autoSendEnabled')?.checked;
    const opt = document.getElementById('autoSendOptions');
    const cancelBtn = document.getElementById('autoSendCancelBtn');
    if (opt) opt.classList.toggle('hidden', !enabled);
    if (cancelBtn) cancelBtn.classList.toggle('hidden', !enabled);
    if (enabled) autoSendModalScrollToRevealed(document.getElementById('autoSendOptions'));
}

function toggleAutoSendRandomSection() {
    const useRandom = document.getElementById('autoSendUseRandom')?.checked;
    document.getElementById('autoSendRandomSection')?.classList.toggle('hidden', !useRandom);
    if (useRandom) autoSendModalScrollToRevealed(document.getElementById('autoSendRandomSection'));
}

function toggleAutoSendRandomServiceSection() {
    const on = document.getElementById('autoSendEnableRandomServiceName')?.checked;
    const section = document.getElementById('autoSendRandomServiceNameSection');
    section?.classList.toggle('hidden', !on);
    if (on) autoSendModalScrollToRevealed(section);
}

function toggleAutoSendRandomDateSection() {
    const on = document.getElementById('autoSendEnableRandomDate')?.checked;
    const section = document.getElementById('autoSendRandomDateSection');
    section?.classList.toggle('hidden', !on);
    if (on) autoSendModalScrollToRevealed(section);
}

function toggleAutoSendRandomPriceSection() {
    const on = document.getElementById('autoSendEnableRandomPrice')?.checked;
    const section = document.getElementById('autoSendRandomPriceSection');
    section?.classList.toggle('hidden', !on);
    if (on) autoSendModalScrollToRevealed(section);
}

function saveAutoSendSettingsFromModal() {
    autoSendSettings.enabled = document.getElementById('autoSendEnabled')?.checked || false;
    autoSendSettings.useYookassaData = document.getElementById('autoSendUseYookassaData')?.checked !== false;
    autoSendSettings.onlyNew = document.getElementById('autoSendAllUnsent')?.checked !== true;
    autoSendSettings.random.serviceName.enabled = document.getElementById('autoSendEnableRandomServiceName')?.checked || false;
    autoSendSettings.random.serviceName.names = Array.from(
        document.querySelectorAll('#autoSendRandomServiceNamesList input:checked')
    ).map(el => el.value);
    autoSendSettings.random.date.enabled = document.getElementById('autoSendEnableRandomDate')?.checked || false;
    autoSendSettings.random.date.from = document.getElementById('autoSendRandomDateFrom')?.value || null;
    autoSendSettings.random.date.to = document.getElementById('autoSendRandomDateTo')?.value || null;
    autoSendSettings.random.price.enabled = document.getElementById('autoSendEnableRandomPrice')?.checked || false;
    autoSendSettings.random.price.from = document.getElementById('autoSendRandomPriceFrom')?.value || null;
    autoSendSettings.random.price.to = document.getElementById('autoSendRandomPriceTo')?.value || null;
    if (typeof saveAutoSendSettings === 'function') saveAutoSendSettings();
    closeModal('autoSendModal');
    showToast('Настройки авто-отправки сохранены', 'success');
    const btn = document.getElementById('autoSendBtn');
    if (btn) {
        btn.classList.toggle('btn-primary', autoSendSettings.enabled);
        btn.classList.toggle('btn-outline-secondary', !autoSendSettings.enabled);
    }
}
