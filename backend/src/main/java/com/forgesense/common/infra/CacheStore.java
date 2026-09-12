package com.forgesense.common.infra;

import java.time.Duration;
import java.util.Map;
import java.util.Optional;

/**
 * Small cache abstraction. Production adapter = Redis, dev adapter = in-memory.
 * Used for latest digital-twin snapshots and short-lived state.
 */
public interface CacheStore {

    void put(String key, String json, Duration ttl);

    Optional<String> get(String key);

    void delete(String key);

    void putMulti(Map<String, String> entries, Duration ttl);

    Map<String, String> getAll(Iterable<String> keys);
}