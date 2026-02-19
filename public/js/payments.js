// ==================== PAYMENTS ====================

// Обновить один платеж без перезагрузки всей страницы
async function updateSinglePayment(paymentId) {
    try {
        // Загружаем обновленные данные платежа с сервера
        const dateFrom = document.getElementById('dateFrom');
        const dateTo = document.getElementById('dateTo');
        
        const params = new URLSearchParams({
            date_from: dateFrom.value + 'T00:00:00',
            date_to: dateTo.value + 'T23:59:59'
        });
        
        const res = await fetch(`/api/payments?${params}`);
        const data = await res.json();
        
        if (!data.success) {
            console.error('Ошибка загрузки обновленных данных');
            return false;
        }
        
        // Находим обновленный платеж
        const updatedPayment = data.payments.find(p => p.id === paymentId);
        if (!updatedPayment) {
            console.error('Платеж не найден после обновления');
            return false;
        }
        
        // Обновляем в массиве allPaymentsRaw
        const rawIndex = allPaymentsRaw.findIndex(p => p.id === paymentId);
        if (rawIndex >= 0) {
            allPaymentsRaw[rawIndex] = updatedPayment;
        }
        
        // Обновляем в массиве payments (с учетом фильтров)
        const filteredIndex = payments.findIndex(p => p.id === paymentId);
        if (filteredIndex >= 0) {
            payments[filteredIndex] = updatedPayment;
            
            // Обновляем DOM элемент
            updatePaymentDOM(updatedPayment);
            
            // Обновляем заголовок группы (количество pending и сумма)
            updateGroupHeader(updatedPayment);
        }
        
        // Обновляем только статистику (без перезагрузки чеков)
        await loadStatsQuietly();
        
        return true;
    } catch (e) {
        console.error('Ошибка обновления платежа:', e);
        return false;
    }
}

/** Сразу обновить статус платежа после успешной отправки чека (без доп. запроса к серверу) */
function applyOptimisticSent(payment, responseData) {
    if (!payment || !responseData) return;
    const updated = {
        ...payment,
        receipt_status: 'sent',
        in_tax_service: true,
        receipt_uuid: responseData.receiptUuid || payment.receipt_uuid,
        receipt_url_print: responseData.receiptUrlPrint || payment.receipt_url_print
    };
    const rawIdx = allPaymentsRaw.findIndex(p => p.id === payment.id);
    if (rawIdx >= 0) allPaymentsRaw[rawIdx] = updated;
    const payIdx = payments.findIndex(p => p.id === payment.id);
    if (payIdx >= 0) {
        payments[payIdx] = updated;
        updatePaymentDOM(updated);
        updateGroupHeader(updated);
    }
}

/** Сразу обновить статус платежа после успешной аннуляции чека */
function applyOptimisticCanceled(payment) {
    if (!payment) return;
    const updated = {
        ...payment,
        receipt_status: 'canceled',
        in_tax_service: false,
        receipt_url_print: null,
        canceled_at: new Date().toISOString()
    };
    const rawIdx = allPaymentsRaw.findIndex(p => p.id === payment.id);
    if (rawIdx >= 0) allPaymentsRaw[rawIdx] = updated;
    const payIdx = payments.findIndex(p => p.id === payment.id);
    if (payIdx >= 0) {
        payments[payIdx] = updated;
        updatePaymentDOM(updated);
        updateGroupHeader(updated);
    }
}

// Обновить DOM элемент платежа (in-place, без удаления из DOM — исключает мигание)
function updatePaymentDOM(payment) {
    const row = document.querySelector(`.payment-row[data-id="${payment.id}"]`);
    if (!row) {
        console.warn('DOM элемент платежа не найден:', payment.id);
        return;
    }
    
    const newRowHTML = renderPaymentRow(payment);
    const temp = document.createElement('div');
    temp.innerHTML = newRowHTML;
    const newRow = temp.firstElementChild;
    
    // Обновляем in-place: элемент остаётся в DOM, меняется только класс и содержимое
    row.className = newRow.className;
    row.innerHTML = newRow.innerHTML;
}

// Обновить заголовок группы (количество pending и сумма)
function updateGroupHeader(payment) {
    // Находим дату группы для этого платежа
    const groupType = document.getElementById('groupingType').value;
    const groupKey = getPaymentGroupKey(payment, groupType);
    
    if (!groupKey) return;
    
    // Пересчитываем группу из актуального массива payments
    const group = payments.filter(p => getPaymentGroupKey(p, groupType) === groupKey);
    
    if (group.length === 0) return;
    
    const total = group.reduce((s, p) => s + parseFloat(p.amount), 0);
    const pending = group.filter(p => p.receipt_status !== 'sent' && !p.in_tax_service).length;
    const totalCount = group.length;
    
    // Находим все заголовки групп на странице
    const dayGroups = document.querySelectorAll('.day-group');
    
    for (const dayGroup of dayGroups) {
        // Проверяем, что это нужная группа (по дате в заголовке)
        const groupHeader = dayGroup.querySelector('.day-header span');
        if (!groupHeader) continue;
        
        const headerText = groupHeader.textContent;
        const formattedKey = formatGroupKey(groupKey, groupType);
        
        if (headerText.includes(formattedKey)) {
            // Нашли нужную группу, обновляем счетчик
            const headerStats = dayGroup.querySelector('.day-header > div:last-child');
            if (headerStats) {
                headerStats.textContent = `${totalCount} платежей • ${formatCurrency(total)} ${pending > 0 ? `• Ожидает отправки: ${pending}` : ''}`;
            }
            break;
        }
    }
}

// Получить ключ группы для платежа (формат совпадает с groupPayments() в utils.js)
function getPaymentGroupKey(payment, groupType) {
    const date = new Date(payment.paid_at || payment.created_at);
    
    switch(groupType) {
        case 'day':
            return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        case 'week': {
            const startOfWeek = new Date(date);
            startOfWeek.setDate(date.getDate() - date.getDay() + 1);
            const endOfWeek = new Date(startOfWeek);
            endOfWeek.setDate(startOfWeek.getDate() + 6);
            const startStr = `${startOfWeek.getFullYear()}-${String(startOfWeek.getMonth() + 1).padStart(2, '0')}-${String(startOfWeek.getDate()).padStart(2, '0')}`;
            const endStr = `${endOfWeek.getFullYear()}-${String(endOfWeek.getMonth() + 1).padStart(2, '0')}-${String(endOfWeek.getDate()).padStart(2, '0')}`;
            return `${startStr}_${endStr}`;
        }
        case 'month':
            return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        case 'quarter': {
            const quarter = Math.floor(date.getMonth() / 3) + 1;
            return `${date.getFullYear()}-Q${quarter}`;
        }
        case 'year':
            return String(date.getFullYear());
        default:
            return 'all';
    }
}

// loadStatsQuietly — обёртка для обратной совместимости, делегирует в loadStats()
async function loadStatsQuietly(options) {
    return loadStats(options);
}

