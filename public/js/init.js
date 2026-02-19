// ==================== AUTH ====================

async function checkAuthStatus() {
    try {
        const res = await fetch('/api/auth/status');
        const data = await res.json();
        if (data.authEnabled && !data.authenticated) {
            showAuthOverlay();
            return false;
        }
        hideAuthOverlay();
        return true;
    } catch (e) {
        // Сервер недоступен — показываем приложение, ошибка обработается позже
        return true;
    }
}

function showAuthOverlay() {
    // Закрываем все открытые Bootstrap-модалки, чтобы их focus-trap не блокировал ввод
    document.querySelectorAll('.modal.show').forEach(modalEl => {
        const bsModal = bootstrap.Modal.getInstance(modalEl);
        if (bsModal) bsModal.hide();
    });
    const overlay = document.getElementById('authOverlay');
    if (overlay) {
        overlay.classList.remove('hidden');
        overlay.setAttribute('aria-hidden', 'false');
        setTimeout(() => document.getElementById('authLogin')?.focus(), 100);
    }
}

function hideAuthOverlay() {
    const overlay = document.getElementById('authOverlay');
    if (overlay) {
        overlay.classList.add('hidden');
        overlay.setAttribute('aria-hidden', 'true');
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const login = document.getElementById('authLogin').value.trim();
    const password = document.getElementById('authPassword').value;
    const errorEl = document.getElementById('authError');
    const submitBtn = document.getElementById('authSubmitBtn');

    if (!login || !password) {
        showAuthError('Введите логин и пароль');
        return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="bi bi-hourglass-split me-2"></i>Вход...';

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ login, password })
        });
        const data = await res.json();
        if (data.success) {
            hideAuthOverlay();
            if (errorEl) errorEl.classList.add('hidden');
            await initApp();
        } else {
            showAuthError(data.error || 'Ошибка авторизации');
            // Блокировка — отключаем кнопку на время
            if (data.locked && data.retryAfter) {
                startLockoutCountdown(submitBtn, data.retryAfter);
            }
        }
    } catch (e) {
        showAuthError('Ошибка сети. Проверьте подключение к серверу.');
    } finally {
        if (!submitBtn._lockoutActive) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="bi bi-box-arrow-in-right me-2"></i>Войти';
        }
    }
}

function startLockoutCountdown(btn, seconds) {
    btn._lockoutActive = true;
    btn.disabled = true;
    let remaining = seconds;
    const tick = () => {
        if (remaining <= 0) {
            btn._lockoutActive = false;
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-box-arrow-in-right me-2"></i>Войти';
            return;
        }
        const m = Math.floor(remaining / 60);
        const s = remaining % 60;
        btn.innerHTML = `<i class="bi bi-lock-fill me-2"></i>Заблокировано (${m}:${String(s).padStart(2, '0')})`;
        remaining--;
        setTimeout(tick, 1000);
    };
    tick();
}

function showAuthError(msg) {
    const el = document.getElementById('authError');
    if (el) {
        el.textContent = msg;
        el.classList.remove('hidden');
    }
}

function toggleAuthPasswordVisibility() {
    const input = document.getElementById('authPassword');
    const icon = document.getElementById('authTogglePassIcon');
    if (!input) return;
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    if (icon) {
        icon.classList.toggle('bi-eye', !isPassword);
        icon.classList.toggle('bi-eye-slash', isPassword);
    }
}

// Auth settings functions (used in settings modal)
async function loadAuthSettings() {
    try {
        const res = await fetch('/api/auth/settings');
        if (!res.ok) return;
        const data = await res.json();
        const enabledEl = document.getElementById('authEnabledSetting');
        const block = document.getElementById('authSettingsBlock');
        const loginDisplay = document.getElementById('authCurrentLoginDisplay');
        if (enabledEl) enabledEl.checked = data.enabled;
        if (block) block.classList.toggle('hidden', !data.enabled);
        if (loginDisplay) loginDisplay.value = data.login || 'admin';
    } catch (e) {
        console.error('Error loading auth settings:', e);
    }
}

async function toggleAuthEnabledSetting() {
    const enabled = document.getElementById('authEnabledSetting')?.checked;
    const block = document.getElementById('authSettingsBlock');
    if (block) block.classList.toggle('hidden', !enabled);
    // Подавляем перехват 401 на время переключения, чтобы фоновые запросы не сбросили модалку
    window._authInterceptSuppressed = true;
    try {
        const res = await fetch('/api/auth/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled })
        });
        const data = await res.json();
        if (data.success) {
            showToast(enabled ? 'Авторизация включена' : 'Авторизация отключена', enabled ? 'success' : 'warning');
            if (enabled) await loadAuthSettings();
        }
    } catch (e) {
        showToast('Ошибка сети', 'error');
    } finally {
        // Даём браузеру время сохранить cookie перед снятием блокировки
        setTimeout(() => { window._authInterceptSuppressed = false; }, 1000);
    }
}

