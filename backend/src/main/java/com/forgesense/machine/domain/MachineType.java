package com.forgesense.machine.domain;

public enum MachineType {
    CNC_MILL("CNC Mill"),
    INDUSTRIAL_MOTOR("Industrial Motor"),
    HYDRAULIC_PUMP("Hydraulic Pump"),
    CONVEYOR_DRIVE_MOTOR("Conveyor Drive Motor"),
    COMPRESSOR("Compressor"),
    ROBOTIC_ARM("Robotic Arm"),
    COOLING_UNIT("Cooling Unit"),
    GENERATOR("Generator");

    private final String label;

    MachineType(String label) {
        this.label = label;
    }

    public String label() {
        return label;
    }
}