// Функция для генерации скелетона загрузки
function renderPaymentsSkeleton() {
    const paginationTop = document.getElementById('paginationTop');
    const paginationBottom = document.getElementById('paginationBottom');
    const container = document.getElementById('paymentsContainer');
    
    // Скелетон верхней пагинации
    if (paginationTop) {
        paginationTop.classList.remove('hidden');
        const existingInput = paginationTop.querySelector('input#groupsPerPage');
        const savedValue = existingInput ? existingInput.value : '10';
        paginationTop.innerHTML = `
            <div class="pagination-controls">
                <button type="button" class="btn btn-pagination-nav skeleton-pagination-btn" id="paginationFirstTop" onclick="goToFirstPage()" disabled><i class="bi bi-chevron-double-left"></i></button>
                <button type="button" class="btn btn-pagination-nav skeleton-pagination-btn" id="paginationPrevTop" onclick="goToPrevPage()" disabled><i class="bi bi-chevron-left"></i></button>
                <ul class="pagination pagination-sm mb-0" id="paginationNumbersTop">
                    <li class="page-item"><span class="skeleton-pagination-number" style="min-width:32px;height:32px;display:inline-block;border-radius:var(--radius-sm);"></span></li>
                    <li class="page-item"><span class="skeleton-pagination-number" style="min-width:32px;height:32px;display:inline-block;border-radius:var(--radius-sm);"></span></li>
                    <li class="page-item"><span class="skeleton-pagination-number" style="min-width:32px;height:32px;display:inline-block;border-radius:var(--radius-sm);"></span></li>
                </ul>
                <button type="button" class="btn btn-pagination-nav skeleton-pagination-btn" id="paginationNextTop" onclick="goToNextPage()" disabled><i class="bi bi-chevron-right"></i></button>
                <button type="button" class="btn btn-pagination-nav skeleton-pagination-btn" id="paginationLastTop" onclick="goToLastPage()" disabled><i class="bi bi-chevron-double-right"></i></button>
            </div>
            <div class="pagination-info">
                <span id="paginationInfoTop" class="pagination-info-text skeleton-text" style="display:inline-block;width:200px;height:20px;"></span>
                <div class="groups-per-page-dropdown" style="position: relative;">
                    <input type="hidden" id="groupsPerPage" value="${savedValue}">
                    <button type="button" class="btn btn-outline-secondary btn-sm stat-period-btn" onclick="toggleGroupsPerPageDropdown('top')" title="Групп на странице" id="groupsPerPageBtnTop">
                        <span class="groups-per-page-btn-text">${savedValue} групп</span>
                        <i class="bi bi-chevron-down stat-period-chevron"></i>
                    </button>
                    <div class="stat-period-menu groups-per-page-menu" id="groupsPerPageDropdownTop">
                        <button type="button" class="dropdown-item" data-value="5">5 групп</button>
                        <button type="button" class="dropdown-item" data-value="10">10 групп</button>
                        <button type="button" class="dropdown-item" data-value="20">20 групп</button>
                        <button type="button" class="dropdown-item" data-value="50">50 групп</button>
                        <button type="button" class="dropdown-item" data-value="100">100 групп</button>
                    </div>
                </div>
            </div>
        `;
    }
    
    // Скелетон контента — карточки загрузки (группа с несколькими чеками)
    if (container) {
        const skeletonRow = (w1, w2, w3, mt = 12) => `
                    <div class="payment-row skeleton-payment" style="margin-top: ${mt}px;">
                        <div class="skeleton-checkbox" style="margin-top: 4px;"></div>
                        <div class="payment-info">
                            <div class="skeleton-text" style="width: ${w1}; height: 18px; margin-bottom: 8px;"></div>
                            <div class="skeleton-text" style="width: 100%; height: 12px; margin-bottom: 6px;"></div>
                            <div class="skeleton-text" style="width: ${w2}; height: 12px; margin-bottom: 8px;"></div>
                            <div class="skeleton-text" style="width: ${w3}; height: 16px;"></div>
                        </div>
                        <div class="payment-actions-col">
                            <div class="skeleton-btn" style="width: 120px; height: 32px;"></div>
                        </div>
                    </div>`;
        container.innerHTML = `
            <div class="day-group">
                <div class="day-header">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div class="skeleton-checkbox"></div>
                        <div class="skeleton-text" style="width: 150px; height: 20px;"></div>
                    </div>
                    <div class="skeleton-text" style="width: 250px; height: 20px;"></div>
                </div>
                <div class="day-content">
                    ${skeletonRow('60%', '40%', '80%', 0)}
                    ${skeletonRow('70%', '50%', '75%')}
                    ${skeletonRow('55%', '45%', '70%')}
                    ${skeletonRow('65%', '55%', '85%')}
                </div>
            </div>
        `;
    }
    
    // Скелетон нижней пагинации
    if (paginationBottom) {
        paginationBottom.classList.remove('hidden');
        const existingInput = paginationBottom.querySelector('input#groupsPerPageBottom');
        const savedValue = existingInput ? existingInput.value : document.getElementById('groupsPerPage')?.value || '10';
        paginationBottom.innerHTML = `
            <div class="pagination-controls">
                <button type="button" class="btn btn-pagination-nav skeleton-pagination-btn" id="paginationFirstBottom" onclick="goToFirstPage()" disabled><i class="bi bi-chevron-double-left"></i></button>
                <button type="button" class="btn btn-pagination-nav skeleton-pagination-btn" id="paginationPrevBottom" onclick="goToPrevPage()" disabled><i class="bi bi-chevron-left"></i></button>
                <ul class="pagination pagination-sm mb-0" id="paginationNumbersBottom">
                    <li class="page-item"><span class="skeleton-pagination-number" style="min-width:32px;height:32px;display:inline-block;border-radius:var(--radius-sm);"></span></li>
                    <li class="page-item"><span class="skeleton-pagination-number" style="min-width:32px;height:32px;display:inline-block;border-radius:var(--radius-sm);"></span></li>
                    <li class="page-item"><span class="skeleton-pagination-number" style="min-width:32px;height:32px;display:inline-block;border-radius:var(--radius-sm);"></span></li>
                </ul>
                <button type="button" class="btn btn-pagination-nav skeleton-pagination-btn" id="paginationNextBottom" onclick="goToNextPage()" disabled><i class="bi bi-chevron-right"></i></button>
                <button type="button" class="btn btn-pagination-nav skeleton-pagination-btn" id="paginationLastBottom" onclick="goToLastPage()" disabled><i class="bi bi-chevron-double-right"></i></button>
            </div>
            <div class="pagination-info">
                <span id="paginationInfoBottom" class="pagination-info-text skeleton-text" style="display:inline-block;width:200px;height:20px;"></span>
                <div class="groups-per-page-dropdown" style="position: relative;">
                    <input type="hidden" id="groupsPerPageBottom" value="${savedValue}">
                    <button type="button" class="btn btn-outline-secondary btn-sm stat-period-btn" onclick="toggleGroupsPerPageDropdown('bottom')" title="Групп на странице" id="groupsPerPageBtnBottom">
                        <span class="groups-per-page-btn-text">${savedValue} групп</span>
                        <i class="bi bi-chevron-down stat-period-chevron"></i>
                    </button>
                    <div class="stat-period-menu groups-per-page-menu open-up" id="groupsPerPageDropdownBottom">
                        <button type="button" class="dropdown-item" data-value="5">5 групп</button>
                        <button type="button" class="dropdown-item" data-value="10">10 групп</button>
                        <button type="button" class="dropdown-item" data-value="20">20 групп</button>
                        <button type="button" class="dropdown-item" data-value="50">50 групп</button>
                        <button type="button" class="dropdown-item" data-value="100">100 групп</button>
                    </div>
                </div>
            </div>
        `;
    }
    if (paginationTop || paginationBottom) {
        initGroupsPerPageDropdowns();
    }
}

