package com.forgesense.machine.domain;

public enum SensorType {
    TEMPERATURE("temperature", "\u00b0C"),
    VIBRATION("vibration", "mm/s"),
    PRESSURE("pressure", "bar"),
    RPM("rpm", "rpm"),
    TORQUE("torque", "Nm"),
    CURRENT("current", "A"),
    VOLTAGE("voltage", "V"),
    POWER("power", "kW"),
    FLOW("flow", "L/min"),
    FREQUENCY("frequency", "Hz");

    private final String key;
    private final String unit;

    SensorType(String key, String unit) {
        this.key = key;
        this.unit = unit;
    }

    public String key() {
        return key;
    }

    public String unit() {
        return unit;
    }
}