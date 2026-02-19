// ==================== PAGINATION ====================

// Groups per page dropdown (стиль как stat-period)
let groupsPerPageDropdownOutsideHandler = null;

function toggleGroupsPerPageDropdown(position) {
    const suffix = position === 'top' ? 'Top' : 'Bottom';
    const dropdown = document.getElementById('groupsPerPageDropdown' + suffix);
    const btn = document.getElementById('groupsPerPageBtn' + suffix);
    const wrapper = dropdown?.closest('.groups-per-page-dropdown');
    if (!dropdown || !wrapper) return;

    const isOpen = dropdown.classList.contains('show');
    closeAllGroupsPerPageDropdowns();

    if (!isOpen) {
        dropdown.classList.add('show');
        wrapper.classList.add('open');
        setTimeout(() => {
            groupsPerPageDropdownOutsideHandler = (e) => {
                if (!dropdown.contains(e.target) && (!btn || !btn.contains(e.target))) {
                    closeAllGroupsPerPageDropdowns();
                    document.removeEventListener('click', groupsPerPageDropdownOutsideHandler);
                }
            };
            document.addEventListener('click', groupsPerPageDropdownOutsideHandler);
        }, 0);
    }
}

function closeAllGroupsPerPageDropdowns() {
    document.querySelectorAll('.groups-per-page-dropdown').forEach(wrapper => {
        wrapper.classList.remove('open');
        const menu = wrapper.querySelector('.groups-per-page-menu');
        if (menu) menu.classList.remove('show');
    });
    if (groupsPerPageDropdownOutsideHandler) {
        document.removeEventListener('click', groupsPerPageDropdownOutsideHandler);
        groupsPerPageDropdownOutsideHandler = null;
    }
}

function setGroupsPerPage(value, text) {
    const topInput = document.getElementById('groupsPerPage');
    const bottomInput = document.getElementById('groupsPerPageBottom');
    const topBtn = document.getElementById('groupsPerPageBtnTop');
    const bottomBtn = document.getElementById('groupsPerPageBtnBottom');
    if (topInput) topInput.value = value;
    if (bottomInput) bottomInput.value = value;
    if (topBtn) {
        const textEl = topBtn.querySelector('.groups-per-page-btn-text');
        if (textEl) textEl.textContent = text;
    }
    if (bottomBtn) {
        const textEl = bottomBtn.querySelector('.groups-per-page-btn-text');
        if (textEl) textEl.textContent = text;
    }
    closeAllGroupsPerPageDropdowns();
    currentPage = 1;
    if (typeof saveFiltersToStorage === 'function') saveFiltersToStorage();
    renderPayments();
}

function syncGroupsPerPageButtonText() {
    const value = document.getElementById('groupsPerPage')?.value || '10';
    const text = value + ' групп';
    document.querySelectorAll('.groups-per-page-btn-text').forEach(el => {
        el.textContent = text;
    });
}

function initGroupsPerPageDropdowns() {
    ['Top', 'Bottom'].forEach(suffix => {
        const dropdown = document.getElementById('groupsPerPageDropdown' + suffix);
        if (!dropdown) return;
        dropdown.querySelectorAll('.dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const value = item.getAttribute('data-value');
                const text = item.textContent.trim();
                if (value) setGroupsPerPage(value, text);
            });
        });
    });
    syncGroupsPerPageButtonText();
}

function renderPageNumbers(containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
        return;
    }
    
    let html = '';
    
    const maxVisible = 7; // Максимум видимых страниц
    let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    
    // Корректируем если не хватает страниц слева
    if (endPage - startPage < maxVisible - 1) {
        startPage = Math.max(1, endPage - maxVisible + 1);
    }
    
    // Первая страница
    if (startPage > 1) {
        html += `<li class="page-item"><button class="page-link" onclick="goToPage(1)">1</button></li>`;
        if (startPage > 2) {
            html += `<li class="page-item disabled"><button class="page-link" disabled>...</button></li>`;
        }
    }
    
    // Страницы
    for (let i = startPage; i <= endPage; i++) {
        const activeClass = i === currentPage ? 'active' : '';
        html += `<li class="page-item ${activeClass}"><button class="page-link" onclick="goToPage(${i})">${i}</button></li>`;
    }
    
    // Последняя страница
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            html += `<li class="page-item disabled"><button class="page-link" disabled>...</button></li>`;
        }
        html += `<li class="page-item"><button class="page-link" onclick="goToPage(${totalPages})">${totalPages}</button></li>`;
    }
    
    container.innerHTML = html;
}

