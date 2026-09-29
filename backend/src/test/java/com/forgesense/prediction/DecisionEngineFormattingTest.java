package com.forgesense.prediction;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Unit-discipline tests for the alert narrative.
 *
 * The previous implementation produced text such as "NEUTRAL (+-2%)" for a
 * negative factor contribution and "failure risk 0%" for a real 0.06% risk.
 * Both are false statements about the numbers, so they are pinned here.
 */
class DecisionEngineFormattingTest {

    @Test
    @DisplayName("a small non-zero probability is never rounded to 0%")
    void formatProbabilityKeepsSmallValues() {
        assertEquals("0.060%", DecisionEngine.formatProbability(0.0006));
        assertEquals("0.500%", DecisionEngine.formatProbability(0.005));
        assertEquals("50.0%", DecisionEngine.formatProbability(0.5));
        assertEquals("78.9%", DecisionEngine.formatProbability(0.789));
        assertEquals("100.0%", DecisionEngine.formatProbability(1.0));
    }

    @Test
    @DisplayName("a true zero probability renders as 0%")
    void formatProbabilityZero() {
        assertEquals("0%", DecisionEngine.formatProbability(0.0));
    }

    @Test
    @DisplayName("a vanishing probability is bounded rather than shown as 0%")
    void formatProbabilityFloor() {
        assertEquals("<0.01%", DecisionEngine.formatProbability(0.0000001));
    }

    @Test
    @DisplayName("a negative contribution never produces a '+-' artefact")
    void signedDeltaUsesARealSign() {
        String rendered = DecisionEngine.formatSignedDelta(-0.0069);
        assertFalse(rendered.contains("+-"), "must not contain a '+-' artefact: " + rendered);
        assertTrue(rendered.startsWith("\u2212"), "expected a real minus sign: " + rendered);
    }

    @Test
    @DisplayName("a signed delta is never suffixed with a percent sign")
    void signedDeltaCarriesNoPercentSign() {
        // The contribution is a change in model output probability, not a
        // percentage. Rendering '%' here would be a unit error.
        assertFalse(DecisionEngine.formatSignedDelta(0.0069).contains("%"));
        assertFalse(DecisionEngine.formatSignedDelta(-0.0069).contains("%"));
    }

    @Test
    @DisplayName("a positive contribution carries an explicit plus sign")
    void signedDeltaPositive() {
        assertEquals("+0.0069", DecisionEngine.formatSignedDelta(0.0069));
    }

    @Test
    @DisplayName("a zero contribution is rendered without a sign")
    void signedDeltaZero() {
        assertEquals("0.0000", DecisionEngine.formatSignedDelta(0.0));
    }
}
