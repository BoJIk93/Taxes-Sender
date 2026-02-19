// ==================== STATS ====================

const valueElements = [
    'statPending', 'statSent', 'statAmount',
    'statAmountPeriod',
    'statEarnings', 'statDifference'
];

async function loadStats(opts) {
    opts = opts || {};
    const showSkeleton = opts.showSkeleton === true;
    const useSkeleton = opts.useSkeleton === true;

    // Перед загрузкой: shimmer на отдельных карточках (тихое обновление)
    const statPending = document.getElementById('statPending');
    const statSent = document.getElementById('statSent');
    const statAmount = document.getElementById('statAmount');

    if (useSkeleton) {
        [statPending, statSent, statAmount].forEach(el => {
            if (el && !el.classList.contains('loading')) {
                if (!el.textContent || el.textContent.trim() === '' || el.textContent === '0' || el.textContent === '0 ₽') {
                    el.innerHTML = '&nbsp;';
                }
                el.classList.add('loading');
            }
        });
    }

    try {
        const res = await fetch('/api/stats');
        const data = await res.json();

        // Убираем скелетон и показываем данные
        statPending?.classList.remove('loading');
        statSent?.classList.remove('loading');
        statAmount?.classList.remove('loading');

        if (statPending) statPending.textContent = data.pending || 0;

        // statSent — количество отправленных за выбранный период
        if (data.sent_by_period) {
            const sentTotalPeriod = document.getElementById('sentTotalPeriod')?.value || 'all';
            const sentTotalData = data.sent_by_period[sentTotalPeriod];
            if (statSent) statSent.textContent = sentTotalData?.count ?? data.sent ?? 0;
        } else {
            if (statSent) statSent.textContent = data.sent || 0;
        }
        if (statAmount) statAmount.textContent = formatCurrency(data.total_amount || 0);

        // Сумма (с фильтром по периодам)
        if (data.sent_by_period) {
            const amountPeriod = document.getElementById('amountPeriod')?.value || 'today';
            const amountData = data.sent_by_period[amountPeriod];

            const statAmountPeriod = document.getElementById('statAmountPeriod');
            if (statAmountPeriod) {
                statAmountPeriod.classList.remove('loading');
                statAmountPeriod.textContent = formatCurrency(amountData?.amount || 0);
            }

            const amountLabel = document.getElementById('amountLabel');
            if (amountLabel) amountLabel.innerHTML = `<i class="bi bi-currency-exchange me-1"></i>Отправлено в налоговую`;
        }

        // Заработок от ЮКассы (с фильтром по периодам)
        if (data.earnings) {
            const earningsPeriod = document.getElementById('earningsPeriod')?.value || 'today';
            const earningsAmount = data.earnings[earningsPeriod];

            const statEarnings = document.getElementById('statEarnings');
            if (statEarnings) {
                statEarnings.classList.remove('loading');
                statEarnings.textContent = formatCurrency(earningsAmount || 0);
            }

            const earningsLabel = document.getElementById('earningsLabel');
            if (earningsLabel) earningsLabel.innerHTML = `<i class="bi bi-wallet2 me-1"></i>Заработок`;
        }

        // Разница между ЮКасса и налоговой
        if (data.differences) {
            const period = document.getElementById('differencePeriod')?.value || 'all';
            const diff = data.differences[period];
            if (diff) {
                const difference = diff.yookassa - diff.tax;

                const differenceLabel = document.getElementById('differenceLabel');
                if (differenceLabel) differenceLabel.innerHTML = `<i class="bi bi-graph-up me-1"></i>Разница`;

                const valueEl = document.getElementById('statDifference');
                const subtextEl = document.getElementById('differenceSubtext');

                if (valueEl) {
                    valueEl.classList.remove('loading');
                    if (Math.abs(difference) < 0.01) {
                        valueEl.textContent = '0 ₽';
                        if (subtextEl) subtextEl.textContent = 'Совпадает';
                    } else if (difference > 0) {
                        valueEl.textContent = '−' + formatCurrency(difference);
                        if (subtextEl) subtextEl.textContent = 'Недоимка';
                    } else {
                        valueEl.textContent = '+' + formatCurrency(Math.abs(difference));
                        if (subtextEl) subtextEl.textContent = 'ЮКасса от налоговой';
                    }
                }
            }
        }

        // Первая загрузка: плавный переход скелетон → карточки
        if (showSkeleton) {
            const statsSection = document.getElementById('statsSection');
            const statsSkeleton = document.getElementById('statsSkeleton');
            if (statsSection) statsSection.classList.add('stats-content-ready');
            if (statsSkeleton) statsSkeleton.classList.add('stats-skeleton-hidden');
        }
    } catch (e) {
        console.error('Error loading stats:', e);
        valueElements.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove('loading');
        });
        if (showSkeleton) {
            const statsSection = document.getElementById('statsSection');
            const statsSkeleton = document.getElementById('statsSkeleton');
            if (statsSection) statsSection.classList.add('stats-content-ready');
            if (statsSkeleton) statsSkeleton.classList.add('stats-skeleton-hidden');
        }
    }
}

// ==================== STAT PERIOD DROPDOWN (как у автосинхронизации: кнопка + chevron-down + меню) ====================

