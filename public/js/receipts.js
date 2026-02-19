// ==================== SEND RECEIPT ====================

function updateServiceNameCounter() {
    const input = document.getElementById('sendServiceNameInput');
    const counter = document.getElementById('sendServiceNameCounter');
    const length = input.value.length;
    const maxLength = 250;
    
    counter.textContent = `(${length}/${maxLength})`;
    
    if (length > maxLength * 0.9) {
        counter.style.color = 'var(--warning)';
    } else {
        counter.style.color = 'var(--text-secondary)';
    }
    
    // Проверяем, нужно ли показать галочку "Использовать только в этом платеже"
    checkIfNeedShowOnlyThisPaymentCheckbox();
}

function checkIfNeedShowOnlyThisPaymentCheckbox() {
    if (!currentPaymentForReceipt) return;
    
    const input = document.getElementById('sendServiceNameInput');
    const container = document.getElementById('sendUseOnlyThisPaymentContainer');
    const checkbox = document.getElementById('sendUseOnlyThisPayment');
    
    const currentValue = input.value.trim();
    
    // Проверяем, изменил ли пользователь оригинальное значение
    const isModified = currentValue !== '' && currentValue !== originalServiceName;
    
    // Проверяем, есть ли текущее значение в БД
    const isInDatabase = serviceNames.includes(currentValue);
    
    if (isModified && !isInDatabase) {
        // Показываем галочку для новой/изменённой услуги
        container.style.display = 'block';
        checkbox.checked = true;
    } else if (isModified && isInDatabase) {
        // Услуга изменена на другую из БД - показываем галочку, но снимаем её
        container.style.display = 'block';
        checkbox.checked = false;
    } else {
        // Текст не изменён или равен оригиналу - скрываем галочку
        container.style.display = 'none';
    }
}

function toggleServiceDropdown() {
    const dropdown = document.getElementById('serviceDropdown');
    dropdown.classList.toggle('active');
    
    if (dropdown.classList.contains('active')) {
        renderServiceDropdown();
    }
}

function renderServiceDropdown() {
    const dropdown = document.getElementById('serviceDropdown');
    
    if (!currentPaymentForReceipt) {
        dropdown.innerHTML = '<div class="service-dropdown-empty">Нет доступных услуг</div>';
        return;
    }
    
    const payment = currentPaymentForReceipt;
    const yookassaDescription = payment.description && payment.description.trim() ? payment.description : null;
    const isYookassaInList = yookassaDescription && serviceNames.includes(yookassaDescription);
    
    let html = '';
    
    // Если есть описание из ЮКассы и его нет в списке, добавляем его первым
    if (yookassaDescription && !isYookassaInList) {
        html += `<div class="service-dropdown-item from-yookassa" onclick="selectServiceFromDropdown('${escapeHtml(yookassaDescription).replace(/'/g, "\\'")}')">
            📦 ${escapeHtml(yookassaDescription)} <small style="color: var(--text-secondary);">(из ЮКасса)</small>
        </div>`;
    }
    
    // Если есть описание из ЮКассы и оно есть в списке, добавляем его с пометкой
    if (yookassaDescription && isYookassaInList) {
        html += `<div class="service-dropdown-item from-yookassa" onclick="selectServiceFromDropdown('${escapeHtml(yookassaDescription).replace(/'/g, "\\'")}')">
            <i class="bi bi-check-circle-fill text-success me-1"></i>${escapeHtml(yookassaDescription)} <small style="color: var(--text-secondary);">(из ЮКасса)</small>
        </div>`;
    }
    
    // Добавляем остальные услуги из БД
    const otherServices = yookassaDescription && isYookassaInList 
        ? serviceNames.filter(name => name !== yookassaDescription)
        : serviceNames;
    
    otherServices.forEach(name => {
        html += `<div class="service-dropdown-item" onclick="selectServiceFromDropdown('${escapeHtml(name).replace(/'/g, "\\'")}')">
            ${escapeHtml(name)}
        </div>`;
    });
    
    if (html === '') {
        html = '<div class="service-dropdown-empty"><i class="bi bi-pencil me-2"></i>Нет сохранённых услуг. Введите название вручную.</div>';
    }
    
    dropdown.innerHTML = html;
}

