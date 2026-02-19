// ==================== FILTERS ====================

// Автоприменение фильтров с debounce
let applyFiltersClientTimeout = null;
let applyFiltersReloadTimeout = null;
let lastSearchEntireDb = false; // при переключении «Не учитывать фильтры» перезапросить данные (даты игнорируются только на сервере)

// Для клиентских фильтров (статус, цена, услуга) - перезагрузка с применением фильтров
function applyFiltersAutoClient() {
    if (applyFiltersClientTimeout) {
        clearTimeout(applyFiltersClientTimeout);
    }
    
    applyFiltersClientTimeout = setTimeout(() => {
        try {
            saveFiltersToStorage();
            currentPage = 1;
            groupPagination = {};
            
            const searchEntireDbEl = document.getElementById('searchEntireDb');
            const searchEntireDbChecked = searchEntireDbEl ? searchEntireDbEl.checked : false;
            // При переключении «Не учитывать фильтры» нужна перезагрузка: с датами или без (ignore_dates)
            if (searchEntireDbChecked !== lastSearchEntireDb) {
                lastSearchEntireDb = searchEntireDbChecked;
                saveFiltersToStorage(); // явно сохраняем перед перезагрузкой
                loadPayments({ showSkeleton: true, resetPagination: true });
                return;
            }
            
            if (Array.isArray(allPaymentsRaw) && allPaymentsRaw.length > 0) {
                renderPaymentsSkeleton();
                setTimeout(() => {
                    payments = applyClientFilters([...allPaymentsRaw]);
                    renderPayments();
                }, 80);
            } else {
                loadPayments({ showSkeleton: true, resetPagination: true });
            }
        } catch (error) {
            console.error('Ошибка в applyFiltersAutoClient:', error);
            showToast('Ошибка применения фильтров', 'error');
        }
    }, 300);
}

function clearSearchAllFilter() {
    const el = document.getElementById('searchAllFilter');
    if (el) el.value = '';
    applyFiltersAutoClient();
}

// Для серверных фильтров (даты) - перезагрузка с сервера
function applyFiltersAutoWithReload() {
    // Отменяем предыдущий таймер
    if (applyFiltersReloadTimeout) {
        clearTimeout(applyFiltersReloadTimeout);
    }
    
    // Запускаем новый таймер (500мс задержка)
    applyFiltersReloadTimeout = setTimeout(() => {
        saveFiltersToStorage();
        currentPage = 1;
        groupPagination = {};
        // При смене диапазона дат явно запрашиваем новую выборку с отображением скелетона
        loadPayments({ showSkeleton: true, resetPagination: true });
    }, 500);
}

/** Построить строку для полнотекстового поиска по платежу */
function buildSearchText(p) {
    const parts = [
        p.id || '',
        String(p.amount ?? ''),
        p.service_name || '',
        p.tax_service_name || '',
        p.description || '',
        p.receipt_uuid || '',
        p.paid_at || '',
        p.created_at || ''
    ];
    if (p.metadata && typeof p.metadata === 'object') {
        parts.push(JSON.stringify(p.metadata));
    }
    return parts.join(' ').toLowerCase();
}

function applyClientFilters(list) {
    // Защита от некорректных входных данных
    if (!Array.isArray(list)) {
        console.error('applyClientFilters: входные данные не массив', list);
        return [];
    }
    
    try {
        const statusFilter = document.getElementById('statusFilter');
        const priceFromInput = document.getElementById('priceFrom');
        const priceToInput = document.getElementById('priceTo');
        const searchAllInput = document.getElementById('searchAllFilter');
        const searchEntireDbCheck = document.getElementById('searchEntireDb');
        
        if (!statusFilter || !priceFromInput || !priceToInput) {
            console.warn('Элементы фильтров не найдены, возвращаем исходный список');
            return list;
        }
        
        const searchEntireDb = searchEntireDbCheck ? searchEntireDbCheck.checked : false;
        const status = statusFilter.value;
        const priceFrom = parseFloat(priceFromInput.value) || 0;
        const priceTo = parseFloat(priceToInput.value) || Infinity;
        const selectedServices = getSelectedServiceFilters();
        const searchQuery = (searchAllInput?.value || '').trim().toLowerCase();
        
        const filtered = list.filter(p => {
            if (!p || typeof p !== 'object') {
                console.warn('Некорректный объект платежа:', p);
                return false;
            }
            
            // Режим «Не учитывать фильтры»: только поиск по строке (или всё, если строка пуста)
            if (searchEntireDb) {
                if (!searchQuery) return true;
                return buildSearchText(p).includes(searchQuery);
            }
            
            // Обычный режим: все фильтры
            if (status !== 'all') {
                const isSent = p.receipt_status === 'sent' || (p.in_tax_service && p.receipt_status !== 'canceled');
                if (status === 'sent') {
                    if (!isSent) return false;
                } else if (status === 'pending') {
                    if (isSent || p.receipt_status !== 'pending') return false;
                } else if (p.receipt_status !== status) {
                    return false;
                }
            }
            const amount = parseFloat(p.amount);
            if (isNaN(amount) || amount < priceFrom || amount > priceTo) return false;
            if (selectedServices.length > 0) {
                const paymentServiceName = p.service_name || p.tax_service_name || p.description || '';
                if (!selectedServices.includes(paymentServiceName)) return false;
            }
            if (searchQuery) {
                if (!buildSearchText(p).includes(searchQuery)) return false;
            }
            return true;
        });
        
        console.log(`Фильтрация: было ${list.length}, стало ${filtered.length}`);
        return filtered;
        
    } catch (error) {
        console.error('Ошибка при применении фильтров:', error);
        showToast('Ошибка фильтрации данных', 'error');
        return list; // Возвращаем исходные данные при ошибке
    }
}

