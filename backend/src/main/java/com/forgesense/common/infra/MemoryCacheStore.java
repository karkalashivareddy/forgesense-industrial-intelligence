package com.forgesense.common.infra;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-memory cache store (dev profile) - same contract as Redis, no daemon needed.
 */
@Component
@Profile("!docker")
public class MemoryCacheStore implements CacheStore {

    private static final Logger log = LoggerFactory.getLogger(MemoryCacheStore.class);

    private final Map<String, CachedValue> store = new ConcurrentHashMap<>();

    public MemoryCacheStore() {
        log.info("CacheStore: in-memory adapter active (dev profile). Set spring.profiles.active=docker for Redis.");
    }

    @Override
    public void put(String key, String json, Duration ttl) {
        store.put(key, new CachedValue(json, System.currentTimeMillis() + ttl.toMillis()));
    }

    @Override
    public Optional<String> get(String key) {
        CachedValue cv = store.get(key);
        if (cv == null) return Optional.empty();
        if (cv.expiresAt < System.currentTimeMillis()) {
            store.remove(key);
            return Optional.empty();
        }
        return Optional.of(cv.value);
    }

    @Override
    public void delete(String key) {
        store.remove(key);
    }

    @Override
    public void putMulti(Map<String, String> entries, Duration ttl) {
        entries.forEach((k, v) -> put(k, v, ttl));
    }

    @Override
    public Map<String, String> getAll(Iterable<String> keys) {
        Map<String, String> out = new java.util.HashMap<>();
        keys.forEach(k -> get(k).ifPresent(v -> out.put(k, v)));
        return out;
    }

    private record CachedValue(String value, long expiresAt) {}
}