function selectServiceFromDropdown(serviceName) {
    const input = document.getElementById('sendServiceNameInput');
    input.value = serviceName;
    
    // Запоминаем выбранную услугу как оригинальную
    originalServiceName = serviceName;
    
    updateServiceNameCounter();
    
    // Закрываем dropdown
    document.getElementById('serviceDropdown').classList.remove('active');
}

// Закрываем dropdown при клике вне его
document.addEventListener('click', function(e) {
    const dropdown = document.getElementById('serviceDropdown');
    const btn = document.getElementById('btnShowServices');
    const input = document.getElementById('sendServiceNameInput');
    
    if (dropdown && !dropdown.contains(e.target) && e.target !== btn && e.target !== input) {
        dropdown.classList.remove('active');
    }
});

async function openSendReceipt(paymentId) {
    const payment = payments.find(p => p.id === paymentId);
    if (!payment) return;
    
    currentPaymentForReceipt = payment;
    
    document.getElementById('sendReceiptPaymentInfo').innerHTML = `
        <strong>Платеж:</strong> ${formatCurrency(payment.amount)} • ${formatDateTime(payment.paid_at)}<br>
        <strong>Описание в ЮКасса:</strong> ${escapeHtml(payment.description || 'Без описания')}
    `;
    
    // Загружаем настройку максимального количества дней назад
    let maxDaysBack = 30; // По умолчанию
    try {
        const res = await fetch('/api/config');
        const config = await res.json();
        if (config && config.max_days_back) {
            maxDaysBack = config.max_days_back;
        }
    } catch (e) {
        console.error('Ошибка загрузки настроек:', e);
    }
    
    // Set sale date and time (используем глобальные toMoscowTime/toDatetimeLocal из utils.js)
    const nowMoscow = toMoscowTime(new Date());
    const maxDaysAgoMoscow = new Date(nowMoscow);
    maxDaysAgoMoscow.setDate(maxDaysAgoMoscow.getDate() - maxDaysBack);
    
    const paymentTime = toMoscowTime(payment.paid_at || payment.created_at);
    
    const saleDate = document.getElementById('sendSaleDate');
    saleDate.max = toDatetimeLocal(nowMoscow);
    saleDate.min = toDatetimeLocal(maxDaysAgoMoscow);
    saleDate.value = toDatetimeLocal(paymentTime);
    
    // Устанавливаем значения по умолчанию из платежа ЮКассы
    document.getElementById('sendPrice').value = payment.amount;
    
    // Формируем список услуг для выбора
    const serviceInput = document.getElementById('sendServiceNameInput');
    
    // Проверяем, есть ли описание из ЮКассы
    const yookassaDescription = payment.description && payment.description.trim() ? payment.description : null;
    const isYookassaInList = yookassaDescription && serviceNames.includes(yookassaDescription);
    
    // Устанавливаем описание из ЮКассы как значение по умолчанию
    if (yookassaDescription) {
        serviceInput.value = yookassaDescription;
        originalServiceName = yookassaDescription;
    } else if (serviceNames.length > 0) {
        serviceInput.value = serviceNames[0];
        originalServiceName = serviceNames[0];
    } else {
        serviceInput.value = '';
        originalServiceName = '';
    }
    
    // Обновляем счётчик символов и проверяем галочку
    updateServiceNameCounter();
    
    // Скрываем галочку по умолчанию (она появится при изменении текста)
    document.getElementById('sendUseOnlyThisPaymentContainer').style.display = 'none';
    
    // Включаем кнопку "Отправить с данными как в ЮКасса" по умолчанию
    document.getElementById('sendRandomServiceName').checked = false;
    setSendUseYookassaData(true);
    
    openModal('sendReceiptModal');
}

