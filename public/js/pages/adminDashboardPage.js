/**
 * ║  adminDashboardPage.js – Kalyan Covering
 * ║  Admin dashboard module helper
 */
export function initAdminDashboardPage() {
    console.log('Admin Dashboard module initialized.');
}

export function formatAdminOrderBadge(status) {
    const s = (status || 'pending').toLowerCase();
    const badges = {
        paid: 'badge-success',
        delivered: 'badge-success',
        shipped: 'badge-info',
        pending: 'badge-warning',
        cancelled: 'badge-danger'
    };
    return badges[s] || 'badge-secondary';
}
