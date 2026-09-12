package com.forgesense.machine.domain;

public enum MachineState {
    ONLINE,
    NORMAL,
    DEGRADED,
    WARNING,
    CRITICAL,
    MAINTENANCE,
    OFFLINE,
    RECOVERING
}