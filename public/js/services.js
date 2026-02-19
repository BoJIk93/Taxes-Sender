// ==================== SERVICE NAMES ====================

async function loadServiceNames() {
    try {
        const res = await fetch('/api/service-names');
        const data = await res.json();
        
        if (data.success) {
            serviceNames = data.service_names || [];
            renderServicesModalList();
            updateServiceNameSelects();
            updateServicesBadge();
        }
    } catch (e) {
        console.error('Error loading service names:', e);
    }
}

function updateServicesBadge() {
    const badge = document.getElementById('servicesBadge');
    if (!badge) return;
    
    if (serviceNames.length > 0) {
        badge.textContent = serviceNames.length;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function renderServicesModalList() {
    const container = document.getElementById('servicesModalList');
    const clearBtn = document.getElementById('servicesModalClearBtn');
    if (!container) return;
    
    if (clearBtn) clearBtn.classList.toggle('hidden', serviceNames.length === 0);
    
    if (serviceNames.length === 0) {
        container.innerHTML = '';
        return;
    }
    
    container.innerHTML = serviceNames.map(name => `
        <div class="service-modal-item">
            <span class="service-modal-item-text">${escapeHtml(name)}</span>
            <button class="delete-btn" onclick="deleteServiceName('${escapeHtml(name).replace(/'/g, "\\'")}')">Удалить</button>
        </div>
    `).join('');
}

function updateServiceNameSelects() {
    // Обновляем datalist для автозаполнения
    const datalist = document.getElementById('serviceNamesList');
    if (datalist) {
        datalist.innerHTML = serviceNames.map(n => `<option value="${escapeHtml(n)}">`).join('');
    }
    
    // Random settings list
    const checkboxList = document.getElementById('randomServiceNamesList');
    if (checkboxList) {
        checkboxList.innerHTML = serviceNames.map(n => `
            <label>
                <input type="checkbox" value="${escapeHtml(n)}" ${randomSettings.serviceName.names.includes(n) ? 'checked' : ''}>
                ${escapeHtml(n)}
            </label>
        `).join('');
    }
    
    // Service name filter list
    const filterList = document.getElementById('serviceNameFilterList');
    if (filterList) {
        const selectedServices = getSelectedServiceFilters();
        filterList.innerHTML = serviceNames.map(n => `
            <label>
                <input type="checkbox" class="service-filter-checkbox" value="${escapeHtml(n)}" ${selectedServices.includes(n) ? 'checked' : ''}>
                ${escapeHtml(n)}
            </label>
        `).join('');
    }
}

function openServicesModal() {
    document.getElementById('servicesModalInput').value = '';
    renderServicesModalList();
    openModal('servicesModal');
}

function openAddServiceName() {
    document.getElementById('newServiceNameInput').value = '';
    openModal('addServiceNameModal');
}

async function addServiceByName(name, opts) {
    opts = opts || {};
    if (!name) {
        showToast('Введите наименование', 'warning');
        return false;
    }
    try {
        const res = await fetch('/api/service-names', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        const data = await res.json();
        if (data.success) {
            serviceNames = data.service_names;
            renderServicesModalList();
            updateServiceNameSelects();
            updateServicesBadge();
            showToast('Наименование добавлено', 'success');
            return true;
        } else {
            showToast(data.error || 'Ошибка', 'error');
            return false;
        }
    } catch (e) {
        showToast('Ошибка сети', 'error');
        return false;
    }
}

async function addServiceFromModal() {
    const input = document.getElementById('servicesModalInput');
    const name = input.value.trim();
    const ok = await addServiceByName(name);
    if (ok && input) input.value = '';
}

async function addServiceName() {
    const name = document.getElementById('newServiceNameInput').value.trim();
    const ok = await addServiceByName(name);
    if (ok) closeModal('addServiceNameModal');
}

async function deleteServiceName(name) {
    if (!confirm(`Удалить "${name}"?`)) return;
    
    try {
        const res = await fetch(`/api/service-names/${encodeURIComponent(name)}`, { method: 'DELETE' });
        const data = await res.json();
        
        if (data.success) {
            serviceNames = data.service_names;
            renderServicesModalList();
            updateServiceNameSelects();
            updateServicesBadge();
            showToast('Удалено', 'success');
        }
    } catch (e) {
        showToast('Ошибка', 'error');
    }
}

async function clearAllServiceNames() {
    if (!confirm('Очистить весь список услуг? Останется только то, что вы добавите вручную.')) return;
    
    try {
        const res = await fetch('/api/service-names/clear', { method: 'POST' });
        const data = await res.json();
        
        if (data.success) {
            serviceNames = data.service_names || [];
            renderServicesModalList();
            updateServiceNameSelects();
            updateServicesBadge();
            showToast('Список услуг очищен', 'success');
        } else {
            showToast(data.error || 'Ошибка', 'error');
        }
    } catch (e) {
        showToast('Ошибка сети', 'error');
    }
}