function updatePagination(totalGroups) {
    const paginationTop = document.getElementById('paginationTop');
    const paginationBottom = document.getElementById('paginationBottom');
    
    if (!paginationTop || !paginationBottom) {
        return;
    }
    
    // Всегда показываем пагинацию (хотя бы для выбора количества групп)
    paginationTop.classList.remove('hidden');
    paginationBottom.classList.remove('hidden');
    
    const startGroup = (currentPage - 1) * groupsPerPage + 1;
    const endGroup = Math.min(currentPage * groupsPerPage, totalGroups);
    
    const infoText = `Показаны группы ${startGroup}-${endGroup} из ${totalGroups}${totalPages > 1 ? ` (страница ${currentPage} из ${totalPages})` : ''}`;
    
    const infoTop = document.getElementById('paginationInfoTop');
    const infoBottom = document.getElementById('paginationInfoBottom');
    if (infoTop) {
        infoTop.textContent = infoText;
        // Убираем класс скелетона и inline стили, если они были
        infoTop.classList.remove('skeleton-text');
        infoTop.style.display = '';
        infoTop.style.width = '';
        infoTop.style.height = '';
    }
    if (infoBottom) {
        infoBottom.textContent = infoText;
        // Убираем класс скелетона и inline стили, если они были
        infoBottom.classList.remove('skeleton-text');
        infoBottom.style.display = '';
        infoBottom.style.width = '';
        infoBottom.style.height = '';
    }
    
    // Синхронизируем селекторы и текст кнопок
    const groupsPerPageEl = document.getElementById('groupsPerPage');
    const groupsPerPageBottomEl = document.getElementById('groupsPerPageBottom');
    if (groupsPerPageEl && groupsPerPageBottomEl) {
        const topValue = groupsPerPageEl.value;
        groupsPerPageBottomEl.value = topValue;
        syncGroupsPerPageButtonText();
    }
    
    // Обновляем кнопки
    const firstDisabled = currentPage <= 1;
    const lastDisabled = currentPage >= totalPages;
    const hideControls = totalPages <= 1;
    
    ['Top', 'Bottom'].forEach(suffix => {
        const numbersEl = document.getElementById('paginationNumbers' + suffix);
        if (!numbersEl) return;
        
        const controls = numbersEl.parentElement;
        if (!controls) return;
        
        // Убираем эффект скелетона с кнопок
        const allButtons = controls.querySelectorAll('button');
        allButtons.forEach(btn => {
            btn.classList.remove('skeleton-pagination-btn');
            // Убираем все inline стили скелетона
            btn.style.removeProperty('opacity');
            btn.style.removeProperty('pointer-events');
        });
        
        // Скрываем/показываем кнопки навигации
        if (hideControls) {
            controls.classList.add('hidden');
        } else {
            controls.classList.remove('hidden');
            
            const firstBtn = document.getElementById('paginationFirst' + suffix);
            const prevBtn = document.getElementById('paginationPrev' + suffix);
            const nextBtn = document.getElementById('paginationNext' + suffix);
            const lastBtn = document.getElementById('paginationLast' + suffix);
            
            if (firstBtn) firstBtn.disabled = firstDisabled;
            if (prevBtn) prevBtn.disabled = firstDisabled;
            if (nextBtn) nextBtn.disabled = lastDisabled;
            if (lastBtn) lastBtn.disabled = lastDisabled;
        }
    });
    
    // Генерируем номера страниц только если нужно
    if (!hideControls) {
        const numbersTop = document.getElementById('paginationNumbersTop');
        const numbersBottom = document.getElementById('paginationNumbersBottom');
        if (numbersTop) {
            renderPageNumbers('paginationNumbersTop');
        }
        if (numbersBottom) {
            renderPageNumbers('paginationNumbersBottom');
        }
    }
}

function goToPage(page) {
    currentPage = page;
    renderPayments();
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const paginationTopEl = document.getElementById('paginationTop');
            const header = document.querySelector('.app-header');
            const headerHeight = header ? header.getBoundingClientRect().height : 0;
            const gap = 15;
            if (paginationTopEl) {
                const rect = paginationTopEl.getBoundingClientRect();
                const targetScrollY = rect.top + window.scrollY - headerHeight - gap;
                window.scrollTo({ top: Math.max(0, targetScrollY), behavior: 'smooth' });
            } else {
                window.scrollTo({ top: Math.max(0, headerHeight + gap), behavior: 'smooth' });
            }
        });
    });
}

function goToFirstPage() {
    goToPage(1);
}

function goToPrevPage() {
    if (currentPage > 1) {
        goToPage(currentPage - 1);
    }
}

function goToNextPage() {
    if (currentPage < totalPages) {
        goToPage(currentPage + 1);
    }
}

function goToLastPage() {
    goToPage(totalPages);
}

function updatePaginationSettings() {
    currentPage = 1;
    // Синхронизируем нижний селектор с верхним
    const topValue = document.getElementById('groupsPerPage').value;
    document.getElementById('groupsPerPageBottom').value = topValue;
    renderPayments();
}

