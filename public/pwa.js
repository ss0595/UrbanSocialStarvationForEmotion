const INSTALL_BANNER_DISMISSED_KEY = 'uss_install_banner_dismissed';
const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);
let deferredInstallPrompt = null;
let installBanner = null;

function isStandaloneMode() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isLocalDevelopmentHost() {
    return LOCALHOST_HOSTS.has(window.location.hostname);
}

function isIosSafari() {
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIosDevice = /iphone|ipad|ipod/.test(userAgent);
    const isSafariBrowser = /safari/.test(userAgent) && !/crios|fxios|edgios|chrome|android/.test(userAgent);
    return isIosDevice && isSafariBrowser;
}

function dismissInstallBanner(persist = true) {
    if (persist) {
        localStorage.setItem(INSTALL_BANNER_DISMISSED_KEY, '1');
    }

    if (installBanner) {
        installBanner.remove();
        installBanner = null;
    }
}

function createInstallBanner(message, primaryLabel, primaryAction) {
    dismissInstallBanner(false);

    const banner = document.createElement('aside');
    banner.className = 'install-banner is-visible';
    banner.setAttribute('role', 'status');
    banner.innerHTML = `
        <p>${message}</p>
        <div class="banner-actions">
            ${primaryLabel ? `<button type="button" class="btn-primary" data-install-action="primary">${primaryLabel}</button>` : ''}
            <button type="button" class="btn-secondary" data-install-action="dismiss">Not now</button>
        </div>
    `;

    banner.querySelector('[data-install-action="dismiss"]').addEventListener('click', () => {
        dismissInstallBanner(true);
    });

    const primaryButton = banner.querySelector('[data-install-action="primary"]');
    if (primaryButton && typeof primaryAction === 'function') {
        primaryButton.addEventListener('click', primaryAction);
    }

    document.body.appendChild(banner);
    installBanner = banner;
}

async function promptInstall() {
    if (!deferredInstallPrompt) {
        return;
    }

    try {
        await deferredInstallPrompt.prompt();
        const choiceResult = await deferredInstallPrompt.userChoice;
        if (choiceResult?.outcome === 'accepted') {
            dismissInstallBanner(false);
        }
    } catch (error) {
        console.error('Install prompt failed', error);
    } finally {
        deferredInstallPrompt = null;
    }
}

function maybeShowIosInstallHint() {
    if (isStandaloneMode() || !isIosSafari()) {
        return;
    }

    if (localStorage.getItem(INSTALL_BANNER_DISMISSED_KEY)) {
        return;
    }

    createInstallBanner('Add this app to your home screen from Safari using Share, then Add to Home Screen.', null, null);
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
        if (isLocalDevelopmentHost()) {
            try {
                const registrations = await navigator.serviceWorker.getRegistrations();
                await Promise.all(registrations.map((registration) => registration.unregister()));

                if ('caches' in window) {
                    const cacheKeys = await caches.keys();
                    await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey)));
                }
            } catch (error) {
                console.error('Failed to clean up local service workers', error);
            }
            return;
        }

        navigator.serviceWorker.register('/sw.js').catch((error) => {
            console.error('Service worker registration failed', error);
        });
    });
}

window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;

    if (isStandaloneMode() || localStorage.getItem(INSTALL_BANNER_DISMISSED_KEY)) {
        return;
    }

    createInstallBanner('Install Urban Social Starvation for a cleaner full-screen experience on this device.', 'Install App', promptInstall);
});

window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    localStorage.removeItem(INSTALL_BANNER_DISMISSED_KEY);
    dismissInstallBanner(false);
});

window.addEventListener('DOMContentLoaded', () => {
    if (isLocalDevelopmentHost()) {
        return;
    }

    maybeShowIosInstallHint();
});