async function loadPayments(options = {}) {
    const container = document.getElementById('paymentsContainer');
    
    const hasExistingData = Array.isArray(payments) && payments.length > 0;
    const showSkeleton = options.showSkeleton !== undefined ? options.showSkeleton : !hasExistingData;
    const resetPagination = options.resetPagination !== undefined ? options.resetPagination : true;
    const isAuto = options.isAuto === true;
    
    // Показываем скелетон загрузки только если это первая загрузка
    // или если явно запрошено через опции
    if (showSkeleton) {
        renderPaymentsSkeleton();
    }
    
    const dateFrom = document.getElementById('dateFrom');
    const dateTo = document.getElementById('dateTo');
    
    // Проверка на наличие элементов
    if (!dateFrom || !dateTo || !container) {
        console.error('Элементы фильтров не найдены');
        if (container) {
            container.innerHTML = '<div class="empty-state"><i class="bi bi-exclamation-triangle-fill text-danger me-2"></i>Ошибка инициализации фильтров</div>';
        }
        return;
    }
    
    const searchEntireDb = document.getElementById('searchEntireDb')?.checked === true;
    const params = new URLSearchParams();
    if (searchEntireDb) {
        params.set('ignore_dates', '1');
    } else {
        params.set('date_from', dateFrom.value + 'T00:00:00');
        params.set('date_to', dateTo.value + 'T23:59:59');
    }
    
    // Сбрасываем пагинацию только когда это явно нужно
    if (resetPagination) {
        currentPage = 1;
        groupPagination = {};
    }
    
    try {
        const res = await fetch(`/api/payments?${params}`);
        
        if (!res.ok) {
            throw new Error(`Ошибка сервера: ${res.status} ${res.statusText}`);
        }
        
        const data = await res.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Неизвестная ошибка');
        }
        
        // Сохраняем исходные данные с сервера
        const newPayments = data.payments || [];
        
        // Проверяем, что данные - это массив
        if (!Array.isArray(newPayments)) {
            console.error('Полученные данные не являются массивом:', newPayments);
            allPaymentsRaw = [];
        } else {
            // Если это автообновление и у нас уже есть данные,
            // проверяем, изменились ли данные реально
            if (isAuto && Array.isArray(allPaymentsRaw) && allPaymentsRaw.length > 0) {
                let isSame = true;
                
                if (allPaymentsRaw.length !== newPayments.length) {
                    isSame = false;
                } else {
                    for (let i = 0; i < newPayments.length; i++) {
                        const oldItem = allPaymentsRaw[i];
                        const newItem = newPayments[i];
                        // Сравниваем по id и основным полям, чтобы не делать полный deep equal
                        if (
                            !oldItem ||
                            oldItem.id !== newItem.id ||
                            oldItem.receipt_status !== newItem.receipt_status ||
                            oldItem.in_tax_service !== newItem.in_tax_service ||
                            String(oldItem.amount) !== String(newItem.amount)
                        ) {
                            isSame = false;
                            break;
                        }
                    }
                }
                
                if (isSame) {
                    console.log('Auto sync: данные платежей не изменились, DOM не перерисовываем');
                    // Всё равно обновим кеш, на случай появления новых полей
                    allPaymentsRaw = newPayments;
                    return;
                }
            }
            
            // Обновляем кеш только когда данные реально изменились
            allPaymentsRaw = newPayments;
        }
        
        console.log(`Загружено платежей с сервера: ${allPaymentsRaw.length}`);
        
        // Применяем клиентские фильтры
        try {
            payments = applyClientFilters([...allPaymentsRaw]);
            console.log(`После применения фильтров: ${payments.length} платежей`);
        } catch (filterError) {
            console.error('Ошибка при применении фильтров:', filterError);
            payments = [...allPaymentsRaw];
            showToast('Ошибка фильтрации, показаны все платежи', 'warning');
        }
        
        renderPayments();
        
    } catch (e) {
        console.error('Ошибка загрузки платежей:', e);
        container.innerHTML = `<div class="empty-state"><i class="bi bi-exclamation-triangle-fill text-danger me-2"></i>Ошибка: ${e.message}<br><button type="button" class="btn btn-primary btn-sm" onclick="loadPayments()"><i class="bi bi-arrow-clockwise me-1"></i>Попробовать снова</button></div>`;
        document.getElementById('paginationTop').classList.add('hidden');
        document.getElementById('paginationBottom').classList.add('hidden');
        
        // Восстанавливаем предыдущие данные если они есть
        if (allPaymentsRaw.length > 0) {
            payments = [...allPaymentsRaw];
        } else {
            payments = [];
        }
    }
}

function renderPayments() {
    const container = document.getElementById('paymentsContainer');
    
    // Проверка на наличие контейнера
    if (!container) {
        console.error('Контейнер платежей не найден');
        return;
    }
    
    // Проверка массива платежей
    if (!Array.isArray(payments)) {
        console.error('payments не является массивом:', payments);
        payments = [];
    }
    
    if (payments.length === 0) {
        const hasFilters = allPaymentsRaw.length > 0;
        const message = hasFilters 
            ? '<i class="bi bi-inbox text-muted me-2"></i>Платежи не найдены с текущими фильтрами<br><button type="button" class="btn btn-outline-secondary btn-sm" onclick="resetFilters()"><i class="bi bi-arrow-counterclockwise me-1"></i>Сбросить фильтры</button>'
            : '<i class="bi bi-inbox text-muted me-2"></i>Платежи не найдены';
        container.innerHTML = `<div class="empty-state">${message}</div>`;
        document.getElementById('paginationTop').classList.add('hidden');
        document.getElementById('paginationBottom').classList.add('hidden');
        return;
    }
    
    const groupingTypeEl = document.getElementById('groupingType');
    const paymentsPerGroupEl = document.getElementById('paymentsPerGroup');
    const groupsPerPageEl = document.getElementById('groupsPerPage');
    
    if (!groupingTypeEl || !paymentsPerGroupEl || !groupsPerPageEl) {
        console.error('Элементы фильтров не найдены');
        return;
    }
    
    const groupType = groupingTypeEl.value;
    const perGroup = parseInt(paymentsPerGroupEl.value) || 100;
    allGroupedPayments = groupPayments(payments, groupType);
    
    const sortedKeys = Object.keys(allGroupedPayments).sort().reverse();
    
    // Пагинация групп
    groupsPerPage = parseInt(groupsPerPageEl.value) || 10;
    const totalGroups = sortedKeys.length;
    totalPages = Math.max(1, Math.ceil(totalGroups / groupsPerPage));
    
    // Ограничиваем текущую страницу
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    
    // Получаем группы для текущей страницы
    const startIdx = (currentPage - 1) * groupsPerPage;
    const endIdx = startIdx + groupsPerPage;
    const pageKeys = sortedKeys.slice(startIdx, endIdx);
    
    let html = '';
    for (const key of pageKeys) {
        html += renderOneGroup(key, allGroupedPayments[key], groupType, perGroup);
    }
    
    container.innerHTML = html;
    updatePagination(totalGroups);
    updateBulkActions();
}

