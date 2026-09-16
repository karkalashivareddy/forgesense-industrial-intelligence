const views = {};
let activeView = null;
let handlers = [];

export function register(name, view) {
  views[name] = view;
}

export function current() {
  return activeView;
}

export function onRoute(fn) {
  handlers.push(fn);
}

let navigating = false;

export function go(name) {
  const v = views[name];
  if (!v) return false;
  if (activeView === v && window.location.hash === '#/' + name) {
    if (v.activate) v.activate();
    return true;
  }
  if (activeView && activeView !== v) {
    if (activeView.unmount) activeView.unmount();
    activeView.el && activeView.el.classList.remove('active');
  }
  navigating = true;
  activeView = v;
  const host = document.getElementById('view-' + name);
  v.el = host;
  if (!v.mounted) {
    v.mount(host);
    v.mounted = true;
  }
  host.classList.add('active');
  const railBtn = document.querySelector('.rail-btn[data-route="' + name + '"]');
  document.querySelectorAll('.rail-btn[data-route]').forEach(b => b.classList.toggle('active', b === railBtn));
  window.location.hash = '#/' + name;
  navigating = false;
  if (v.activate) v.activate();
  return true;
}

export function matchHash(hash) {
  const name = String(hash || '').replace(/^#\/?/, '').split(/[?&]/)[0].toLowerCase();
  return views[name] ? name : null;
}

export function boot(defaultRoute, allowed = Object.keys(views)) {
  const apply = () => {
    if (navigating) return;
    const name = matchHash(window.location.hash) || defaultRoute;
    if (views[name] && allowed.includes(name)) go(name);
    else go(defaultRoute);
  };
  window.addEventListener('hashchange', apply);
  bindRail();
  apply();
  return activeView;
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