function toggleStatPeriodDropdown(periodId) {
    const dropdown = document.querySelector(`#${periodId}`)?.closest('.stat-period-dropdown');
    if (!dropdown) return;
    const menu = dropdown.querySelector('.stat-period-menu');
    const btn = dropdown.querySelector('.stat-period-btn');
    const isOpen = dropdown.classList.contains('open');
    closeAllStatPeriodDropdowns();
    if (!isOpen) {
        dropdown.classList.add('open');
        if (menu) {
            menu.classList.remove('stat-period-menu-open-below', 'stat-period-menu-align-left');
            menu.classList.add('show');
            if (btn) positionStatPeriodMenu(btn, menu);
        }
        setTimeout(() => {
            document.addEventListener('click', closeStatPeriodDropdownOnClickOutside);
        }, 0);
    }
}

function closeAllStatPeriodDropdowns() {
    document.querySelectorAll('.stat-period-dropdown.open').forEach(dropdown => {
        dropdown.classList.remove('open');
        const menu = dropdown.querySelector('.stat-period-menu');
        if (menu) {
            menu.classList.remove('show', 'stat-period-menu-open-below', 'stat-period-menu-align-left');
        }
    });
    document.removeEventListener('click', closeStatPeriodDropdownOnClickOutside);
}

/** Умное позиционирование выпадающего меню периода (как у receipt-dropdown) */
function positionStatPeriodMenu(button, menu) {
    requestAnimationFrame(() => {
        const buttonRect = button.getBoundingClientRect();
        const menuHeight = menu.offsetHeight || 200;
        const menuWidth = menu.offsetWidth || 120;
        const vp = getViewportBounds();
        const gap = 6;

        // Вертикально: по умолчанию открываем вверх (above). Если не помещается — вниз (below).
        const topEdgeIfOpenUp = buttonRect.top - menuHeight - gap;
        const bottomEdgeIfOpenDown = buttonRect.bottom + menuHeight + gap;
        const fitsAbove = topEdgeIfOpenUp >= vp.top;
        const fitsBelow = bottomEdgeIfOpenDown <= vp.bottom;

        if (!fitsAbove && fitsBelow) {
            menu.classList.add('stat-period-menu-open-below');
        } else if (!fitsAbove && !fitsBelow) {
            const spaceAbove = buttonRect.top - vp.top;
            const spaceBelow = vp.bottom - buttonRect.bottom;
            if (spaceBelow > spaceAbove) {
                menu.classList.add('stat-period-menu-open-below');
            }
        }

        // Горизонтально: по умолчанию right: 0. Если не помещается — выравниваем по левому краю кнопки.
        const menuLeftEdgeIfRight = buttonRect.right - menuWidth;
        const fitsRight = menuLeftEdgeIfRight >= vp.left && buttonRect.right <= vp.right;

        if (!fitsRight) {
            const menuRightEdgeIfLeft = buttonRect.left + menuWidth;
            const fitsLeft = buttonRect.left >= vp.left && menuRightEdgeIfLeft <= vp.right;
            if (fitsLeft) {
                menu.classList.add('stat-period-menu-align-left');
            } else {
                const spaceRight = vp.right - buttonRect.right;
                const spaceLeft = buttonRect.left - vp.left;
                if (spaceLeft > spaceRight) {
                    menu.classList.add('stat-period-menu-align-left');
                }
            }
        }
    });
}

function closeStatPeriodDropdownOnClickOutside(e) {
    if (e.target.closest('.stat-period-dropdown')) return;
    closeAllStatPeriodDropdowns();
}

/** ID элемента со значением для карточки по ID поля периода */
function getStatValueIdForPeriod(periodId) {
    const map = {
        sentTotalPeriod: 'statSent',
        amountPeriod: 'statAmountPeriod',
        earningsPeriod: 'statEarnings',
        differencePeriod: 'statDifference'
    };
    return map[periodId] || null;
}

function showStatCardSkeleton(periodId) {
    const valueId = getStatValueIdForPeriod(periodId);
    if (!valueId) return;
    const valueEl = document.getElementById(valueId);
    if (!valueEl) return;
    if (!valueEl.textContent || valueEl.textContent.trim() === '') valueEl.innerHTML = '&nbsp;';
    valueEl.classList.add('loading');
}

function initStatPeriodDropdowns() {
    document.querySelectorAll('.stat-period-menu').forEach(menu => {
        const periodId = menu.id.replace('Dropdown', '');
        const hiddenInput = document.getElementById(periodId);
        const btn = menu.closest('.stat-period-dropdown')?.querySelector('.stat-period-btn');
        if (!hiddenInput || !btn) return;
        menu.querySelectorAll('.dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const value = item.getAttribute('data-value');
                const text = item.textContent.trim();
                if (value) {
                    hiddenInput.value = value;
                    const textEl = btn.querySelector('.stat-period-btn-text');
                    if (textEl) textEl.textContent = text;
                    closeAllStatPeriodDropdowns();
                    if (typeof saveFiltersToStorage === 'function') saveFiltersToStorage();
                    showStatCardSkeleton(periodId);
                    loadStats();
                }
            });
        });
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStatPeriodDropdowns);
} else {
    initStatPeriodDropdowns();
}
