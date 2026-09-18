const views = new Map();
let activeRoute = null;
let handlers = [];

export function register(name, view) {
  views.set(name, { name, view, host: null, mounted: false });
}

export function current() {
  return activeRoute ? activeRoute.view : null;
}

export function onRoute(fn) {
  handlers.push(fn);
}

let navigating = false;
let justGo = false;

export function go(name) {
  const route = views.get(name);
  if (!route) return false;
  const host = document.getElementById('view-' + name);
  if (!host) return false;
  if (activeRoute === route && window.location.hash === '#/' + name) {
    if (route.view.activate) route.view.activate();
    return true;
  }
  if (activeRoute && activeRoute !== route) {
    if (activeRoute.view.unmount) activeRoute.view.unmount();
    activeRoute.host && activeRoute.host.classList.remove('active');
  }
  navigating = true;
  route.host = host;
  if (!route.mounted) {
    route.view.mount(host);
    route.mounted = true;
  }
  activeRoute = route;
  host.classList.add('active');
  const railBtn = document.querySelector('.rail-btn[data-route="' + name + '"]');
  document.querySelectorAll('.rail-btn[data-route]').forEach(b => b.classList.toggle('active', b === railBtn));
  if (window.location.hash !== '#/' + name) {
    justGo = true;
    window.location.hash = '#/' + name;
    setTimeout(() => { justGo = false; }, 0);
  }
  navigating = false;
  if (route.view.activate) route.view.activate();
  return true;
}

export function matchHash(hash) {
  const name = String(hash || '').replace(/^#\/?/, '').split(/[?&]/)[0].toLowerCase();
  return views.has(name) ? name : null;
}

export function boot(defaultRoute, allowed = Array.from(views.keys())) {
  const apply = () => {
    if (navigating || justGo) return;
    const name = matchHash(window.location.hash) || defaultRoute;
    if (views.has(name) && allowed.includes(name)) go(name);
    else go(defaultRoute);
  };
  window.addEventListener('hashchange', apply);
  bindRail();
  apply();
  return current();
}

export function bindRail() {
  document.querySelectorAll('.rail-btn[data-route]').forEach(btn => {
    btn.addEventListener('click', () => go(btn.dataset.route));
  });
  document.querySelectorAll('[data-action]').forEach(btn => {
    if (btn.dataset.action === 'shortcuts') {
      btn.addEventListener('click', () => notifyHandlers('shortcuts'));
    }
  });
  const inspToggle = document.getElementById('inspToggle');
  if (inspToggle) {
    inspToggle.addEventListener('click', () => notifyHandlers('inspector-toggle'));
  }
  const cmdBtn = document.getElementById('cmdBtn');
  if (cmdBtn) {
    cmdBtn.addEventListener('click', () => notifyHandlers('palette'));
  }
  const inspClose = document.getElementById('inspClose');
  if (inspClose) {
    inspClose.addEventListener('click', () => notifyHandlers('inspector-close'));
  }
  const fitBtn = document.getElementById('fitBtn');
  if (fitBtn) {
    fitBtn.addEventListener('click', () => notifyHandlers('camera-reset'));
  }
  const topBtn = document.getElementById('topBtn');
  if (topBtn) {
    topBtn.addEventListener('click', () => notifyHandlers('camera-top'));
  }
  const riskBtn = document.getElementById('riskBtn');
  if (riskBtn) {
    riskBtn.addEventListener('click', () => notifyHandlers('risk-mode-toggle'));
  }
  const mobileNavToggle = document.getElementById('mobileNavToggle');
  const primaryNav = document.getElementById('primaryNav');
  if (mobileNavToggle && primaryNav) {
    mobileNavToggle.addEventListener('click', () => {
      const open = primaryNav.classList.toggle('mobile-open');
      mobileNavToggle.setAttribute('aria-expanded', String(open));
      mobileNavToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    });
    primaryNav.addEventListener('click', e => {
      if (e.target.closest('.rail-btn')) {
        primaryNav.classList.remove('mobile-open');
        mobileNavToggle.setAttribute('aria-expanded', 'false');
        mobileNavToggle.setAttribute('aria-label', 'Open navigation');
      }
    });
  }
  const zoneHost = document.getElementById('zoneChips');
  if (zoneHost) {
    zoneHost.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip[data-zone]');
      if (chip) notifyHandlers('zone-filter', chip.dataset.zone);
    });
  }
  const fitHost = document.getElementById('factoryHud');
  if (fitHost) {
    fitHost.addEventListener('click', (e) => {
      if (e.target.closest('[data-zone-link]')) {
        const code = e.target.closest('[data-zone-link]').dataset.zoneLink;
        go('factory');
        notifyHandlers('zone-focus', code);
      }
    });
  }
  const sceneHost = document.getElementById('sceneContainer');
  if (sceneHost) {
    sceneHost.addEventListener('dblclick', (e) => notifyHandlers('scene-dblclick', e));
  }
}

function notifyHandlers(type, payload) {
  for (const fn of handlers) fn({ type, payload });
}
