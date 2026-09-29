/**
 * Command palette (Ctrl+K).
 *
 * Searches routes and machines, and can jump straight to an asset's
 * prediction or maintenance context. Keyboard-first: arrow keys move the
 * active option, Enter runs it, Escape closes.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { CornerDownLeft, Search } from 'lucide-react';
import { useUiStore } from '../store/ui';
import { useMachines } from '../api/queries';
import { ALL_NAV_ITEMS } from '../app/routes';
import { deriveOperationalState } from '../domain/machineState';
import { useFocusTrapRef } from '../hooks/useFocusTrap';

interface Command {
  id: string;
  label: string;
  group: string;
  icon: React.ReactNode;
  run(): void;
}

export function CommandPalette() {
  const open = useUiStore((state) => state.commandPaletteOpen);
  const setOpen = useUiStore((state) => state.setCommandPaletteOpen);
  const openInspector = useUiStore((state) => state.openInspector);
  const navigate = useNavigate();
  const machines = useMachines();

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useFocusTrapRef(open, () => setOpen(false));

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const routes: Command[] = ALL_NAV_ITEMS.map((item) => ({
      id: `route:${item.id}`,
      label: item.label,
      group: 'Go to',
      icon: <item.icon size={15} aria-hidden />,
      run: () => navigate(item.path),
    }));

    const assets: Command[] = (machines.data ?? []).map((machine) => {
      const derived = deriveOperationalState(machine);
      return {
        id: `machine:${machine.machineId}`,
        label: `${machine.machineId} · ${machine.name} · ${derived.descriptor.label}`,
        group: 'Assets',
        icon: <span className="twin__dot" data-tone={derived.descriptor.tone} aria-hidden />,
        run: () => {
          openInspector(machine.machineId, 'overview');
          navigate('/fleet');
        },
      };
    });

    return [...routes, ...assets];
  }, [machines.data, navigate, openInspector]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands.slice(0, 40);
    return commands
      .filter((command) => command.label.toLowerCase().includes(needle))
      .slice(0, 40);
  }, [commands, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!open) return null;

  const runActive = () => {
    const command = filtered[activeIndex];
    if (!command) return;
    command.run();
    setOpen(false);
  };

  return createPortal(
    <div className="palette-root">
      <div className="palette__scrim" onClick={() => setOpen(false)} aria-hidden />
      <div
        ref={containerRef}
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((index) => (index + 1) % Math.max(filtered.length, 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((index) => (index - 1 + filtered.length) % Math.max(filtered.length, 1));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            runActive();
          }
        }}
      >
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search
            size={15}
            aria-hidden
            style={{ position: 'absolute', left: 14, color: 'var(--text-faint)', pointerEvents: 'none' }}
          />
          <input
            className="palette__input"
            style={{ paddingLeft: 38 }}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search workspaces and assets…"
            aria-label="Search workspaces and assets"
            aria-controls="palette-listbox"
            role="combobox"
            aria-expanded
            autoComplete="off"
            spellCheck={false}
            ref={(node) => node?.focus()}
          />
        </div>

        <ul className="palette__list" id="palette-listbox" role="listbox" aria-label="Results">
          {filtered.length === 0 ? (
            <li className="empty-inline">No matches for “{query}”.</li>
          ) : (
            filtered.map((command, index) => (
              <li key={command.id} role="presentation">
                <button
                  type="button"
                  className="palette__item"
                  role="option"
                  aria-selected={index === activeIndex}
                  data-active={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => {
                    command.run();
                    setOpen(false);
                  }}
                >
                  {command.icon}
                  <span className="truncate">{command.label}</span>
                  <span className="palette__item-group">{command.group}</span>
                </button>
              </li>
            ))
          )}
        </ul>

        <footer className="palette__footer">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>
              <CornerDownLeft size={9} />
            </kbd>{' '}
            open
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