/** Безопасный id для блока группы (для прокрутки и точечного обновления) */
function getGroupElementId(key) {
    return 'group-' + String(key).replace(/"/g, '').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-\u0400-\u04FF.:]/g, '_');
}

/** Платежи группы по фильтру: all | pending | sent | canceled | error */
function getGroupPaymentsByFilter(group, filter) {
    if (!group || !Array.isArray(group)) return [];
    if (filter === 'all') return group;
    if (filter === 'pending') return group.filter(p => p.receipt_status === 'pending' && !p.in_tax_service);
    if (filter === 'sent') return group.filter(p => (p.receipt_status === 'sent' || (p.in_tax_service && p.receipt_status !== 'canceled')));
    if (filter === 'canceled') return group.filter(p => p.receipt_status === 'canceled');
    if (filter === 'error') return group.filter(p => p.receipt_status === 'error');
    return [];
}

/** Рендер одной группы (шапка + пагинация + строки). Используется при полном рендере и при смене страницы внутри группы. */
function renderOneGroup(key, group, groupType, perGroup) {
    const total = group.reduce((s, p) => s + parseFloat(p.amount), 0);
    const pendingCount = group.filter(p => p.receipt_status === 'pending' && !p.in_tax_service).length;
    const sentCount = group.filter(p => p.receipt_status === 'sent' || (p.in_tax_service && p.receipt_status !== 'canceled')).length;
    const canceledCount = group.filter(p => p.receipt_status === 'canceled').length;
    const errorCount = group.filter(p => p.receipt_status === 'error').length;
    const canSendPayments = group.filter(p => {
        const canSend = (
            (p.receipt_status === 'pending' && !p.in_tax_service) ||
            p.receipt_status === 'canceled' ||
            (p.receipt_status === 'error' && !p.in_tax_service)
        );
        return canSend;
    });
    const totalCount = group.length;
    const escapedKey = key.replace(/"/g, '&quot;');
    const categoryCheckbox = (filter, label, count) => {
        if (count === 0) return '';
        const subset = getGroupPaymentsByFilter(group, filter);
        const allSelected = subset.length > 0 && subset.every(p => selectedPayments.has(p.id));
        const someSelected = subset.some(p => selectedPayments.has(p.id));
        return `<label class="group-category-checkbox-label" title="Выбрать все: ${label}">
            <input type="checkbox" class="group-checkbox-category" data-group-key="${escapedKey}" data-filter="${filter}"
                   ${allSelected ? 'checked' : ''} ${someSelected && !allSelected ? 'style="opacity: 0.6;"' : ''}>
            <span>${label} (${count})</span>
        </label>`;
    };
    const categoryCheckboxesHtml = [
        categoryCheckbox('all', 'Все', totalCount),
        categoryCheckbox('pending', 'Ожидают', pendingCount),
        categoryCheckbox('sent', 'Отправлены', sentCount),
        categoryCheckbox('canceled', 'Аннулированы', canceledCount),
        categoryCheckbox('error', 'С ошибкой', errorCount)
    ].filter(Boolean).join('');
    if (!groupPagination[key]) groupPagination[key] = { currentPage: 1 };
    let groupCurrentPage = groupPagination[key].currentPage;
    const groupTotalPages = Math.max(1, Math.ceil(totalCount / perGroup));
    if (groupCurrentPage > groupTotalPages) groupPagination[key].currentPage = groupTotalPages;
    if (groupCurrentPage < 1) groupPagination[key].currentPage = 1;
    groupCurrentPage = groupPagination[key].currentPage;
    const groupStartIdx = (groupCurrentPage - 1) * perGroup;
    const groupEndIdx = groupStartIdx + perGroup;
    const pagedGroup = group.slice(groupStartIdx, groupEndIdx);
    return `
        <div class="day-group" id="${getGroupElementId(key)}">
            <div class="day-header">
                <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                    <span><i class="bi bi-calendar3 me-1"></i>${formatGroupKey(key, groupType)}</span>
                    ${categoryCheckboxesHtml ? `<div class="group-header-checkboxes">${categoryCheckboxesHtml}</div>` : ''}
                </div>
                <div>${totalCount} платежей • ${formatCurrency(total)} ${pendingCount > 0 ? `• Ожидает отправки: ${pendingCount}` : ''}</div>
            </div>
            ${groupTotalPages > 1 ? renderGroupPagination(key, groupCurrentPage, groupTotalPages, totalCount, 'top') : ''}
            <div class="day-content">
                ${pagedGroup.map(p => renderPaymentRow(p)).join('')}
            </div>
            ${groupTotalPages > 1 ? renderGroupPagination(key, groupCurrentPage, groupTotalPages, totalCount, 'bottom') : ''}
        </div>
    `;
}

/** Обновить только блок одной группы (без перерисовки всего списка) и прокрутить к шапке группы. */
function updateSingleGroupView(groupKey) {
    if (!allGroupedPayments || !allGroupedPayments[groupKey]) return;
    const groupTypeEl = document.getElementById('groupingType');
    const perGroup = parseInt(document.getElementById('paymentsPerGroup')?.value || '100', 10);
    const groupType = groupTypeEl ? groupTypeEl.value : 'date';
    const el = document.getElementById(getGroupElementId(groupKey));
    if (!el) return;
    el.outerHTML = renderOneGroup(groupKey, allGroupedPayments[groupKey], groupType, perGroup);
    const newEl = document.getElementById(getGroupElementId(groupKey));
    if (newEl) {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const header = document.querySelector('.app-header');
                const headerHeight = header ? header.getBoundingClientRect().height : 0;
                const gap = 15;
                const offsetFromTop = headerHeight + gap;
                const rect = newEl.getBoundingClientRect();
                const targetScrollY = rect.top + window.scrollY - offsetFromTop;
                window.scrollTo({ top: Math.max(0, targetScrollY), behavior: 'smooth' });
            });
        });
    }
}