function updatePaginationFromBottom() {
    currentPage = 1;
    // Синхронизируем верхний селектор с нижним
    const bottomValue = document.getElementById('groupsPerPageBottom').value;
    document.getElementById('groupsPerPage').value = bottomValue;
    renderPayments();
}

// ==================== GROUP PAGINATION ====================

function renderGroupPagination(groupKey, currentPage, totalPages, totalCount, position) {
    const maxVisible = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    
    if (endPage - startPage < maxVisible - 1) {
        startPage = Math.max(1, endPage - maxVisible + 1);
    }
    
    let pagesHtml = '';
    
    // Первая страница
    if (startPage > 1) {
        pagesHtml += `<li class="page-item"><button class="page-link" onclick="goToGroupPage('${groupKey}', 1)">1</button></li>`;
        if (startPage > 2) {
            pagesHtml += `<li class="page-item disabled"><button class="page-link" disabled>...</button></li>`;
        }
    }
    
    // Страницы
    for (let i = startPage; i <= endPage; i++) {
        const activeClass = i === currentPage ? 'active' : '';
        pagesHtml += `<li class="page-item ${activeClass}"><button class="page-link" onclick="goToGroupPage('${groupKey}', ${i})">${i}</button></li>`;
    }
    
    // Последняя страница
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            pagesHtml += `<li class="page-item disabled"><button class="page-link" disabled>...</button></li>`;
        }
        pagesHtml += `<li class="page-item"><button class="page-link" onclick="goToGroupPage('${groupKey}', ${totalPages})">${totalPages}</button></li>`;
    }
    
    const perGroup = parseInt(document.getElementById('paymentsPerGroup').value) || 100;
    const startItem = (currentPage - 1) * perGroup + 1;
    const endItem = Math.min(currentPage * perGroup, totalCount);
    
    return `
        <div class="group-pagination-wrapper">
            <div class="group-pagination-controls">
                <button type="button" class="btn btn-pagination-nav btn-pagination-nav-group" onclick="goToGroupFirstPage('${groupKey}')" ${currentPage <= 1 ? 'disabled' : ''} title="Первая">
                    <i class="bi bi-chevron-double-left"></i>
                </button>
                <button type="button" class="btn btn-pagination-nav btn-pagination-nav-group" onclick="goToGroupPrevPage('${groupKey}')" ${currentPage <= 1 ? 'disabled' : ''} title="Назад">
                    <i class="bi bi-chevron-left"></i>
                </button>
                <ul class="pagination pagination-sm mb-0">
                    ${pagesHtml}
                </ul>
                <button type="button" class="btn btn-pagination-nav btn-pagination-nav-group" onclick="goToGroupNextPage('${groupKey}')" ${currentPage >= totalPages ? 'disabled' : ''} title="Вперед">
                    <i class="bi bi-chevron-right"></i>
                </button>
                <button type="button" class="btn btn-pagination-nav btn-pagination-nav-group" onclick="goToGroupLastPage('${groupKey}')" ${currentPage >= totalPages ? 'disabled' : ''} title="Последняя">
                    <i class="bi bi-chevron-double-right"></i>
                </button>
            </div>
            <span class="group-pagination-info">Показано ${startItem}–${endItem} из ${totalCount} · стр. ${currentPage} из ${totalPages}</span>
        </div>
    `;
}

function goToGroupPage(groupKey, page) {
    if (groupPagination[groupKey]) {
        groupPagination[groupKey].currentPage = page;
        if (typeof updateSingleGroupView === 'function') {
            updateSingleGroupView(groupKey);
        } else {
            renderPayments();
        }
    }
}

function goToGroupFirstPage(groupKey) {
    goToGroupPage(groupKey, 1);
}

function goToGroupPrevPage(groupKey) {
    if (groupPagination[groupKey] && groupPagination[groupKey].currentPage > 1) {
        goToGroupPage(groupKey, groupPagination[groupKey].currentPage - 1);
    }
}

function goToGroupNextPage(groupKey) {
    if (groupPagination[groupKey]) {
        const perGroup = parseInt(document.getElementById('paymentsPerGroup').value) || 100;
        const totalCount = allGroupedPayments[groupKey].length;
        const totalPages = Math.ceil(totalCount / perGroup);
        
        if (groupPagination[groupKey].currentPage < totalPages) {
            goToGroupPage(groupKey, groupPagination[groupKey].currentPage + 1);
        }
    }
}

function goToGroupLastPage(groupKey) {
    if (groupPagination[groupKey]) {
        const perGroup = parseInt(document.getElementById('paymentsPerGroup').value) || 100;
        const totalCount = allGroupedPayments[groupKey].length;
        const totalPages = Math.ceil(totalCount / perGroup);
        goToGroupPage(groupKey, totalPages);
    }
}