function setSendUseYookassaData(useYookassa) {
    const btnYookassa = document.getElementById('btnYookassaData');
    const btnCustom = document.getElementById('btnCustomData');
    
    // Устанавливаем активную кнопку
    if (useYookassa) {
        btnYookassa.classList.add('active');
        btnCustom.classList.remove('active');
    } else {
        btnYookassa.classList.remove('active');
        btnCustom.classList.add('active');
    }
    
    // Блокируем/разблокируем поля в зависимости от переключателя
    document.getElementById('sendServiceNameInput').disabled = useYookassa;
    document.getElementById('btnShowServices').disabled = useYookassa;
    document.getElementById('sendUseOnlyThisPayment').disabled = useYookassa;
    document.getElementById('sendRandomServiceName').disabled = useYookassa;
    document.getElementById('sendSaleDate').disabled = useYookassa;
    document.getElementById('sendPrice').disabled = useYookassa;
    
    // Закрываем dropdown если открыт
    if (useYookassa) {
        document.getElementById('serviceDropdown').classList.remove('active');
    }
    
    // Если включили режим "Данные как в ЮКасса", восстанавливаем значения из ЮКассы
    if (useYookassa && currentPaymentForReceipt) {
        const payment = currentPaymentForReceipt;
        
        // Восстанавливаем дату из платежа (используем глобальные toMoscowTime/toDatetimeLocal из utils.js)
        const paymentTime = toMoscowTime(payment.paid_at || payment.created_at);
        document.getElementById('sendSaleDate').value = toDatetimeLocal(paymentTime);
        
        // Восстанавливаем цену
        document.getElementById('sendPrice').value = payment.amount;
        
        // Восстанавливаем услугу из ЮКассы
        const serviceInput = document.getElementById('sendServiceNameInput');
        if (payment.description && payment.description.trim()) {
            serviceInput.value = payment.description;
            originalServiceName = payment.description;
        }
        
        updateServiceNameCounter();
        
        // Скрываем галочку при восстановлении
        document.getElementById('sendUseOnlyThisPaymentContainer').style.display = 'none';
        
        // Сбрасываем рандомное наименование
        document.getElementById('sendRandomServiceName').checked = false;
    }
}

function toggleSendRandomService() {
    const checked = document.getElementById('sendRandomServiceName').checked;
    const btnYookassa = document.getElementById('btnYookassaData');
    const useYookassaData = btnYookassa.classList.contains('active');
    
    // Если включена кнопка "Данные как в ЮКасса", не позволяем изменять
    if (!useYookassaData) {
        document.getElementById('sendServiceNameInput').disabled = checked;
        document.getElementById('btnShowServices').disabled = checked;
        document.getElementById('sendUseOnlyThisPayment').disabled = checked;
        
        // Если включили рандом, ставим галочку "использовать только в этом платеже"
        if (checked) {
            document.getElementById('sendUseOnlyThisPayment').checked = true;
            // Закрываем dropdown
            document.getElementById('serviceDropdown').classList.remove('active');
        }
    }
}

function checkReceiptDateLegal() {
    const selectedDate = document.getElementById('sendSaleDate').value;
    if (!selectedDate) return;
    
    const dateWarning = document.getElementById('dateWarning');
    const saleDate = new Date(selectedDate);
    const now = new Date();
    
    // Определяем крайний срок для выбранной даты
    // Если услуга в прошлом месяце - крайний срок 9 число следующего месяца
    const saleMonth = saleDate.getMonth();
    const saleYear = saleDate.getFullYear();
    
    // Крайний срок - 9 число следующего месяца после месяца услуги
    const deadlineMonth = saleMonth === 11 ? 0 : saleMonth + 1;
    const deadlineYear = saleMonth === 11 ? saleYear + 1 : saleYear;
    const deadline = new Date(deadlineYear, deadlineMonth, 9, 23, 59, 59);
    
    if (now > deadline) {
        const monthNames = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 
                           'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
        const deadlineStr = `9 ${monthNames[deadlineMonth]} ${deadlineYear}`;
        
        dateWarning.innerHTML = `<i class="bi bi-exclamation-triangle-fill me-1"></i>ВНИМАНИЕ: Крайний срок для этой даты был ${deadlineStr}! Отправка может быть незаконной.`;
        dateWarning.style.display = 'block';
    } else {
        dateWarning.style.display = 'none';
    }
}