async function saveAuthCredentials(silent) {
    const currentPassword = document.getElementById('authCurrentPassword')?.value;
    const newLogin = document.getElementById('authNewLogin')?.value;
    const newPassword = document.getElementById('authNewPassword')?.value;

    if (!currentPassword) {
        if (!silent) showToast('Введите текущий пароль для подтверждения', 'warning');
        return;
    }
    if (!newLogin && !newPassword) {
        if (!silent) showToast('Введите новый логин или пароль', 'warning');
        return;
    }

    try {
        const res = await fetch('/api/auth/change', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword, newLogin, newPassword })
        });
        const data = await res.json();
        if (data.success) {
            if (!silent) showToast('Логин/пароль обновлены', 'success');
            document.getElementById('authCurrentPassword').value = '';
            document.getElementById('authNewLogin').value = '';
            document.getElementById('authNewPassword').value = '';
            loadAuthSettings();
        } else {
            showToast(data.error || 'Ошибка', 'error');
        }
    } catch (e) {
        showToast('Ошибка сети', 'error');
    }
}

async function resetAuthToDefaults() {
    if (!confirm('Сбросить логин и пароль на стандартные (admin / admin)?')) return;
    try {
        const res = await fetch('/api/auth/reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (data.success) {
            showToast(`Данные сброшены. Логин: ${data.defaultLogin}, пароль: ${data.defaultPassword}`, 'success');
            loadAuthSettings();
        } else {
            showToast(data.error || 'Ошибка', 'error');
        }
    } catch (e) {
        showToast('Ошибка сети', 'error');
    }
}

async function logoutFromSettings() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
        location.reload();
    } catch (e) {
        location.reload();
    }
}

// ==================== INIT ====================

function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.addEventListener('DOMContentLoaded', async () => {
    // Проверяем авторизацию перед загрузкой приложения
    const authOk = await checkAuthStatus();
    if (!authOk) return; // Показан экран входа — ждём логина

    await initApp();
});

async function initApp() {
    // Сразу подставляем интервал автосинхронизации из localStorage, чтобы кнопка не мигала
    if (typeof loadAutoSyncSettings === 'function') loadAutoSyncSettings();
    const syncBtnGroup = document.getElementById('syncBtnGroup');
    if (syncBtnGroup && !syncBtnGroup.classList.contains('sync-btn-group-ready')) syncBtnGroup.classList.add('sync-btn-group-ready');

    const scrollToTopBtn = document.getElementById('scrollToTopBtn');
    if (scrollToTopBtn) {
        const toggleScrollToTop = () => {
            scrollToTopBtn.classList.toggle('hidden', window.scrollY < 200);
        };
        window.addEventListener('scroll', toggleScrollToTop, { passive: true });
        toggleScrollToTop();
    }
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // Try to load saved filters
    const filtersLoaded = loadFiltersFromStorage();

    if (!filtersLoaded) {
        const thirtyDaysAgo = new Date(today);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        document.getElementById('dateFrom').value = thirtyDaysAgo.toISOString().split('T')[0];
        document.getElementById('dateTo').value = todayStr;
    } else {
        if (document.getElementById('saveFilters')?.checked) {
            saveFiltersToStorage();
        }
    }
    const saveEnabled = localStorage.getItem('taxesSenderSaveFiltersEnabled');
    if (saveEnabled !== null) {
        const saveFiltersEl = document.getElementById('saveFilters');
        if (saveFiltersEl) saveFiltersEl.checked = (saveEnabled !== 'false');
    }

    // Set date limits for random settings
    const tenDaysAgo = new Date(today);
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    document.getElementById('randomDateFrom').value = tenDaysAgo.toISOString().split('T')[0];
    document.getElementById('randomDateFrom').min = tenDaysAgo.toISOString().split('T')[0];
    document.getElementById('randomDateTo').value = today.toISOString().split('T')[0];
    document.getElementById('randomDateTo').max = today.toISOString().split('T')[0];
    
    if (typeof loadAutoSendSettings === 'function') loadAutoSendSettings();
    const autoSendBtn = document.getElementById('autoSendBtn');
    if (autoSendBtn && typeof autoSendSettings !== 'undefined') {
        autoSendBtn.classList.toggle('btn-primary', autoSendSettings.enabled);
        autoSendBtn.classList.toggle('btn-outline-secondary', !autoSendSettings.enabled);
    }
    await checkConfig();
}

