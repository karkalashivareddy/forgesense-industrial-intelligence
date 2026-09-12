package com.forgesense.factory.web;

import com.forgesense.factory.FactoryRepository;
import com.forgesense.factory.ZoneRepository;
import com.forgesense.common.errors.ApiException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1")
public class FactoryController {

    private final FactoryRepository factoryRepository;
    private final ZoneRepository zoneRepository;

    public FactoryController(FactoryRepository factoryRepository, ZoneRepository zoneRepository) {
        this.factoryRepository = factoryRepository;
        this.zoneRepository = zoneRepository;
    }

    @GetMapping("/factories")
    public List<Map<String, Object>> list() {
        return factoryRepository.findAll().stream().map(f -> Map.<String, Object>of(
                "id", f.getId(), "name", f.getName(), "code", f.getCode(), "location", f.getLocation(),
                "createdAt", f.getCreatedAt())).toList();
    }

    @GetMapping("/factories/{code}")
    public Map<String, Object> get(@PathVariable String code) {
        var f = factoryRepository.findByCode(code)
                .orElseThrow(() -> ApiException.notFound("Factory not found: " + code));
        return Map.of("id", f.getId(), "name", f.getName(), "code", f.getCode(), "location", f.getLocation());
    }

    @GetMapping("/zones")
    public List<Map<String, Object>> zones() {
        return zoneRepository.findAll().stream().map(z -> Map.<String, Object>of(
                "id", z.getId(), "name", z.getName(), "code", z.getCode(),
                "factoryCode", z.getFactory().getCode(), "order", z.getOrderIndex())).toList();
    }
}