async function confirmSendReceipt() {
    if (!currentPaymentForReceipt) return;
    
    const payment = currentPaymentForReceipt;
    const btnYookassa = document.getElementById('btnYookassaData');
    const useYookassaData = btnYookassa.classList.contains('active');
    
    let serviceName, saleDate, price;
    
    if (useYookassaData) {
        // Отправляем с данными из ЮКассы
        serviceName = payment.description || (serviceNames.length > 0 ? serviceNames[0] : 'Услуга');
        saleDate = payment.paid_at || payment.created_at;
        price = payment.amount;
    } else {
        // Отправляем с выбранными данными
        const isRandom = document.getElementById('sendRandomServiceName').checked;
        
        if (isRandom && serviceNames.length > 0) {
            // Выбираем случайную услугу только из сохранённых в БД
            serviceName = serviceNames[Math.floor(Math.random() * serviceNames.length)];
        } else {
            serviceName = document.getElementById('sendServiceNameInput').value.trim();
        }
        
        // Сохраняем новую услугу в БД только если это не служебная подстановка
        const useOnlyThisPayment = document.getElementById('sendUseOnlyThisPayment').checked;
        const defaultPlaceholders = ['Услуги VPN', 'Услуга'];
        const isRealServiceName = serviceName && !defaultPlaceholders.includes(serviceName);
        if (!useOnlyThisPayment && isRealServiceName && !serviceNames.includes(serviceName)) {
            try {
                const res = await fetch('/api/service-names', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: serviceName })
                });
                const data = await res.json();
                
                if (data.success) {
                    serviceNames = data.service_names;
                    updateServiceNameSelects();
                    updateServicesBadge();
                    showToast('Услуга добавлена в БД', 'success');
                }
            } catch (e) {
                console.error('Ошибка добавления услуги:', e);
            }
        }
        
        saleDate = document.getElementById('sendSaleDate').value;
        price = document.getElementById('sendPrice').value || payment.amount;
    }
    
    if (!serviceName) {
        showToast('Введите наименование услуги', 'warning');
        return;
    }
    
    closeModal('sendReceiptModal');
    await sendReceipt(payment, serviceName, saleDate, price);
}

async function sendReceipt(payment, serviceName, saleDate, price) {
    if (typeof tryAcquireSendLock === 'function' && !tryAcquireSendLock(payment.id)) {
        showToast('Этот чек уже отправляется, подождите', 'warning');
        return;
    }
    showToast(`Отправка чека...`, 'warning');
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
        
        if (data.success) {
            if (typeof applyOptimisticSent === 'function') {
                applyOptimisticSent(payment, { receiptUuid: data.receiptUuid, receiptUrlPrint: data.receiptUrlPrint });
            } else if (typeof updateSinglePayment === 'function') {
                await updateSinglePayment(payment.id);
            }
            if (typeof loadStatsQuietly === 'function') await loadStatsQuietly();
            if (data.alreadySent) {
                showToast('Чек уже был отправлен в налоговую', 'info');
            } else {
                showToast('Чек успешно отправлен!', 'success');
                // Фоновая проверка статуса в налоговой (fire-and-forget, lock уже не нужен)
                if (data.receiptUuid) {
                    scheduleReceiptStatusCheck(data.receiptUuid, payment.id);
                }
            }
        } else {
            showToast(`Ошибка: ${data.error}`, 'error');
            await updateSinglePayment(payment.id);
        }
    } catch (e) {
        showToast(`Ошибка сети: ${e.message}`, 'error');
        await updateSinglePayment(payment.id);
    } finally {
        if (typeof releaseSendLock === 'function') releaseSendLock(payment.id);
    }
}

/** Фоновая проверка статуса чека в налоговой (fire-and-forget, не блокирует отправку) */
async function scheduleReceiptStatusCheck(receiptUuid, paymentId) {
    const maxAttempts = 5;
    const delays = [4000, 5000, 6000, 7000, 8000];
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const delay = delays[attempt - 1] || 8000;
        await new Promise(r => setTimeout(r, delay));
        
        try {
            const checkRes = await fetch('/api/check-receipt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ receipt_uuid: receiptUuid })
            });
            const checkData = await checkRes.json();
            
            if (checkData.success && checkData.receipt) {
                showToast('Чек подтвержден налоговой!', 'success');
                if (typeof updateSinglePayment === 'function') await updateSinglePayment(paymentId);
                return;
            } else if (checkData.notFound && attempt < maxAttempts) {
                continue;
            } else if (checkData.notFound) {
                showToast('Чек отправлен. Проверьте позже или сделайте синхронизацию', 'success');
                if (typeof updateSinglePayment === 'function') await updateSinglePayment(paymentId);
                return;
            } else {
                showToast(`Ошибка проверки: ${checkData.error}`, 'error');
                if (typeof updateSinglePayment === 'function') await updateSinglePayment(paymentId);
                return;
            }
        } catch (e) {
            if (typeof updateSinglePayment === 'function') await updateSinglePayment(paymentId);
            return;
        }
    }
}

// ==================== BULK PROGRESS ====================

let bulkOperationAborted = false;

