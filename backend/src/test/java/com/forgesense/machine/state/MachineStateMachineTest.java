package com.forgesense.machine.state;

import com.forgesense.machine.domain.MachineState;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class MachineStateMachineTest {

    @Test
    void normal_goesToDegradedMaintenanceOffline() {
        assertThat(MachineStateMachine.canTransition(MachineState.NORMAL, MachineState.DEGRADED)).isTrue();
        assertThat(MachineStateMachine.canTransition(MachineState.NORMAL, MachineState.MAINTENANCE)).isTrue();
        assertThat(MachineStateMachine.canTransition(MachineState.NORMAL, MachineState.OFFLINE)).isTrue();
    }

    @Test
    void degradingEscalationPathIsAllowed_andDeescalation() {
        assertThat(MachineStateMachine.canTransition(MachineState.DEGRADED, MachineState.WARNING)).isTrue();
        assertThat(MachineStateMachine.canTransition(MachineState.WARNING, MachineState.CRITICAL)).isTrue();
        assertThat(MachineStateMachine.canTransition(MachineState.CRITICAL, MachineState.RECOVERING)).isTrue();
        assertThat(MachineStateMachine.canTransition(MachineState.RECOVERING, MachineState.NORMAL)).isTrue();
    }

    @Test
    void skipsAndIllegalJumpsAreRejected() {
        // NORMAL -> CRITICAL skips WARNING
        assertThat(MachineStateMachine.canTransition(MachineState.NORMAL, MachineState.CRITICAL)).isFalse();
        // NORMAL -> RECOVERING
        assertThat(MachineStateMachine.canTransition(MachineState.NORMAL, MachineState.RECOVERING)).isFalse();
        // CRITICAL -> NORMAL
        assertThat(MachineStateMachine.canTransition(MachineState.CRITICAL, MachineState.NORMAL)).isFalse();
        // OFFLINE -> NORMAL directly
        assertThat(MachineStateMachine.canTransition(MachineState.OFFLINE, MachineState.NORMAL)).isFalse();
        // MAINTENANCE -> CRITICAL
        assertThat(MachineStateMachine.canTransition(MachineState.MAINTENANCE, MachineState.CRITICAL)).isFalse();
    }

    @Test
    void offline_onlyRecovers() {
        assertThat(MachineStateMachine.canTransition(MachineState.OFFLINE, MachineState.RECOVERING)).isTrue();
        assertThat(MachineStateMachine.canTransition(MachineState.OFFLINE, MachineState.DEGRADED)).isFalse();
        assertThat(MachineStateMachine.canTransition(MachineState.OFFLINE, MachineState.MAINTENANCE)).isFalse();
    }

    @Test
    void apply_returnsTargetForValidTransition_andThrowsForInvalid() {
        assertThat(MachineStateMachine.apply(MachineState.DEGRADED, MachineState.WARNING))
                .isEqualTo(MachineState.WARNING);
        assertThatThrownBy(() -> MachineStateMachine.apply(MachineState.NORMAL, MachineState.CRITICAL))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void walk_stepsUpOneEdgeAtATime() {
        assertThat(MachineStateMachine.walk(MachineState.NORMAL, MachineState.CRITICAL))
                .isEqualTo(MachineState.DEGRADED);
        assertThat(MachineStateMachine.walk(MachineState.DEGRADED, MachineState.CRITICAL))
                .isEqualTo(MachineState.WARNING);
        assertThat(MachineStateMachine.walk(MachineState.WARNING, MachineState.CRITICAL))
                .isEqualTo(MachineState.CRITICAL);
    }

    @Test
    void walk_returnsTargetForDirectEdge() {
        assertThat(MachineStateMachine.walk(MachineState.DEGRADED, MachineState.NORMAL))
                .isEqualTo(MachineState.NORMAL);
        assertThat(MachineStateMachine.walk(MachineState.WARNING, MachineState.DEGRADED))
                .isEqualTo(MachineState.DEGRADED);
    }

    @Test
    void walk_deescalatesThroughRecoveringWhenLegal() {
        assertThat(MachineStateMachine.walk(MachineState.CRITICAL, MachineState.NORMAL))
                .isEqualTo(MachineState.RECOVERING);
        assertThat(MachineStateMachine.walk(MachineState.RECOVERING, MachineState.NORMAL))
                .isEqualTo(MachineState.NORMAL);
        assertThat(MachineStateMachine.walk(MachineState.MAINTENANCE, MachineState.NORMAL))
                .isEqualTo(MachineState.RECOVERING);
    }

    @Test
    void walk_sameStateReturnsSameState() {
        assertThat(MachineStateMachine.walk(MachineState.NORMAL, MachineState.NORMAL))
                .isEqualTo(MachineState.NORMAL);
        assertThat(MachineStateMachine.walk(MachineState.CRITICAL, MachineState.CRITICAL))
                .isEqualTo(MachineState.CRITICAL);
    }
}