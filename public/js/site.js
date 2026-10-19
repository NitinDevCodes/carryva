(() => {
    const updateCartCount = async () => {
        const badge = document.getElementById('cart-count');
        if (!badge) return;
        try {
            const response = await fetch('/cart/count', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
            if (!response.ok || !(response.headers.get('content-type') || '').includes('application/json')) return;
            const data = await response.json();
            const count = Number(data.count);
            if (Number.isFinite(count) && count >= 0) badge.textContent = String(count);
        } catch (_) {
            // Navigation remains usable if the cart count endpoint is unavailable.
        }
    };

    document.addEventListener('click', (event) => {
        const thumbnail = event.target.closest('[data-gallery-src]');
        if (!thumbnail) return;
        const mainImage = document.getElementById('primary-product-image');
        if (!mainImage) return;
        mainImage.src = thumbnail.dataset.gallerySrc;
        mainImage.alt = thumbnail.dataset.galleryAlt || '';
        thumbnail.closest('[role="group"]')?.querySelectorAll('[data-gallery-src]').forEach((button) => {
            const active = button === thumbnail;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', String(active));
        });
    });

    document.addEventListener('change', (event) => {
        if (event.target.matches('[data-auto-submit]')) event.target.form?.requestSubmit();
    });

    document.addEventListener('submit', (event) => {
        const message = event.target.dataset.confirm;
        if (message && !window.confirm(message)) event.preventDefault();
    });

    updateCartCount();
})();