function abortBulkOperation() {
    bulkOperationAborted = true;
    // Останавливаем и авто-отправку, если она активна
    if (typeof autoSendAbortRequested !== 'undefined') autoSendAbortRequested = true;
}

function showBulkProgress(opts) {
    bulkOperationAborted = false;
    const wrap = document.getElementById('bulkProgressWrap');
    const label = document.getElementById('bulkProgressLabel');
    const count = document.getElementById('bulkProgressCount');
    const bar = document.getElementById('bulkProgressBar');
    const detail = document.getElementById('bulkProgressDetail');
    const abortBtn = document.getElementById('bulkProgressAbortBtn');
    if (!wrap || !label || !count || !bar || !detail) return;
    const total = opts.total || 0;
    label.textContent = opts.label || 'Обработка...';
    count.textContent = `0 из ${total}`;
    detail.textContent = 'Успешно: 0, ошибок: 0';
    bar.style.width = '0%';
    bar.setAttribute('aria-valuenow', 0);
    wrap.classList.remove('hidden');
    if (abortBtn) abortBtn.disabled = false;
    document.querySelectorAll('.bulk-btn-send, .bulk-btn-cancel').forEach(b => { b.disabled = true; });
    // Принудительно показываем панель bulk actions (может быть скрыта, если нет выделенных платежей)
    const bulkBar = document.getElementById('bulkActions');
    if (bulkBar && !bulkBar.classList.contains('visible')) {
        bulkBar.classList.add('visible');
        bulkBar._autoShown = true;
    }
    // Скрываем основную панель (инфо + кнопки), оставляя только прогресс-бар
    const inner = bulkBar?.querySelector('.bulk-actions-bar-inner');
    if (inner) inner.classList.add('hidden');
}

function hideBulkProgress() {
    const wrap = document.getElementById('bulkProgressWrap');
    if (wrap) wrap.classList.add('hidden');
    const abortBtn = document.getElementById('bulkProgressAbortBtn');
    if (abortBtn) abortBtn.disabled = false;
    document.querySelectorAll('.bulk-btn-send, .bulk-btn-cancel').forEach(b => { b.disabled = false; });
    // Если панель была показана принудительно (авто-отправка без выделения) — скрываем обратно
    const bulkBar = document.getElementById('bulkActions');
    if (bulkBar && bulkBar._autoShown) {
        bulkBar.classList.remove('visible');
        delete bulkBar._autoShown;
    }
    // Показываем обратно основную панель
    const inner = bulkBar?.querySelector('.bulk-actions-bar-inner');
    if (inner) inner.classList.remove('hidden');
}

function updateBulkProgress(opts) {
    const count = document.getElementById('bulkProgressCount');
    const bar = document.getElementById('bulkProgressBar');
    const detail = document.getElementById('bulkProgressDetail');
    if (!count || !bar || !detail) return;
    const total = opts.total || 1;
    const done = opts.done || 0;
    const success = opts.success ?? 0;
    const failed = opts.failed ?? 0;
    const skipped = opts.skipped ?? 0;
    const pct = total ? Math.round((done / total) * 100) : 0;
    count.textContent = `${done} из ${total}`;
    bar.style.width = pct + '%';
    bar.setAttribute('aria-valuenow', pct);
    let detailParts = [`Успешно: ${success}`];
    if (skipped > 0) detailParts.push(`уже отправлены: ${skipped}`);
    if (failed > 0) detailParts.push(`ошибок: ${failed}`);
    else detailParts.push(`ошибок: 0`);
    detail.textContent = detailParts.join(', ');
}


// ==================== BULK SEND ====================