async function checkConfig() {
    try {
        const res = await fetch('/api/config/check');
        const data = await res.json();
        
        if (!data.configured || !data.hasYookassa || !data.hasNalog) {
            document.getElementById('setupWizard').classList.remove('hidden');
            document.getElementById('mainContent').classList.add('hidden');
        } else {
            // Применяем настройки карточек до показа контента
            if (typeof loadStatCardsSettings === 'function') loadStatCardsSettings();
            if (typeof applyStatCardsSettings === 'function') applyStatCardsSettings();

            document.getElementById('setupWizard').classList.add('hidden');
            document.getElementById('mainContent').classList.remove('hidden');
            
            // Инициализируем видимость фильтров
            initFiltersVisibility();
            
            // Первая загрузка: можно показать скелетоны и сбросить пагинацию
            await Promise.all([
                loadStats({ showSkeleton: true }),
                loadServiceNames(),
                loadPayments({ showSkeleton: true, resetPagination: true })
            ]);
            if (typeof initGroupsPerPageDropdowns === 'function') initGroupsPerPageDropdowns();

            // Синхронизация при старте — только если есть данные и для налоговой, и для ЮКассы
            const hasBothConfigs = data.hasYookassa && data.hasNalog;
            const startedAt = data.serverStartedAt ? Number(data.serverStartedAt) : 0;
            const isFreshServerStart = startedAt && (Date.now() - startedAt < 40000);
            if (hasBothConfigs && isFreshServerStart && typeof runTaxSyncOnStartup === 'function') {
                setTimeout(runTaxSyncOnStartup, 800);
            }

        }
    } catch (e) {
        if (typeof hideSyncShutter === 'function') hideSyncShutter();
        showToast('Ошибка подключения к серверу. Проверьте, что сервер запущен.', 'error');
    }
}

// ==================== DANGER ZONE ====================

async function dangerClearDatabase() {
    if (!confirm('Вы уверены? Все чеки, кэш налоговой и наименования услуг будут удалены.\n\nДанные подключений (ЮКасса, налоговая) останутся.\n\nЭто действие необратимо!')) return;
    if (!confirm('Подтвердите ещё раз: УДАЛИТЬ ВСЮ БАЗУ ДАННЫХ?')) return;
    try {
        const res = await fetch('/api/danger/clear-database', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast('База данных очищена', 'success');
            setTimeout(() => location.reload(), 1000);
        } else {
            showToast(data.error || 'Ошибка', 'error');
        }
    } catch (e) {
        showToast('Ошибка сети', 'error');
    }
}

async function dangerClearConnections() {
    if (!confirm('Вы уверены? Данные подключений ЮКассы и налоговой будут удалены.\n\nБаза данных чеков и настройки интерфейса останутся.\n\nЭто действие необратимо!')) return;
    try {
        const res = await fetch('/api/danger/clear-connections', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast('Данные подключений удалены', 'success');
            setTimeout(() => location.reload(), 1000);
        } else {
            showToast(data.error || 'Ошибка', 'error');
        }
    } catch (e) {
        showToast('Ошибка сети', 'error');
    }
}

async function dangerResetAll() {
    if (!confirm('ВНИМАНИЕ! Будут удалены ВСЕ данные:\n\n• База данных (чеки, кэш, услуги)\n• Подключения (ЮКасса, налоговая)\n• Авторизация\n• Настройки интерфейса, фильтры, таймеры\n\nПриложение вернётся к состоянию первого запуска.\n\nЭто действие НЕОБРАТИМО!')) return;
    if (!confirm('Последнее предупреждение: СБРОСИТЬ ВСЁ?')) return;
    try {
        const res = await fetch('/api/danger/reset-all', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            // Очищаем всё из localStorage
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                keysToRemove.push(localStorage.key(i));
            }
            keysToRemove.forEach(k => localStorage.removeItem(k));
            showToast('Все данные сброшены. Перезагрузка...', 'success');
            setTimeout(() => location.reload(), 1500);
        } else {
            showToast(data.error || 'Ошибка', 'error');
        }
    } catch (e) {
        showToast('Ошибка сети', 'error');
    }
}

// ==================== SETUP ====================

document.getElementById('setupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const config = Object.fromEntries(formData);
    
    try {
        const res = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
        const data = await res.json();
        if (data.success) {
            showToast('Настройки сохранены!', 'success');
            await checkConfig();
        } else {
            showToast(data.error || 'Ошибка сохранения', 'error');
        }
    } catch (e) {
        showToast('Ошибка сети', 'error');
    }
});
