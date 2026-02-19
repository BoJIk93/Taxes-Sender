// ==================== STATE ====================
let payments = [];
let allPaymentsRaw = []; // Исходные данные с сервера (без фильтров)
let serviceNames = [];
let selectedPayments = new Set();
let currentPaymentForReceipt = null;
let currentReceiptForCancel = null;
let originalServiceName = null; // Оригинальное название услуги (из ЮКассы или выбранное из списка)
let randomSettings = {
    serviceName: { enabled: false, names: [] },
    date: { enabled: false, from: null, to: null },
    price: { enabled: false, from: null, to: null }
};

// Pagination state
let currentPage = 1;
let groupsPerPage = 10;
let totalPages = 1;
let allGroupedPayments = {};
let groupPagination = {}; // Пагинация для каждой группы

// Защита от повторной отправки одного чека: id платежей, по которым идёт запрос в налоговую
let paymentsSendingInProgress = new Set();

function tryAcquireSendLock(paymentId) {
    if (paymentsSendingInProgress.has(paymentId)) return false;
    paymentsSendingInProgress.add(paymentId);
    return true;
}

function releaseSendLock(paymentId) {
    paymentsSendingInProgress.delete(paymentId);
}

// Auto sync state
let autoSyncEnabled = false;
let autoSyncInterval = 30;
let autoSyncTimer = null;
let isSyncing = false;

// Auto-send: при поступлении новых платежей с ЮКассы автоматически отправлять в налоговую
const AUTO_SEND_STORAGE_KEY = 'taxesSenderAutoSend';
let autoSendSettings = {
    enabled: false,
    useYookassaData: true,
    onlyNew: true,
    random: {
        serviceName: { enabled: false, names: [] },
        date: { enabled: false, from: null, to: null },
        price: { enabled: false, from: null, to: null }
    }
};

function loadAutoSendSettings() {
    try {
        const raw = localStorage.getItem(AUTO_SEND_STORAGE_KEY);
        if (raw) {
            const saved = JSON.parse(raw);
            if (saved && typeof saved.enabled === 'boolean') {
                autoSendSettings.enabled = saved.enabled;
                autoSendSettings.useYookassaData = saved.useYookassaData !== false;
                autoSendSettings.onlyNew = saved.onlyNew !== false;
                if (saved.random) {
                    autoSendSettings.random.serviceName = { ...autoSendSettings.random.serviceName, ...saved.random.serviceName };
                    autoSendSettings.random.date = { ...autoSendSettings.random.date, ...saved.random.date };
                    autoSendSettings.random.price = { ...autoSendSettings.random.price, ...saved.random.price };
                }
            }
        }
    } catch (e) {}
}

function saveAutoSendSettings() {
    localStorage.setItem(AUTO_SEND_STORAGE_KEY, JSON.stringify(autoSendSettings));
}