async function sendSelectedReceipts() {
    if (selectedPayments.size === 0) return;
    
    const useYookassaData = document.getElementById('bulkUseYookassaData').checked;
    const useRandom = document.getElementById('randomSettingsCheck').checked;
    
    // Построим Map для O(1) поиска по id
    const paymentsMap = new Map();
    payments.forEach(p => paymentsMap.set(p.id, p));
    
    // Фильтруем: отправляем только те, которые реально можно отправить (pending / canceled / error без чека в налоговой)
    const idsToProcess = [];
    let skippedAlreadySent = 0;
    for (const id of selectedPayments) {
        const p = paymentsMap.get(id);
        if (!p) continue;
        const canSend = (p.receipt_status === 'pending' && !p.in_tax_service) ||
                        p.receipt_status === 'canceled' ||
                        (p.receipt_status === 'error' && !p.in_tax_service);
        if (canSend) {
            idsToProcess.push(id);
        } else {
            skippedAlreadySent++;
        }
    }
    
    if (idsToProcess.length === 0) {
        if (skippedAlreadySent > 0) {
            showToast('Все выбранные чеки уже отправлены', 'info');
        }
        return;
    }
    
    // Если используем данные из ЮКассы, рандомные настройки игнорируются
    if (useYookassaData) {
        let hasNoDescription = false;
        for (const id of idsToProcess) {
            const payment = paymentsMap.get(id);
            if (payment && !payment.description) { hasNoDescription = true; break; }
        }
        if (hasNoDescription && serviceNames.length === 0) {
            showToast('Добавьте хотя бы одно наименование услуги для платежей без описания', 'warning');
            return;
        }
    } else if (useRandom) {
        if (!randomSettings.serviceName.enabled || randomSettings.serviceName.names.length === 0) {
            showToast('Выберите наименования для рандома', 'warning');
            expandRandomPanel();
            return;
        }
    } else {
        if (serviceNames.length === 0) {
            showToast('Добавьте хотя бы одно наименование услуги', 'warning');
            return;
        }
    }
    
    const defaultServiceName = serviceNames.length > 0 ? serviceNames[0] : 'Услуга';
    let success = 0, failed = 0, alreadySentCount = 0;
    const total = idsToProcess.length;
    showBulkProgress({ total, label: 'Отправка чеков' });
    showToast(`Отправка ${total} чеков${skippedAlreadySent > 0 ? ` (${skippedAlreadySent} пропущено — уже отправлены)` : ''}...`, 'warning');
    let done = 0;
    for (const id of idsToProcess) {
        if (bulkOperationAborted) break;
        const payment = paymentsMap.get(id);
        if (!payment) {
            done++;
            updateBulkProgress({ total, done, success, failed });
            continue;
        }
        if (typeof tryAcquireSendLock === 'function' && !tryAcquireSendLock(payment.id)) {
            failed++;
            done++;
            updateBulkProgress({ total, done, success, failed });
            continue;
        }
        let serviceName, saleDate, price;
        
        if (useYookassaData) {
            serviceName = payment.description || defaultServiceName;
            saleDate = payment.paid_at || payment.created_at;
            price = payment.amount;
        } else if (useRandom) {
            if (randomSettings.serviceName.enabled && randomSettings.serviceName.names.length > 0) {
                serviceName = randomSettings.serviceName.names[Math.floor(Math.random() * randomSettings.serviceName.names.length)];
            } else {
                serviceName = defaultServiceName;
            }
            
            if (randomSettings.date.enabled && randomSettings.date.from && randomSettings.date.to) {
                const from = new Date(randomSettings.date.from + 'T00:00:00');
                const to = new Date(randomSettings.date.to + 'T23:59:59');
                const diff = to.getTime() - from.getTime();
                const randomDateTime = new Date(from.getTime() + Math.random() * diff);
                const utcTime = randomDateTime.getTime() + (randomDateTime.getTimezoneOffset() * 60000);
                const moscowTime = new Date(utcTime + (3 * 3600000));
                saleDate = moscowTime.toISOString();
            } else {
                saleDate = (payment.paid_at || payment.created_at);
            }
            
            if (randomSettings.price.enabled && randomSettings.price.from && randomSettings.price.to) {
                const pFrom = parseFloat(randomSettings.price.from);
                const pTo = parseFloat(randomSettings.price.to);
                price = (pFrom + Math.random() * (pTo - pFrom)).toFixed(2);
            } else {
                price = payment.amount;
            }
        } else {
            serviceName = defaultServiceName;
            saleDate = (payment.paid_at || payment.created_at);
            price = payment.amount;
        }
        
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
                } else if (typeof updateSinglePayment === 'function') {
                    await updateSinglePayment(payment.id);
                }
            } else if (data.success && data.alreadySent) {
                alreadySentCount++;
                if (typeof applyOptimisticSent === 'function') {
                    applyOptimisticSent(payment, { receiptUuid: data.receiptUuid, receiptUrlPrint: data.receiptUrlPrint });
                }
            } else {
                failed++;
            }
        } catch (e) {
            failed++;
        } finally {
            if (typeof releaseSendLock === 'function') releaseSendLock(payment.id);
        }
        done++;
        updateBulkProgress({ total, done, success, failed, skipped: alreadySentCount });
        if (bulkOperationAborted) break;
        const delayBetweenReceiptsMs = 10000;
        await new Promise(r => setTimeout(r, delayBetweenReceiptsMs));
    }
    hideBulkProgress();
    if (bulkOperationAborted) {
        showToast('Операция прервана', 'warning');
        // Не перерисовываем всё — каждый платёж уже обновлён через applyOptimisticSent
        if (typeof updateBulkActions === 'function') updateBulkActions();
    } else {
        let msg = `Отправлено: ${success}`;
        if (alreadySentCount > 0) msg += `, уже были: ${alreadySentCount}`;
        if (failed > 0) msg += `, ошибок: ${failed}`;
        showToast(msg, success > 0 ? 'success' : (failed > 0 ? 'error' : 'info'));
        // Снимаем выделение без полной перерисовки (clearSelection обновит чекбоксы и панель)
        if (typeof clearSelection === 'function') clearSelection();
    }
    if (typeof loadStats === 'function') await loadStats();
}