/** Копирование одного элемента метаданных (span с data-copy-text) */
function copyMetaSpan(el) {
    const raw = el.getAttribute('data-copy-text');
    if (!raw) return;
    const text = raw.replace(/&#10;/g, '\n');
    copyToClipboard(text, 'Скопировано!');
}

function escapeAttr(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function renderMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') return '';
    
    // Список известных полей с красивыми названиями и иконками
    const knownFields = {
        telegram_id: { label: 'TG', icon: '<i class="bi bi-person"></i>' },
        tariff_id: { label: 'Тариф', icon: '<i class="bi bi-credit-card"></i>' },
        user_id: { label: 'User', icon: '<i class="bi bi-person-badge"></i>' },
        email: { label: 'Email', icon: '<i class="bi bi-envelope"></i>' },
        phone: { label: 'Тел', icon: '<i class="bi bi-telephone"></i>' },
        order_id: { label: 'Заказ', icon: '<i class="bi bi-cart"></i>' },
        customer_id: { label: 'Клиент', icon: '<i class="bi bi-person"></i>' },
        subscription_id: { label: 'Подписка', icon: '<i class="bi bi-arrow-repeat"></i>' }
    };
    
    let html = '';
    
    // Обходим все поля в metadata
    for (const [key, value] of Object.entries(metadata)) {
        if (!value) continue; // Пропускаем пустые значения
        
        const field = knownFields[key];
        
        if (field) {
            const copyText = field.label + ': ' + value;
            html += `<span class="payment-meta-item-copy" title="Нажмите для копирования" data-copy-text="${escapeAttr(copyText)}" onclick="copyMetaSpan(this)">${field.icon} ${field.label}: ${escapeHtml(String(value))}</span>`;
        } else {
            const prettyKey = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            const copyText = prettyKey + ': ' + value;
            html += `<span class="payment-meta-item-copy" title="Нажмите для копирования" data-copy-text="${escapeAttr(copyText)}" onclick="copyMetaSpan(this)"><i class="bi bi-circle-fill me-1" style="font-size: 0.5rem;"></i> ${prettyKey}: ${escapeHtml(String(value))}</span>`;
        }
    }
    
    return html;
}

function renderReceiptInfo(p) {
    // Определяем статус чека
    const isSentThroughSystem = p.receipt_status === 'sent';
    const isCanceled = p.receipt_status === 'canceled';
    const isInTaxOnly = p.in_tax_service && !isSentThroughSystem;
    
    let html = '<div class="receipt-info">';
    
    // Заголовок зависит от статуса
    if (isCanceled) {
        html += '<div class="service-label" style="color: #e52d2d;"><i class="bi bi-x-circle-fill me-1"></i> Чек аннулирован в налоговой</div>';
        if (p.canceled_at) {
            html += `<div class="receipt-info-line" style="color: var(--danger);">
                <strong>Дата аннулирования:</strong> ${formatDateTime(p.canceled_at)}
            </div>`;
        }
        if (p.service_name) {
            html += `<div class="receipt-info-line">
                <strong>Услуга:</strong> ${escapeHtml(p.service_name)}
            </div>`;
        }
    } else if (isInTaxOnly) {
        html += '<div class="service-label"><i class="bi bi-check-circle-fill me-1"></i> Чек отправлен в налоговую с оригинальными данными из ЮКассы</div>';
    } else {
        // Данные, с которыми отправили чек
        const sentDate = p.receipt_date || p.paid_at;
        const sentService = p.service_name;
        const sentAmount = p.receipt_amount !== null ? p.receipt_amount : p.amount;
        
        // Оригинальные данные из ЮКассы
        const originalDate = p.paid_at;
        const originalDescription = p.description;
        const originalAmount = p.amount;
        
        // Проверяем, что изменилось при отправке
        const dateChanged = sentDate !== originalDate;
        const serviceChanged = sentService && sentService !== originalDescription;
        const amountChanged = Math.abs(parseFloat(sentAmount) - parseFloat(originalAmount)) > 0.01;
        
        const hasChanges = dateChanged || serviceChanged || amountChanged;
        
        if (!hasChanges) {
            // Ничего не изменилось
            html += '<div class="service-label"><i class="bi bi-check-circle-fill me-1"></i> Чек отправлен в налоговую с оригинальными данными из ЮКассы</div>';
        } else {
            // Что-то изменилось - показываем детали
            html += '<div class="service-label service-label-changes"><i class="bi bi-check-circle-fill me-1"></i> Чек отправлен в налоговую с изменениями <i class="bi bi-exclamation-triangle-fill ms-1"></i></div>';
            
            // Показываем дату, если изменилась
            if (dateChanged && sentDate) {
                const formattedDate = formatDateTime(sentDate);
                html += `<div class="receipt-info-line" style="color: var(--warning);">
                    <strong>С датой:</strong> ${formattedDate} <i class="bi bi-exclamation-triangle-fill ms-1"></i>
                </div>`;
            }
            if (serviceChanged) {
                html += `<div class="receipt-info-line" style="color: var(--warning);">
                    <strong>Услугой:</strong> ${escapeHtml(sentService)} <i class="bi bi-exclamation-triangle-fill ms-1"></i>
                </div>`;
            }
            if (amountChanged) {
                html += `<div class="receipt-info-line" style="color: var(--warning);">
                    <strong>Ценой:</strong> ${formatCurrency(sentAmount)} <i class="bi bi-exclamation-triangle-fill ms-1"></i>
                </div>`;
            }
        }
    }
    
    html += '</div>';
    return html;
}

function renderPaymentRow(p) {
    // Получаем настройки отображения
    const displaySettings = getDisplaySettings();
    const display = displaySettings.fields;
    const order = displaySettings.order;
    
    // Можно отправить:
    // - новый платеж (pending) и его нет в налоговой
    // - отмененный (canceled) - можно отправить заново даже если он есть в налоговой как аннулированный
    // - с ошибкой (error) и его нет в налоговой
    const canSend = (
        (p.receipt_status === 'pending' && !p.in_tax_service) ||
        p.receipt_status === 'canceled' || 
        (p.receipt_status === 'error' && !p.in_tax_service)
    );
    const canCancel = (p.receipt_status === 'sent' || p.in_tax_service) && p.receipt_uuid && p.receipt_status !== 'canceled';
    const isSent = p.receipt_status === 'sent' || (p.in_tax_service && p.receipt_status !== 'canceled');
    const isResend = p.receipt_status === 'canceled' || p.receipt_status === 'error';
    const statusRowClass = isSent ? 'sent' : p.receipt_status === 'pending' ? 'pending' : p.receipt_status === 'error' ? 'error' : p.receipt_status === 'canceled' ? 'canceled' : '';
    
    let statusBadge = '';
    if (display.receiptStatus) {
        if (isSent) {
            // Отправлен = через нашу систему или найден в налоговой
            statusBadge = '<span class="status-badge sent"><i class="bi bi-check-circle-fill me-1"></i> Отправлен</span>';
        } else if (p.receipt_status === 'pending') {
            statusBadge = '<span class="status-badge pending"><i class="bi bi-clock-fill me-1"></i> Ожидает</span>';
        } else if (p.receipt_status === 'error') {
            statusBadge = '<span class="status-badge error"><i class="bi bi-x-circle-fill me-1"></i> Ошибка</span>';
        } else if (p.receipt_status === 'canceled') {
            statusBadge = '<span class="status-badge canceled"><i class="bi bi-x-octagon-fill me-1"></i> Отменен</span>';
        }
    }
    
    // Создаем объект всех возможных элементов
    const fieldElements = {
        paymentId: display.paymentId ? `<span class="payment-id-copy payment-meta-item-copy" title="Нажмите для копирования ID" data-copy-text="${escapeAttr(p.id)}" onclick="copyMetaSpan(this)">
            <i class="bi bi-hash me-1"></i>${p.id.substring(0, 12)}...
        </span>` : '',
        
        metadata: display.metadata ? renderMetadata(p.metadata) : '',
        
        paymentMethod: (display.paymentMethod && p.payment_method && p.payment_method !== 'unknown') ? (() => {
            const methodIcons = {
                'bank_card': '<i class="bi bi-credit-card"></i>',
                'yoo_money': '<i class="bi bi-wallet2"></i>',
                'qiwi': '<i class="bi bi-currency-exchange"></i>',
                'webmoney': '<i class="bi bi-globe"></i>',
                'sberbank': '<i class="bi bi-bank"></i>',
                'alfabank': '<i class="bi bi-bank"></i>',
                'tinkoff_bank': '<i class="bi bi-bank"></i>',
                'sbp': '<i class="bi bi-lightning-charge"></i>'
            };
            const icon = methodIcons[p.payment_method] || '<i class="bi bi-cash-coin"></i>';
            return `<span class="payment-meta-item-copy" title="Нажмите для копирования" data-copy-text="${escapeAttr(p.payment_method)}" onclick="copyMetaSpan(this)">${icon} ${p.payment_method}</span>`;
        })() : '',
        
        dateTime: display.dateTime ? (() => {
            const dt = formatDateTime(p.paid_at || p.created_at);
            return `<span class="payment-meta-item-copy" title="Нажмите для копирования" data-copy-text="${escapeAttr(dt)}" onclick="copyMetaSpan(this)"><i class="bi bi-calendar3 me-1"></i>${dt}</span>`;
        })() : '',
        
        description: display.description ? `<div class="payment-desc">${escapeHtml(p.description || 'Без описания')}</div>` : '',
        
        amount: display.amount ? `<div class="payment-amount">${formatCurrency(p.amount)}</div>` : '',
        
        receiptInfo: (display.receiptInfo && (p.receipt_status === 'sent' || p.receipt_status === 'canceled' || p.in_tax_service)) 
            ? renderReceiptInfo(p) : '',
        
        receiptStatus: display.receiptStatus ? statusBadge : ''
    };
    
    // Формируем элементы для payment-meta в соответствии с порядком
    const metaItems = [];
    const mainItems = [];
    
    order.forEach(fieldId => {
        if (fieldId === 'description' || fieldId === 'amount' || fieldId === 'receiptInfo') {
            // Эти элементы идут отдельно, не в meta
            if (fieldElements[fieldId]) {
                mainItems.push({ id: fieldId, html: fieldElements[fieldId] });
            }
        } else {
            // Эти элементы идут в payment-meta
            if (fieldElements[fieldId]) {
                metaItems.push(fieldElements[fieldId]);
            }
        }
    });
    
    // Собираем финальную разметку в правильном порядке (цену не включаем — она справа под кнопками)
    let infoHtml = '';
    order.forEach(fieldId => {
        if (fieldId === 'description' && fieldElements.description) {
            infoHtml += fieldElements.description;
        } else if (fieldId === 'receiptInfo' && fieldElements.receiptInfo) {
            infoHtml += fieldElements.receiptInfo;
        }
    });
    const amountHtml = fieldElements.amount || '';
    
    // Добавляем meta в нужное место (после description, если есть). Каждый span копируется по клику отдельно.
    if (metaItems.length > 0) {
        const metaHtml = `<div class="payment-meta">${metaItems.join('')}</div>`;
        
        // Вставляем meta после description или в начало
        if (fieldElements.description && infoHtml.includes('payment-desc')) {
            infoHtml = infoHtml.replace('</div>', `</div>${metaHtml}`);
        } else {
            infoHtml = metaHtml + infoHtml;
        }
    }
    
    return `
        <div class="payment-row ${selectedPayments.has(p.id) ? 'selected' : ''} ${statusRowClass}" data-id="${p.id}">
            <input type="checkbox" class="payment-checkbox" 
                   ${selectedPayments.has(p.id) ? 'checked' : ''}
                   onchange="togglePayment('${p.id}')">
            <div class="payment-info">
                ${infoHtml}
                ${p.error_message ? `<div style="color: var(--danger); font-size: 12px; margin-top: 8px;"><i class="bi bi-x-circle-fill me-1"></i>${escapeHtml(p.error_message)}</div>` : ''}
            </div>
            <div class="payment-actions-col">
                <div class="payment-btns">
                    ${canSend ? `<button type="button" class="btn btn-success btn-sm" onclick="openSendReceipt('${p.id}')">${isResend ? '<i class="bi bi-arrow-repeat me-1"></i>Отправить еще раз' : '<i class="bi bi-send me-1"></i>Отправить'}</button>` : ''}
                    ${canCancel ? `<button type="button" class="btn btn-danger btn-sm" onclick="openCancelReceipt('${p.id}', '${p.receipt_uuid}')" title="Аннулировать"><i class="bi bi-x-circle"></i></button>` : ''}
                    ${(p.receipt_url_print && (p.receipt_status === 'sent' || p.in_tax_service)) ? `
                        <div class="receipt-menu-wrapper">
                            <button type="button" class="btn btn-secondary btn-sm" onclick="toggleReceiptMenu(event, '${p.id}')" title="Печать"><i class="bi bi-printer"></i></button>
                            <div class="receipt-dropdown" id="receiptMenu-${p.id}">
                                <div class="receipt-dropdown-item" onclick="openReceipt('${escapeHtml(p.receipt_url_print)}')">
                                    <i class="bi bi-file-earmark-text me-2"></i>Открыть
                                </div>
                                <div class="receipt-dropdown-divider"></div>
                                <div class="receipt-dropdown-item receipt-dropdown-submenu">
                                    <span><i class="bi bi-send me-2"></i>Отправить</span>
                                    <span style="margin-left: auto;"><i class="bi bi-chevron-right"></i></span>
                                    <div class="receipt-submenu">
                                        <div class="receipt-dropdown-item" onclick="shareReceipt('telegram', '${escapeHtml(p.receipt_url_print)}')">
                                            <i class="bi bi-telegram me-2"></i>Telegram
                                        </div>
                                        <div class="receipt-dropdown-item" onclick="shareReceipt('whatsapp', '${escapeHtml(p.receipt_url_print)}')">
                                            <i class="bi bi-whatsapp me-2"></i>WhatsApp
                                        </div>
                                        <div class="receipt-dropdown-item" onclick="shareReceipt('email', '${escapeHtml(p.receipt_url_print)}')">
                                            <i class="bi bi-envelope me-2"></i>Email
                                        </div>
                                        <div class="receipt-dropdown-item" onclick="shareReceipt('copy', '${escapeHtml(p.receipt_url_print)}')">
                                            <i class="bi bi-link-45deg me-2"></i>Скопировать ссылку
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ` : ''}
                </div>
                ${amountHtml ? amountHtml.replace('class="payment-amount"', 'class="payment-amount payment-amount-right"') : ''}
            </div>
        </div>
    `;
}

// ==================== SELECTION ====================

function togglePayment(id) {
    if (selectedPayments.has(id)) {
        selectedPayments.delete(id);
    } else {
        selectedPayments.add(id);
    }
    
    const row = document.querySelector(`.payment-row[data-id="${id}"]`);
    if (row) row.classList.toggle('selected', selectedPayments.has(id));
    
    const groupKey = allGroupedPayments && Object.keys(allGroupedPayments).find(k => allGroupedPayments[k].some(p => p.id === id));
    if (groupKey) updateGroupCategoryCheckboxes(groupKey);
    updateBulkActions();
}

/** Обновить состояние чекбоксов по категориям в заголовке группы */
function updateGroupCategoryCheckboxes(groupKey) {
    const group = allGroupedPayments && allGroupedPayments[groupKey];
    if (!group) return;
    const container = document.getElementById(getGroupElementId(groupKey));
    if (!container) return;
    container.querySelectorAll('.group-checkbox-category').forEach(cb => {
        const filter = cb.getAttribute('data-filter');
        const sub = getGroupPaymentsByFilter(group, filter);
        const every = sub.length > 0 && sub.every(p => selectedPayments.has(p.id));
        const some = sub.some(p => selectedPayments.has(p.id));
        cb.checked = every;
        cb.style.opacity = some && !every ? '0.6' : '';
    });
}

function updateBulkActions() {
    const count = selectedPayments.size;
    const selectedCountEl = document.getElementById('selectedCount');
    const selectedLabel = document.getElementById('selectedLabel');
    if (selectedCountEl) selectedCountEl.textContent = count;
    const bar = document.getElementById('bulkActions');
    if (bar) bar.classList.toggle('visible', count > 0);
    if (count === 0) {
        if (selectedLabel) selectedLabel.textContent = 'выбрано';
        return;
    }
    const sendOptions = document.getElementById('bulkActionsSendOptions');
    const sendButtons = document.getElementById('bulkActionsSendButtons');
    const cancelButtons = document.getElementById('bulkActionsCancelButtons');
    const sendBtn = document.getElementById('bulkSendBtn');
    const cancelBtn = document.getElementById('bulkCancelBtn');
    let canSendCount = 0;
    let canCancelCount = 0;
    const paymentsMap = new Map();
    payments.forEach(p => paymentsMap.set(p.id, p));
    selectedPayments.forEach(id => {
        const p = paymentsMap.get(id);
        if (!p) return;
        const canSend = (p.receipt_status === 'pending' && !p.in_tax_service) || p.receipt_status === 'canceled' || (p.receipt_status === 'error' && !p.in_tax_service);
        const canCancel = (p.receipt_status === 'sent' || p.in_tax_service) && p.receipt_uuid && p.receipt_status !== 'canceled';
        if (canSend) canSendCount++;
        if (canCancel) canCancelCount++;
    });
    const showSend = canSendCount > 0;
    const showCancel = canCancelCount > 0;
    if (sendOptions) sendOptions.classList.toggle('hidden', !showSend);
    if (sendButtons) sendButtons.classList.toggle('hidden', !showSend);
    if (cancelButtons) cancelButtons.classList.toggle('hidden', !showCancel);
    // Обновляем текст кнопок с количеством
    if (sendBtn) sendBtn.innerHTML = `<i class="bi bi-send"></i> Отправить` + (canSendCount > 0 ? ` <span class="bulk-btn-badge">${canSendCount}</span>` : '');
    if (cancelBtn) cancelBtn.innerHTML = `<i class="bi bi-x-circle"></i> Аннулировать` + (canCancelCount > 0 ? ` <span class="bulk-btn-badge">${canCancelCount}</span>` : '');
    // Информативный текст: разбивка по действиям
    if (selectedLabel) {
        if (showSend && showCancel) {
            selectedLabel.textContent = `выбрано — отпр: ${canSendCount}, анн: ${canCancelCount}`;
        } else if (showSend) {
            selectedLabel.textContent = `выбрано — к отправке: ${canSendCount}`;
        } else if (showCancel) {
            selectedLabel.textContent = `выбрано — к аннуляции: ${canCancelCount}`;
        } else {
            selectedLabel.textContent = 'выбрано';
        }
    }
}

function clearSelection() {
    if (typeof collapseRandomPanel === 'function') collapseRandomPanel(false);
    selectedPayments.clear();
    document.querySelectorAll('.payment-row.selected').forEach(el => el.classList.remove('selected'));
    document.querySelectorAll('.payment-checkbox:checked').forEach(el => el.checked = false);
    document.querySelectorAll('.group-checkbox:checked').forEach(el => el.checked = false);
    document.querySelectorAll('.group-checkbox-category:checked').forEach(el => el.checked = false);
    updateBulkActions();
}

/** Выбор/снятие по категории в группе (все, ожидают, отправлены, аннулированы, с ошибкой) */
function toggleGroupCategorySelection(groupKey, filter) {
    const group = allGroupedPayments && allGroupedPayments[groupKey];
    if (!group) return;
    const subset = getGroupPaymentsByFilter(group, filter);
    if (subset.length === 0) return;
    const allSelected = subset.every(p => selectedPayments.has(p.id));
    if (allSelected) {
        subset.forEach(p => selectedPayments.delete(p.id));
    } else {
        subset.forEach(p => selectedPayments.add(p.id));
    }
    subset.forEach(p => {
        const row = document.querySelector(`.payment-row[data-id="${p.id}"]`);
        if (row) {
            row.classList.toggle('selected', selectedPayments.has(p.id));
            const cb = row.querySelector('.payment-checkbox');
            if (cb) cb.checked = selectedPayments.has(p.id);
        }
    });
    const container = document.getElementById(getGroupElementId(groupKey));
    if (container) {
        container.querySelectorAll('.group-checkbox-category').forEach(cb => {
            const f = cb.getAttribute('data-filter');
            const sub = getGroupPaymentsByFilter(group, f);
            const every = sub.length > 0 && sub.every(px => selectedPayments.has(px.id));
            const some = sub.some(px => selectedPayments.has(px.id));
            cb.checked = every;
            cb.style.opacity = some && !every ? '0.6' : '';
        });
    }
    updateBulkActions();
}

function toggleGroupSelection(groupKey) {
    // Находим все платежи в группе
    const group = allGroupedPayments[groupKey];
    if (!group) return;
    
    // Находим платежи, которые можно отправить
    const canSendPayments = group.filter(p => {
        const canSend = (
            (p.receipt_status === 'pending' && !p.in_tax_service) ||
            p.receipt_status === 'canceled' || 
            (p.receipt_status === 'error' && !p.in_tax_service)
        );
        return canSend;
    });
    
    // Проверяем, все ли уже выбраны
    const allSelected = canSendPayments.every(p => selectedPayments.has(p.id));
    
    if (allSelected) {
        // Снимаем выбор со всех
        canSendPayments.forEach(p => selectedPayments.delete(p.id));
    } else {
        // Выбираем все
        canSendPayments.forEach(p => selectedPayments.add(p.id));
    }
    
    // Обновляем только UI этой группы и чекбоксы строк — без полной перерисовки
    document.querySelectorAll('.group-checkbox').forEach(cb => {
        if (cb.getAttribute('data-group-key') === groupKey) {
            cb.checked = !allSelected;
            cb.style.opacity = '';
        }
    });
    canSendPayments.forEach(p => {
        const row = document.querySelector(`.payment-row[data-id="${p.id}"]`);
        if (row) {
            row.classList.toggle('selected', selectedPayments.has(p.id));
            const cb = row.querySelector('.payment-checkbox');
            if (cb && !cb.disabled) cb.checked = selectedPayments.has(p.id);
        }
    });
    // Сбрасываем полупрозрачность у других групповых чекбоксов при частичном выборе
    document.querySelectorAll('.group-checkbox').forEach(cb => {
        const key = cb.getAttribute('data-group-key');
        if (!key || key === groupKey) return;
        const gr = allGroupedPayments[key];
        if (!gr) return;
        const canSend = gr.filter(px => (px.receipt_status === 'pending' && !px.in_tax_service) || px.receipt_status === 'canceled' || (px.receipt_status === 'error' && !px.in_tax_service));
        const some = canSend.some(px => selectedPayments.has(px.id));
        const every = canSend.length > 0 && canSend.every(px => selectedPayments.has(px.id));
        cb.checked = every;
        cb.style.opacity = some && !every ? '0.5' : '';
    });
    updateBulkActions();
}

// ==================== RECEIPT MENU ====================

/** Границы контейнера .day-group (горизонталь); fallback — вьюпорт */
function getDayGroupBounds(el) {
    const dayGroup = el?.closest('.day-group');
    if (!dayGroup) {
        return { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };
    }
    const r = dayGroup.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
}

// getViewportBounds() — определена в utils.js

function applyReceiptMenuOpaqueBackground(menu) {
    if (!menu || !menu.classList.contains('active')) return;
    const isLight = document.documentElement.getAttribute('data-bs-theme') === 'light';
    const bg = isLight ? '#ffffff' : '#161b22';
    const shadow = '0 4px 12px rgba(0,0,0,0.15), inset 0 0 0 9999px ' + bg;
    menu.style.backgroundColor = bg;
    menu.style.boxShadow = shadow;
    menu.querySelectorAll('.receipt-submenu').forEach(function (sub) {
        sub.style.backgroundColor = bg;
        sub.style.boxShadow = shadow;
    });
}

function moveReceiptMenuToBody(menu, button) {
    if (!menu) return;
    if (menu.parentNode === document.body) return;
    const parent = menu.parentNode;
    menu._receiptOriginalParent = parent;
    const buttonRect = button ? button.getBoundingClientRect() : null;
    const menuWidth = 200;
    const menuHeight = 200;
    document.body.appendChild(menu);
    menu.classList.add('receipt-dropdown-portal');
    if (buttonRect) {
        menu.style.left = (buttonRect.right - menuWidth) + 'px';
        menu.style.top = (buttonRect.bottom + 4) + 'px';
    } else if (menu.classList.contains('active')) {
        const rect = menu.getBoundingClientRect();
        menu.style.left = rect.left + 'px';
        menu.style.top = rect.top + 'px';
        menu.style.width = rect.width + 'px';
        menu.style.minWidth = rect.width + 'px';
    }
}

function moveReceiptMenuBack(menu) {
    if (!menu._receiptOriginalParent) return;
    try {
        menu._receiptOriginalParent.appendChild(menu);
    } catch (e) {
        // родитель мог удалиться из DOM при перерисовке списка
    }
    menu.classList.remove('receipt-dropdown-portal');
    menu.style.left = '';
    menu.style.top = '';
    menu.style.width = '';
    menu.style.minWidth = '';
    menu.style.backgroundColor = '';
    menu.style.boxShadow = '';
    menu.querySelectorAll('.receipt-submenu').forEach(function (sub) {
        sub.style.backgroundColor = '';
        sub.style.boxShadow = '';
    });
    delete menu._receiptOriginalParent;
}

function toggleReceiptMenu(event, paymentId) {
    event.preventDefault();
    event.stopPropagation();
    
    const menu = document.getElementById(`receiptMenu-${paymentId}`);
    
    document.querySelectorAll('.receipt-dropdown').forEach(m => {
        if (m.id !== `receiptMenu-${paymentId}`) {
            moveReceiptMenuBack(m);
            m.classList.remove('active');
        }
    });
    
    if (menu) {
        const isActive = menu.classList.contains('active');
        if (isActive) {
            moveReceiptMenuBack(menu);
            menu.classList.remove('active');
        } else {
            const button = event.target.closest('button') || event.target;
            moveReceiptMenuToBody(menu, button);
            menu.classList.add('active');
            applyReceiptMenuOpaqueBackground(menu);
            menu.classList.add('receipt-dropdown-just-opened');
            menu.querySelectorAll('.receipt-dropdown-submenu').forEach(item => item.classList.remove('submenu-keep-open'));
            requestAnimationFrame(() => {
                positionDropdownMenu(button, menu);
            });
            setTimeout(() => menu.classList.remove('receipt-dropdown-just-opened'), 320);
        }
    }
}

function positionDropdownMenu(button, menu) {
    const isPortal = menu.classList.contains('receipt-dropdown-portal');

    // Для портала НЕ используем CSS-классы dropdown-top/dropdown-left —
    // они задают bottom/right через CSS, что конфликтует с inline top/left и схлопывает меню в 0px.
    if (!isPortal) {
        menu.classList.remove('dropdown-top', 'dropdown-left');
    }

    requestAnimationFrame(() => {
        const buttonRect = button.getBoundingClientRect();
        const menuHeight = menu.offsetHeight || 200;
        const menuWidth = menu.offsetWidth || 200;
        const vp = getViewportBounds(8);

        // === ВЕРТИКАЛЬНОЕ ===
        const fitsBelow = (buttonRect.bottom + menuHeight + 4) <= vp.bottom;
        const fitsAbove = (buttonRect.top - menuHeight - 4) >= vp.top;
        let openUp = !fitsBelow && (fitsAbove || buttonRect.top - vp.top > vp.bottom - buttonRect.bottom);

        // === ГОРИЗОНТАЛЬНОЕ ===
        let left = buttonRect.right - menuWidth;
        if (left < vp.left) left = vp.left;
        if (left + menuWidth > vp.right) left = vp.right - menuWidth;

        if (isPortal) {
            // Портал: только inline-стили, никаких CSS-классов направления
            menu.style.top = (openUp
                ? Math.max(vp.top, buttonRect.top - menuHeight - 4)
                : Math.min(vp.bottom - menuHeight, buttonRect.bottom + 4)
            ) + 'px';
            menu.style.left = left + 'px';
            menu.style.bottom = '';
            menu.style.right = '';
        } else {
            // Не-портал: используем CSS-классы
            if (openUp) menu.classList.add('dropdown-top');
            if (left <= buttonRect.left) menu.classList.add('dropdown-left');
        }
    });
}

// Функция для позиционирования подменю (в рамках .day-group)
function positionSubmenu(submenuItem) {
    const submenu = submenuItem.querySelector('.receipt-submenu');
    if (!submenu) return;
    
    const originalTransition = submenu.style.transition;
    const originalOpacity = submenu.style.opacity;
    
    submenu.style.transition = 'none';
    submenu.style.opacity = '0';
    submenu.style.visibility = 'hidden';
    submenu.classList.remove('submenu-left');
    submenu.style.top = '';
    submenu.offsetHeight;
    
    const itemRect = submenuItem.getBoundingClientRect();
    const submenuWidth = submenu.offsetWidth || 180;
    const submenuHeight = submenu.offsetHeight || 200;
    const groupBounds = getDayGroupBounds(submenuItem);
    const vp = getViewportBounds();
    const pad = 8;
    
    // === ГОРИЗОНТАЛЬНОЕ ПОЗИЦИОНИРОВАНИЕ (вьюпорт / .day-group) ===
    const rightEdgeIfOpenRight = itemRect.right + submenuWidth + 4;
    const leftEdgeIfOpenLeft = itemRect.left - submenuWidth - 4;
    
    const fitsRight = rightEdgeIfOpenRight <= groupBounds.right;
    const fitsLeft = leftEdgeIfOpenLeft >= groupBounds.left;
    
    if (!fitsRight && fitsLeft) {
        submenu.classList.add('submenu-left');
    } else if (!fitsRight && !fitsLeft) {
        const spaceRight = groupBounds.right - itemRect.right;
        const spaceLeft = itemRect.left - groupBounds.left;
        if (spaceLeft > spaceRight) {
            submenu.classList.add('submenu-left');
        }
    }
    
    submenu.offsetHeight;
    
    // === ВЕРТИКАЛЬНОЕ: не выходить за вьюпорт (считаем по itemRect + размеры, т.к. при visibility:hidden getBoundingClientRect может быть 0) ===
    const expectedBottom = itemRect.top + submenuHeight;
    const expectedTop = itemRect.top;
    
    if (expectedBottom > vp.bottom) {
        const overflow = expectedBottom - vp.bottom;
        const newTop = -overflow - pad;
        const maxUpShift = vp.top - itemRect.top + pad;
        submenu.style.top = `${Math.max(newTop, maxUpShift)}px`;
    } else if (expectedTop < vp.top) {
        submenu.style.top = `${vp.top - itemRect.top + pad}px`;
    }
    
    submenu.offsetHeight;
    
    requestAnimationFrame(() => {
        submenu.style.transition = originalTransition;
        submenu.style.opacity = originalOpacity;
        submenu.style.visibility = '';
    });
}

function openReceipt(url) {
    window.open(url, '_blank');
    closeAllReceiptMenus();
}

function shareReceipt(type, url) {
    let shareUrl = '';
    
    switch(type) {
        case 'telegram':
            shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent('Чек из налоговой')}`;
            window.open(shareUrl, '_blank', 'width=600,height=400');
            break;
        case 'whatsapp':
            shareUrl = `https://wa.me/?text=${encodeURIComponent('Чек из налоговой: ' + url)}`;
            window.open(shareUrl, '_blank', 'width=600,height=400');
            break;
        case 'email':
            shareUrl = `mailto:?subject=${encodeURIComponent('Чек из налоговой')}&body=${encodeURIComponent(url)}`;
            window.location.href = shareUrl;
            break;
        case 'copy':
            copyToClipboard(url, 'Ссылка на чек скопирована!');
            break;
    }
    
    closeAllReceiptMenus();
}