function resetFilters() {
    try {
        const today = new Date();
        const thirtyDaysAgo = new Date(today);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        // Безопасное обновление элементов
        const elements = {
            dateFrom: document.getElementById('dateFrom'),
            dateTo: document.getElementById('dateTo'),
            statusFilter: document.getElementById('statusFilter'),
            priceFrom: document.getElementById('priceFrom'),
            priceTo: document.getElementById('priceTo'),
            searchAllFilter: document.getElementById('searchAllFilter'),
            groupingType: document.getElementById('groupingType'),
            paymentsPerGroup: document.getElementById('paymentsPerGroup'),
            groupsPerPage: document.getElementById('groupsPerPage'),
            groupsPerPageBottom: document.getElementById('groupsPerPageBottom')
        };
        
        // Проверяем наличие всех элементов
        for (const [key, element] of Object.entries(elements)) {
            if (!element) {
                console.warn(`Элемент ${key} не найден`);
            }
        }
        
        if (elements.dateFrom) elements.dateFrom.value = thirtyDaysAgo.toISOString().split('T')[0];
        if (elements.dateTo) elements.dateTo.value = today.toISOString().split('T')[0];
        if (elements.statusFilter) elements.statusFilter.value = 'all';
        if (elements.priceFrom) elements.priceFrom.value = '';
        if (elements.priceTo) elements.priceTo.value = '';
        if (elements.searchAllFilter) elements.searchAllFilter.value = '';
        const searchEntireEl = document.getElementById('searchEntireDb');
        if (searchEntireEl) {
            searchEntireEl.checked = false;
            lastSearchEntireDb = false;
        }
        if (elements.groupingType) elements.groupingType.value = 'day';
        if (elements.paymentsPerGroup) elements.paymentsPerGroup.value = '100';
        if (elements.groupsPerPage) elements.groupsPerPage.value = '10';
        if (elements.groupsPerPageBottom) elements.groupsPerPageBottom.value = '10';
        if (typeof syncGroupsPerPageButtonText === 'function') syncGroupsPerPageButtonText();
        
        // Сброс периодов в карточках статистики
        const statDefaults = [
            { id: 'sentTotalPeriod', value: 'all', text: 'Все время' },
            { id: 'amountPeriod', value: 'today', text: 'Сегодня' },
            { id: 'earningsPeriod', value: 'today', text: 'Сегодня' },
            { id: 'differencePeriod', value: 'all', text: 'Все время' }
        ];
        statDefaults.forEach(({ id, value, text }) => {
            const input = document.getElementById(id);
            const btn = input?.closest('.stat-period-dropdown')?.querySelector('.stat-period-btn');
            if (input) input.value = value;
            if (btn) {
                const textEl = btn.querySelector('.stat-period-btn-text');
                if (textEl) textEl.textContent = text;
            }
        });
        
        clearServiceNameFilter();
        
        currentPage = 1;
        groupPagination = {};
        
        saveFiltersToStorage();
        loadPayments({ showSkeleton: true, resetPagination: true });
        if (typeof loadStats === 'function') loadStats();
        
        showToast('Фильтры сброшены', 'success');
    } catch (error) {
        console.error('Ошибка при сбросе фильтров:', error);
        showToast('Ошибка сброса фильтров', 'error');
    }
}

// ==================== SAVE FILTERS ====================
function toggleSaveFilters() {
    const enabled = document.getElementById('saveFilters').checked;
    localStorage.setItem('taxesSenderSaveFiltersEnabled', enabled ? 'true' : 'false');
    if (enabled) {
        saveFiltersToStorage();
        showToast('Фильтры будут сохраняться автоматически', 'success');
    } else {
        localStorage.removeItem('taxesSenderFilters');
        showToast('Автосохранение отключено', 'warning');
    }
}