// ==================== RANDOM SETTINGS ====================

function toggleBulkUseYookassaData() {
    const useYookassaData = document.getElementById('bulkUseYookassaData').checked;
    
    // Если включили "Отправить с данными как в ЮКасса", выключаем "Рандомные настройки"
    if (useYookassaData) {
        document.getElementById('randomSettingsCheck').checked = false;
    }
}

function toggleRandomSettings() {
    const useRandom = document.getElementById('randomSettingsCheck').checked;

    if (useRandom) {
        document.getElementById('bulkUseYookassaData').checked = false;
        toggleBulkUseYookassaData();
        expandRandomPanel();
    } else {
        collapseRandomPanel();
    }
}

function expandRandomPanel() {
    const bar = document.getElementById('bulkActions');
    const expand = document.getElementById('bulkRandomExpand');
    if (!bar || !expand) return;

    if (typeof updateServiceNameSelects === 'function') updateServiceNameSelects();

    document.getElementById('enableRandomServiceName').checked = randomSettings.serviceName.enabled;
    document.getElementById('enableRandomDate').checked = randomSettings.date.enabled;
    document.getElementById('enableRandomPrice').checked = randomSettings.price.enabled;
    document.getElementById('randomDateFrom').value = randomSettings.date.from || '';
    document.getElementById('randomDateTo').value = randomSettings.date.to || '';
    document.getElementById('randomPriceFrom').value = randomSettings.price.from || '';
    document.getElementById('randomPriceTo').value = randomSettings.price.to || '';
    toggleRandomServiceNameSection();
    toggleRandomDateSection();
    toggleRandomPriceSection();

    bar.classList.add('random-expanded');
}

function collapseRandomPanel(showSavedToast) {
    saveRandomSettings();
    const bar = document.getElementById('bulkActions');
    if (bar) bar.classList.remove('random-expanded');
    if (showSavedToast) showToast('Настройки сохранены', 'success');
}

function toggleRandomServiceNameSection() {
    document.getElementById('randomServiceNameSection').classList.toggle('hidden', 
        !document.getElementById('enableRandomServiceName').checked);
}

function toggleRandomDateSection() {
    document.getElementById('randomDateSection').classList.toggle('hidden', 
        !document.getElementById('enableRandomDate').checked);
}

function toggleRandomPriceSection() {
    document.getElementById('randomPriceSection').classList.toggle('hidden', 
        !document.getElementById('enableRandomPrice').checked);
}

function saveRandomSettings() {
    const enableService = document.getElementById('enableRandomServiceName');
    const enableDate = document.getElementById('enableRandomDate');
    const enablePrice = document.getElementById('enableRandomPrice');
    if (!enableService) return;

    randomSettings.serviceName.enabled = enableService.checked;
    randomSettings.serviceName.names = Array.from(
        document.querySelectorAll('#randomServiceNamesList input:checked')
    ).map(el => el.value);

    randomSettings.date.enabled = enableDate?.checked || false;
    randomSettings.date.from = document.getElementById('randomDateFrom')?.value || null;
    randomSettings.date.to = document.getElementById('randomDateTo')?.value || null;

    randomSettings.price.enabled = enablePrice?.checked || false;
    randomSettings.price.from = document.getElementById('randomPriceFrom')?.value || null;
    randomSettings.price.to = document.getElementById('randomPriceTo')?.value || null;
}