function closeAllReceiptMenus() {
    clearReceiptSubmenuHideTimer();
    document.querySelectorAll('.receipt-dropdown').forEach(menu => {
        moveReceiptMenuBack(menu);
        menu.classList.remove('active');
        menu.querySelectorAll('.receipt-dropdown-submenu').forEach(item => item.classList.remove('submenu-keep-open'));
        menu.querySelectorAll('.receipt-submenu').forEach(submenu => {
            const originalTransition = submenu.style.transition;
            submenu.style.transition = 'none';
            submenu.classList.remove('submenu-left');
            submenu.style.top = '';
            submenu.offsetHeight; // Принудительный reflow
            submenu.style.transition = originalTransition;
        });
    });
}

// ==================== EVENT DELEGATION ====================

// Обработка кликов на чекбоксы групп (по категории: все, ожидают, отправлены и т.д.)
document.addEventListener('change', function(e) {
    if (e.target.classList.contains('group-checkbox-category')) {
        const groupKey = e.target.getAttribute('data-group-key');
        const filter = e.target.getAttribute('data-filter');
        if (groupKey && filter) {
            toggleGroupCategorySelection(groupKey, filter);
        }
    }
    if (e.target.classList.contains('group-checkbox')) {
        const groupKey = e.target.getAttribute('data-group-key');
        if (groupKey) {
            toggleGroupSelection(groupKey);
        }
    }
});