function saveFiltersToStorage() {
    if (!document.getElementById('saveFilters').checked) return;
    
    const filters = {
        dateFrom: document.getElementById('dateFrom').value,
        dateTo: document.getElementById('dateTo').value,
        statusFilter: document.getElementById('statusFilter').value,
        priceFrom: document.getElementById('priceFrom').value,
        priceTo: document.getElementById('priceTo').value,
        searchAllFilter: document.getElementById('searchAllFilter')?.value || '',
        searchEntireDb: document.getElementById('searchEntireDb')?.checked || false,
        groupingType: document.getElementById('groupingType').value,
        paymentsPerGroup: document.getElementById('paymentsPerGroup').value,
        groupsPerPage: document.getElementById('groupsPerPage').value,
        selectedServices: getSelectedServiceFilters(),
        // Периоды в карточках статистики
        sentTotalPeriod: document.getElementById('sentTotalPeriod')?.value || 'all',
        amountPeriod: document.getElementById('amountPeriod')?.value || 'today',
        earningsPeriod: document.getElementById('earningsPeriod')?.value || 'today',
        differencePeriod: document.getElementById('differencePeriod')?.value || 'all'
    };
    
    localStorage.setItem('taxesSenderFilters', JSON.stringify(filters));
    localStorage.setItem('taxesSenderSaveFiltersEnabled', 'true');
}

function loadFiltersFromStorage() {
    const saved = localStorage.getItem('taxesSenderFilters');
    if (!saved) return false;
    
    try {
        const filters = JSON.parse(saved);
        document.getElementById('dateFrom').value = filters.dateFrom || '';
        document.getElementById('dateTo').value = filters.dateTo || '';
        document.getElementById('statusFilter').value = filters.statusFilter || 'all';
        document.getElementById('priceFrom').value = filters.priceFrom || '';
        document.getElementById('priceTo').value = filters.priceTo || '';
        const searchEl = document.getElementById('searchAllFilter');
        if (searchEl) searchEl.value = filters.searchAllFilter || '';
        const searchEntireEl = document.getElementById('searchEntireDb');
        if (searchEntireEl) {
            searchEntireEl.checked = !!filters.searchEntireDb;
            lastSearchEntireDb = !!filters.searchEntireDb;
        }
        document.getElementById('groupingType').value = filters.groupingType || 'day';
        document.getElementById('paymentsPerGroup').value = filters.paymentsPerGroup || '100';
        const gp = filters.groupsPerPage || '10';
        const gpEl = document.getElementById('groupsPerPage');
        const gpBottomEl = document.getElementById('groupsPerPageBottom');
        if (gpEl) gpEl.value = gp;
        if (gpBottomEl) gpBottomEl.value = gp;
        if (typeof syncGroupsPerPageButtonText === 'function') syncGroupsPerPageButtonText();
        
        // Периоды в карточках статистики
        const statPeriodLabels = { today: 'Сегодня', yesterday: 'Вчера', week: 'Неделя', month: 'Месяц', quarter: 'Квартал', year: 'Год', all: 'Все время' };
        const statPeriodIds = ['sentTotalPeriod', 'amountPeriod', 'earningsPeriod', 'differencePeriod'];
        statPeriodIds.forEach(id => {
            const saved = filters[id];
            if (saved) {
                const input = document.getElementById(id);
                const wrapper = input?.closest('.stat-period-dropdown');
                const btn = wrapper?.querySelector('.stat-period-btn');
                if (input) input.value = saved;
                if (btn) {
                    const textEl = btn.querySelector('.stat-period-btn-text');
                    if (textEl) textEl.textContent = statPeriodLabels[saved] || saved;
                }
            }
        });
        
        // Загружаем выбранные услуги (поддержка старого формата)
        if (filters.selectedServices && Array.isArray(filters.selectedServices)) {
            setSelectedServiceFilters(filters.selectedServices);
        } else if (filters.serviceName) {
            // Поддержка старого формата с одной услугой
            setSelectedServiceFilters([filters.serviceName]);
        }
        
        updateServiceFilterButton();
        
        const saveFiltersEl = document.getElementById('saveFilters');
        if (saveFiltersEl) saveFiltersEl.checked = (localStorage.getItem('taxesSenderSaveFiltersEnabled') !== 'false');
        return true;
    } catch (e) {
        return false;
    }
}

function applyFiltersIfSaved() {
    if (document.getElementById('saveFilters').checked) {
        saveFiltersToStorage();
        currentPage = 1;
        groupPagination = {};
        renderPayments();
    }
}

// Применение изменений группировки (не требует перезагрузки с сервера)
function applyGroupingChange() {
    try {
        saveFiltersToStorage();
        currentPage = 1;
        groupPagination = {};
        renderPayments();
    } catch (error) {
        console.error('Ошибка при изменении группировки:', error);
        showToast('Ошибка применения группировки', 'error');
    }
}

