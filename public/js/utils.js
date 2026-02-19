// ==================== UTILITIES ====================

// Глобальный перехват 401 — если авторизация требуется, показываем экран входа
window._authInterceptSuppressed = false;
(function() {
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);
        if (response.status === 401 && !window._authInterceptSuppressed) {
            const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
            // Не перехватываем запросы на auth-эндпоинты
            if (!url.includes('/api/auth/')) {
                try {
                    const clone = response.clone();
                    const data = await clone.json();
                    if (data.authRequired && typeof showAuthOverlay === 'function') {
                        showAuthOverlay();
                    }
                } catch (e) {}
            }
        }
        return response;
    };
})();

function formatCurrency(amount) {
    return new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    }).format(amount);
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
}

function formatDateTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    
    // Map type to Bootstrap classes
    const typeMap = {
        success: { icon: 'bi-check-circle-fill', class: 'text-success', toastClass: 'toast-success' },
        error: { icon: 'bi-x-circle-fill', class: 'text-danger', toastClass: 'toast-error' },
        warning: { icon: 'bi-exclamation-triangle-fill', class: 'text-warning', toastClass: 'toast-warning' },
        info: { icon: 'bi-info-circle-fill', class: 'text-info', toastClass: 'toast-info' }
    };
    
    const toastType = typeMap[type] || typeMap.info;
    
    const toastEl = document.createElement('div');
    toastEl.className = `toast ${toastType.toastClass}`;
    toastEl.setAttribute('role', 'alert');
    toastEl.setAttribute('aria-live', 'assertive');
    toastEl.setAttribute('aria-atomic', 'true');
    
    toastEl.innerHTML = `
        <div class="toast-header">
            <i class="bi ${toastType.icon} ${toastType.class} me-2"></i>
            <strong class="me-auto">${type === 'success' ? 'Успешно' : type === 'error' ? 'Ошибка' : type === 'warning' ? 'Внимание' : 'Информация'}</strong>
            <button type="button" class="btn-close" data-bs-dismiss="toast"></button>
        </div>
        <div class="toast-body">
            ${escapeHtml(message)}
        </div>
    `;
    
    container.appendChild(toastEl);
    
    const isMobile = window.innerWidth <= 768;
    const bsToast = new bootstrap.Toast(toastEl, {
        autohide: true,
        delay: isMobile ? 3500 : 4000
    });
    
    bsToast.show();
    
    // Remove from DOM after hidden
    toastEl.addEventListener('hidden.bs.toast', () => {
        toastEl.remove();
    });
}

// ==================== THEME SWITCHING ====================

function toggleTheme() {
    const html = document.documentElement;
    const currentTheme = html.getAttribute('data-bs-theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    html.setAttribute('data-bs-theme', newTheme);
    
    // Save preference to localStorage
    localStorage.setItem('theme', newTheme);
}

// Load saved theme on page load
function loadTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-bs-theme', savedTheme);
}

// Initialize theme on DOM load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadTheme);
} else {
    loadTheme();
}

function copyToClipboard(text, successMessage = 'Скопировано!') {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showToast(successMessage, 'success');
        }).catch(err => {
            // Fallback для старых браузеров
            fallbackCopyToClipboard(text, successMessage);
        });
    } else {
        // Fallback для старых браузеров
        fallbackCopyToClipboard(text, successMessage);
    }
}

function fallbackCopyToClipboard(text, successMessage) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
        document.execCommand('copy');
        showToast(successMessage, 'success');
    } catch (err) {
        showToast('Ошибка копирования', 'error');
    }
    
    document.body.removeChild(textArea);
}

function toMoscowTime(date) {
    const utcDate = new Date(date);
    const moscowOffset = 3 * 60;
    const localOffset = utcDate.getTimezoneOffset();
    return new Date(utcDate.getTime() + (moscowOffset + localOffset) * 60000);
}

function toDatetimeLocal(date) {
    const d = date instanceof Date ? date : new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

/** Границы вьюпорта с отступом (для умного позиционирования меню) */
function getViewportBounds(pad) {
    if (pad === undefined) pad = 8;
    return {
        top: pad,
        bottom: window.innerHeight - pad,
        left: pad,
        right: window.innerWidth - pad
    };
}

function formatGroupKey(key, type) {
    if (type === 'month') {
        const [year, month] = key.split('-');
        const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
        return `${months[parseInt(month) - 1]} ${year}`;
    } else if (type === 'quarter') {
        const [year, quarter] = key.split('-Q');
        return `${quarter} квартал ${year}`;
    } else if (type === 'week') {
        // Ключ формата "2024-01-15_2024-01-21" (начало_конец)
        const [startStr, endStr] = key.split('_');
        const startDate = new Date(startStr);
        const endDate = new Date(endStr);
        
        const formatShortDate = (d) => {
            return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
        };
        
        return `${formatShortDate(startDate)} — ${formatShortDate(endDate)}`;
    } else if (type === 'year') {
        return `${key} год`;
    }
    return formatDate(key);
}

function groupPayments(list, type) {
    const groups = {};
    list.forEach(p => {
        const date = new Date(p.paid_at || p.created_at);
        let key;
        
        if (type === 'day') {
            // Используем локальную дату, а не UTC
            key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        } else if (type === 'week') {
            const startOfWeek = new Date(date);
            startOfWeek.setDate(date.getDate() - date.getDay() + 1);
            
            const endOfWeek = new Date(startOfWeek);
            endOfWeek.setDate(startOfWeek.getDate() + 6);
            
            // Создаем ключ с диапазоном: "начало_конец"
            const startStr = `${startOfWeek.getFullYear()}-${String(startOfWeek.getMonth() + 1).padStart(2, '0')}-${String(startOfWeek.getDate()).padStart(2, '0')}`;
            const endStr = `${endOfWeek.getFullYear()}-${String(endOfWeek.getMonth() + 1).padStart(2, '0')}-${String(endOfWeek.getDate()).padStart(2, '0')}`;
            key = `${startStr}_${endStr}`;
        } else if (type === 'month') {
            key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        } else if (type === 'quarter') {
            const quarter = Math.floor(date.getMonth() / 3) + 1;
            key = `${date.getFullYear()}-Q${quarter}`;
        } else if (type === 'year') {
            key = `${date.getFullYear()}`;
        }
        
        if (!groups[key]) groups[key] = [];
        groups[key].push(p);
    });
    return groups;
}