// Задержка перед скрытием подменю «Отправить», чтобы курсор успел перейти на пункты (Telegram и т.д.)
const RECEIPT_SUBMENU_HIDE_DELAY_MS = 280;
let receiptSubmenuHideTimer = null;
let receiptSubmenuKeepOpenEl = null;

function clearReceiptSubmenuHideTimer(clearKeepOpenRef = true) {
    if (receiptSubmenuHideTimer) {
        clearTimeout(receiptSubmenuHideTimer);
        receiptSubmenuHideTimer = null;
    }
    if (receiptSubmenuKeepOpenEl) {
        receiptSubmenuKeepOpenEl.classList.remove('submenu-keep-open');
        if (clearKeepOpenRef) receiptSubmenuKeepOpenEl = null;
    }
}

function restoreSubmenuKeepOpenIfReturning() {
    if (!receiptSubmenuKeepOpenEl || !receiptSubmenuKeepOpenEl.isConnected) return;
    const dropdown = receiptSubmenuKeepOpenEl.closest('.receipt-dropdown');
    if (!dropdown || !dropdown.classList.contains('active')) return;
    const submenu = receiptSubmenuKeepOpenEl.querySelector('.receipt-submenu');
    if (submenu) {
        submenu.style.transition = 'none';
        receiptSubmenuKeepOpenEl.classList.add('submenu-keep-open');
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                submenu.style.transition = '';
            });
        });
    } else {
        receiptSubmenuKeepOpenEl.classList.add('submenu-keep-open');
    }
}

