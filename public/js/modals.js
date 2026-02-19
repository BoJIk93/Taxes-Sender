// ==================== MODALS ====================

function openModal(id) {
    const modalEl = document.getElementById(id);
    if (modalEl) {
        // Use Bootstrap 5.3 Modal API
        const bsModal = new bootstrap.Modal(modalEl);
        bsModal.show();
    }
}

function closeModal(id) {
    const modalEl = document.getElementById(id);
    if (modalEl) {
        // Use Bootstrap 5.3 Modal API
        const bsModal = bootstrap.Modal.getInstance(modalEl);
        if (bsModal) {
            bsModal.hide();
        }
    }
}
