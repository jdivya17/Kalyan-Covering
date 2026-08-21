import { KC } from '../store/state.js';

export const Toast = {
    container: null,
    init() {
        this.container = document.getElementById('toast-container');
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'toast-container';
            this.container.className = 'toast-container';
            document.body.appendChild(this.container);
        }
    },
    show(title, msg = '', icon = '✨', duration = 3500) {
        if (!this.container) this.init();
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerHTML = `
      <span class="toast-icon">${icon}</span>
      <div class="toast-body">
        <div class="toast-title">${title}</div>
        ${msg ? `<div class="toast-msg">${msg}</div>` : ''}
      </div>
      <button onclick="this.parentElement.remove()" style="background:none;border:none;color:#666;cursor:pointer;font-size:1.1rem;margin-left:0.5rem">×</button>
    `;
        this.container.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('out');
            setTimeout(() => toast.remove(), 400);
        }, duration);
        return toast;
    },
    success(msg, submsg = '') { return this.show(msg, submsg, '🌟'); },
    error(msg, submsg = '') { return this.show(msg, submsg, '❌'); },
    info(msg, submsg = '') { return this.show(msg, submsg, '💛'); },
    cart(name) { return this.show('Added to Cart!', name, '🛒'); }
};

window.Toast = Toast;