// Закрытие меню чека при клике вне его (меню может быть в body — портал)
document.addEventListener('click', function(e) {
    if (!e.target || typeof e.target.closest !== 'function') return;
    if (e.target.closest('.receipt-menu-wrapper') || e.target.closest('.receipt-dropdown')) return;
    closeAllReceiptMenus();
});

// Подменю: задержка скрытия при уходе курсора с пункта «Отправить»
document.addEventListener('mouseleave', function(e) {
    if (!e.target || typeof e.target.closest !== 'function') return;
    const submenuParent = e.target.closest('.receipt-dropdown-submenu');
    if (!submenuParent || e.relatedTarget && submenuParent.contains(e.relatedTarget)) return;
    clearReceiptSubmenuHideTimer();
    submenuParent.classList.add('submenu-keep-open');
    receiptSubmenuKeepOpenEl = submenuParent;
    receiptSubmenuHideTimer = setTimeout(() => {
        submenuParent.classList.remove('submenu-keep-open');
        receiptSubmenuHideTimer = null;
    }, RECEIPT_SUBMENU_HIDE_DELAY_MS);
}, true);

document.addEventListener('mouseenter', function(e) {
    if (!e.target || typeof e.target.closest !== 'function') return;
    if (e.target.closest('.receipt-menu-wrapper') || e.target.closest('.receipt-dropdown')) {
        clearReceiptSubmenuHideTimer(false);
        restoreSubmenuKeepOpenIfReturning();
    }
    if (e.target.classList && e.target.classList.contains('receipt-dropdown-submenu')) {
        positionSubmenu(e.target);
    }
}, true);

// Мобильные устройства: открытие подменю по тапу (hover не работает на тач-экранах)
document.addEventListener('click', function(e) {
    if (!e.target || typeof e.target.closest !== 'function') return;
    const submenuParent = e.target.closest('.receipt-dropdown-submenu');
    if (!submenuParent) return;
    // Не перехватываем клики по дочерним пунктам подменю (Telegram, WhatsApp и т.д.)
    if (e.target.closest('.receipt-submenu')) return;
    e.stopPropagation();
    const isOpen = submenuParent.classList.contains('submenu-keep-open');
    if (isOpen) {
        submenuParent.classList.remove('submenu-keep-open');
    } else {
        submenuParent.classList.add('submenu-keep-open');
        positionSubmenu(submenuParent);
    }
}, true);

// Закрытие меню при скролле
window.addEventListener('scroll', function() {
    closeAllReceiptMenus();
}, true);

// Закрытие меню при изменении размера окна
let resizeTimeout;
window.addEventListener('resize', function() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        closeAllReceiptMenus();
    }, 100);
});
