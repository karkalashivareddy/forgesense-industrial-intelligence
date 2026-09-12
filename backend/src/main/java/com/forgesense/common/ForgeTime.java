package com.forgesense.common;

import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Instant;

@Component
public class ForgeTime {

    private final Clock clock = Clock.systemUTC();

    public Instant now() {
        return clock.instant();
    }
}