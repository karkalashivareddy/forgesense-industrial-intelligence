package com.forgesense.analytics.web;

import com.forgesense.analytics.AnalyticsService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/analytics")
public class AnalyticsController {

    private final AnalyticsService analytics;

    public AnalyticsController(AnalyticsService analytics) {
        this.analytics = analytics;
    }

    @GetMapping("/overview")
    public Map<String, Object> overview() {
        return analytics.overview();
    }

    @GetMapping("/risk-ranking")
    public List<Map<String, Object>> riskRanking() {
        return analytics.riskRanking();
    }

    @GetMapping("/alerts")
    public Map<String, Object> alerts() {
        return analytics.alertStats();
    }

    @GetMapping("/health-trends")
    public Map<String, Object> healthTrends() {
        return analytics.fleetHealth();
    }

    @GetMapping("/maintenance")
    public Map<String, Object> maintenance() {
        return analytics.maintenanceStats();
    }

    @GetMapping("/events")
    public Map<String, Object> events() {
        return analytics.eventFrequency();
    }
}