// ==================== SERVICE NAME FILTER ====================

// Хранилище выбранных услуг для фильтрации
let selectedServiceFilters = [];

function getSelectedServiceFilters() {
    return selectedServiceFilters;
}

function setSelectedServiceFilters(services) {
    selectedServiceFilters = services || [];
}

function showServiceNameFilterModal() {
    updateServiceNameSelects();
    openModal('serviceNameFilterModal');
}

function applyServiceNameFilter() {
    const checkboxes = document.querySelectorAll('.service-filter-checkbox:checked');
    selectedServiceFilters = Array.from(checkboxes).map(cb => cb.value);
    updateServiceFilterButton();
    closeModal('serviceNameFilterModal');
    saveFiltersToStorage(); // сохраняем сразу при «Применить»
    applyFiltersAutoClient();
}

function clearServiceNameFilter() {
    try {
        selectedServiceFilters = [];
        updateServiceFilterButton();
        const checkboxes = document.querySelectorAll('.service-filter-checkbox');
        if (checkboxes) {
            checkboxes.forEach(cb => { if (cb) cb.checked = false; });
        }
        saveFiltersToStorage();
        applyFiltersAutoClient();
    } catch (error) {
        console.error('Ошибка при очистке фильтра услуг:', error);
        showToast('Ошибка очистки фильтра', 'error');
    }
}

// ==================== TOGGLE FILTERS ====================

function toggleFilters() {
    const filtersSection = document.getElementById('filtersSection');
    const showFiltersBtn = document.getElementById('showFiltersBtn');
    const hideFiltersBtn = document.getElementById('hideFiltersBtn');
    
    if (filtersSection.classList.contains('hidden')) {
        // Показываем фильтры с анимацией разворачивания
        filtersSection.classList.remove('hidden');
        filtersSection.classList.add('animate-filter-expand');
        
        // Убираем класс анимации после завершения
        setTimeout(() => {
            filtersSection.classList.remove('animate-filter-expand');
        }, 500);
        
        // Кнопка "Поиск по фильтрам" исчезает из шапки
        showFiltersBtn.classList.add('hidden');
        
        // Сохраняем состояние
        localStorage.setItem('filtersVisible', 'true');
    } else {
        // Скрываем фильтры с анимацией
        
        // 1. Добавляем анимацию "улетания" кнопке "Скрыть фильтры"
        if (hideFiltersBtn) {
            hideFiltersBtn.classList.add('animate-fly-to-header');
        }
        
        // 2. Добавляем анимацию коллапса секции фильтров
        filtersSection.classList.add('animate-filter-collapse');
        
        // 3. Ждём окончания анимации (650ms) и скрываем фильтры
        setTimeout(() => {
            filtersSection.classList.add('hidden');
            filtersSection.classList.remove('animate-filter-collapse');
            
            // 4. Убираем класс анимации с кнопки "Скрыть фильтры"
            if (hideFiltersBtn) {
                hideFiltersBtn.classList.remove('animate-fly-to-header');
            }
            
            // 5. Показываем кнопку "Поиск по фильтрам" в шапке с анимацией появления
            showFiltersBtn.classList.remove('hidden');
            showFiltersBtn.classList.add('animate-appear-from-above');
            
            // 6. Убираем класс анимации после завершения (550ms)
            setTimeout(() => {
                showFiltersBtn.classList.remove('animate-appear-from-above');
            }, 550);
            
        }, 650);
        
        // Сохраняем состояние
        localStorage.setItem('filtersVisible', 'false');
    }
}

function initFiltersVisibility() {
    const filtersSection = document.getElementById('filtersSection');
    const showFiltersBtn = document.getElementById('showFiltersBtn');
    const filtersVisible = localStorage.getItem('filtersVisible');
    
    // По умолчанию фильтры видимы
    if (filtersVisible === 'false') {
        filtersSection.classList.add('hidden');
        showFiltersBtn.classList.remove('hidden');
    } else {
        filtersSection.classList.remove('hidden');
        showFiltersBtn.classList.add('hidden');
    }
}

function updateServiceFilterButton() {
    const btn = document.getElementById('clearServiceFilterBtn');
    const input = document.getElementById('serviceNameFilter');
    
    if (selectedServiceFilters.length > 0) {
        if (btn) btn.classList.remove('hidden');
        
        // Обновляем текст в поле ввода
        if (input) {
            const count = selectedServiceFilters.length;
            if (count === 1) {
                input.value = selectedServiceFilters[0];
            } else {
                input.value = `Выбрано услуг: ${count}`;
            }
            input.title = selectedServiceFilters.join('\n');
        }
    } else {
        if (btn) btn.classList.add('hidden');
        if (input) {
            input.value = '';
            input.title = '';
        }
    }
}
