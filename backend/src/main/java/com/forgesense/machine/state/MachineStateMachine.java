package com.forgesense.machine.state;

import com.forgesense.machine.domain.MachineState;

import java.util.EnumMap;
import java.util.Map;
import java.util.Set;

/**
 * Authoritative machine state machine. The backend owns transition rules; the
 * UI only renders the state.
 *
 * Transitions:
 *   NORMAL     → DEGRADED | MAINTENANCE | OFFLINE
 *   DEGRADED   → NORMAL | WARNING | MAINTENANCE | OFFLINE
 *   WARNING    → DEGRADED | CRITICAL | MAINTENANCE | OFFLINE
 *   CRITICAL   → WARNING | MAINTENANCE | OFFLINE | RECOVERING
 *   MAINTENANCE→ RECOVERING
 *   RECOVERING → NORMAL | MAINTENANCE
 *   OFFLINE    → RECOVERING
 */
public final class MachineStateMachine {

    private static final Map<MachineState, Set<MachineState>> ALLOWED = new EnumMap<>(MachineState.class);

    static {
        ALLOWED.put(MachineState.NORMAL, Set.of(MachineState.DEGRADED, MachineState.MAINTENANCE, MachineState.OFFLINE));
        ALLOWED.put(MachineState.DEGRADED, Set.of(MachineState.NORMAL, MachineState.WARNING, MachineState.MAINTENANCE, MachineState.OFFLINE));
        ALLOWED.put(MachineState.WARNING, Set.of(MachineState.DEGRADED, MachineState.CRITICAL, MachineState.MAINTENANCE, MachineState.OFFLINE));
        ALLOWED.put(MachineState.CRITICAL, Set.of(MachineState.WARNING, MachineState.MAINTENANCE, MachineState.OFFLINE, MachineState.RECOVERING));
        ALLOWED.put(MachineState.MAINTENANCE, Set.of(MachineState.RECOVERING));
        ALLOWED.put(MachineState.RECOVERING, Set.of(MachineState.NORMAL, MachineState.MAINTENANCE));
        ALLOWED.put(MachineState.OFFLINE, Set.of(MachineState.RECOVERING));
    }

    private MachineStateMachine() {
    }

    public static boolean canTransition(MachineState from, MachineState to) {
        return ALLOWED.getOrDefault(from, Set.of()).contains(to);
    }

    public static MachineState apply(MachineState from, MachineState to) {
        if (!canTransition(from, to)) {
            throw new IllegalStateException("Illegal machine state transition: " + from + " -> " + to +
                    " rejected by state machine");
        }
        return to;
    }
}