// ==================== CANCEL RECEIPT ====================

function openCancelReceipt(paymentId, receiptUuid) {
    currentReceiptForCancel = { paymentId, receiptUuid };
    openModal('cancelReceiptModal');
}

async function confirmCancelReceipt() {
    if (!currentReceiptForCancel) return;
    
    const reason = document.querySelector('input[name="cancelReason"]:checked')?.value || 'CANCEL';
    
    closeModal('cancelReceiptModal');
    showToast('Аннулирование чека...', 'warning');
    
    try {
        const res = await fetch('/api/cancel-receipt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                payment_id: currentReceiptForCancel.paymentId,
                receipt_uuid: currentReceiptForCancel.receiptUuid,
                reason: reason
            })
        });
        
        const data = await res.json();
        
        if (data.success) {
            showToast('Чек аннулирован', 'success');
            const paymentId = currentReceiptForCancel.paymentId;
            if (paymentId) {
                const p = typeof payments !== 'undefined' && payments.find(px => px.id === paymentId);
                if (typeof applyOptimisticCanceled === 'function' && p) {
                    applyOptimisticCanceled(p);
                    if (typeof loadStatsQuietly === 'function') await loadStatsQuietly();
                } else if (typeof updateSinglePayment === 'function') {
                    await updateSinglePayment(paymentId);
                }
            } else {
                // Если нет paymentId, обновляем все
                const hasExistingData = Array.isArray(payments) && payments.length > 0;
                await Promise.all([
                    loadPayments({ showSkeleton: !hasExistingData, resetPagination: false }),
                    loadStats()
                ]);
            }
        } else {
            showToast(`Ошибка: ${data.error}`, 'error');
        }
    } catch (e) {
        showToast('Ошибка сети', 'error');
    }
}

/** Массовая аннуляция выбранных отправленных чеков */
async function cancelSelectedReceipts() {
    if (typeof selectedPayments === 'undefined' || typeof payments === 'undefined') return;
    
    // Map для O(1) поиска
    const paymentsMap = new Map();
    payments.forEach(p => paymentsMap.set(p.id, p));
    
    const toCancel = [];
    selectedPayments.forEach(id => {
        const p = paymentsMap.get(id);
        if (!p) return;
        const canCancel = (p.receipt_status === 'sent' || p.in_tax_service) && p.receipt_uuid && p.receipt_status !== 'canceled';
        if (canCancel) toCancel.push({ paymentId: p.id, receiptUuid: p.receipt_uuid });
    });
    if (toCancel.length === 0) {
        showToast('Среди выбранных нет чеков для аннулирования', 'warning');
        return;
    }
    if (!confirm(`Аннулировать ${toCancel.length} чек(ов) в налоговой?`)) return;
    const delayBetweenMs = 5000;
    const total = toCancel.length;
    let success = 0;
    let failed = 0;
    let done = 0;
    showBulkProgress({ total, label: 'Аннулирование чеков' });
    showToast(`Аннулирование ${total} чеков...`, 'info');
    for (const { paymentId, receiptUuid } of toCancel) {
        if (bulkOperationAborted) break;
        try {
            const res = await fetch('/api/cancel-receipt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ payment_id: paymentId, receipt_uuid: receiptUuid, reason: 'CANCEL' })
            });
            const data = await res.json();
            if (data.success) {
                success++;
                const p = paymentsMap.get(paymentId);
                if (typeof applyOptimisticCanceled === 'function' && p) {
                    applyOptimisticCanceled(p);
                } else if (typeof updateSinglePayment === 'function') {
                    await updateSinglePayment(paymentId);
                }
            } else {
                failed++;
            }
        } catch (e) {
            failed++;
        }
        done++;
        updateBulkProgress({ total, done, success, failed });
        if (bulkOperationAborted) break;
        await new Promise(r => setTimeout(r, delayBetweenMs));
    }
    hideBulkProgress();
    if (bulkOperationAborted) {
        showToast('Операция прервана', 'warning');
    } else {
        if (typeof clearSelection === 'function') clearSelection();
        showToast(`Аннулировано: ${success}, ошибок: ${failed}`, success > 0 ? 'success' : 'error');
    }
    if (typeof loadStats === 'function') await loadStats();
}
