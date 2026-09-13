package com.forgesense.machine.state;

import com.forgesense.machine.domain.MachineState;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.EnumMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Authoritative machine state machine. The backend owns transition rules; the
 * UI only renders the state.
 *
 * Transitions:
 *   NORMAL     -> DEGRADED | MAINTENANCE | OFFLINE
 *   DEGRADED   -> NORMAL | WARNING | MAINTENANCE | OFFLINE
 *   WARNING    -> DEGRADED | CRITICAL | MAINTENANCE | OFFLINE
 *   CRITICAL   -> WARNING | MAINTENANCE | OFFLINE | RECOVERING
 *   MAINTENANCE-> RECOVERING
 *   RECOVERING -> NORMAL | MAINTENANCE
 *   OFFLINE    -> RECOVERING
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

    /**
     * Return the next hop on a shortest legal path from {@code from} to
     * {@code target}. A machine cannot skip states (NORMAL -> CRITICAL is not
     * a legal edge), so risk escalation walks DEGRADED -> WARNING -> CRITICAL
     * one sample at a time.
     *
     * @param from  current state
     * @param target desired state
     * @return the first state after {@code from} on a minimal legal path
     * @throws IllegalStateException if the target is unreachable
     */
    public static MachineState walk(MachineState from, MachineState target) {
        if (from == target) {
            return target;
        }
        Map<MachineState, MachineState> cameFrom = new EnumMap<>(MachineState.class);
        Deque<MachineState> queue = new ArrayDeque<>();
        Set<MachineState> seen = new HashSet<>();
        queue.addLast(from);
        seen.add(from);
        while (!queue.isEmpty()) {
            MachineState cur = queue.removeFirst();
            for (MachineState next : ALLOWED.getOrDefault(cur, Set.of())) {
                if (next == target) {
                    cameFrom.put(target, cur);
                    List<MachineState> rev = new ArrayList<>();
                    MachineState step = target;
                    rev.add(step);
                    while (step != from) {
                        step = cameFrom.get(step);
                        rev.add(step);
                    }
                    return rev.get(rev.size() - 2);
                }
                if (seen.add(next)) {
                    cameFrom.put(next, cur);
                    queue.addLast(next);
                }
            }
        }
        throw new IllegalStateException("No legal path from " + from + " -> " + target);
    }
}