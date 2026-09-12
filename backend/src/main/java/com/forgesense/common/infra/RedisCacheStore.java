package com.forgesense.common.infra;

import org.springframework.context.annotation.Profile;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Map;
import java.util.Optional;

/**
 * Redis-backed cache store (docker profile).
 */
@Component
@Profile("docker")
public class RedisCacheStore implements CacheStore {

    private final StringRedisTemplate redis;

    public RedisCacheStore(StringRedisTemplate redis) {
        this.redis = redis;
    }

    @Override
    public void put(String key, String json, Duration ttl) {
        redis.opsForValue().set(key, json, ttl);
    }

    @Override
    public Optional<String> get(String key) {
        String v = redis.opsForValue().get(key);
        return Optional.ofNullable(v);
    }

    @Override
    public void delete(String key) {
        redis.delete(key);
    }

    @Override
    public void putMulti(Map<String, String> entries, Duration ttl) {
        redis.opsForValue().multiSet(entries);
        entries.keySet().forEach(k -> redis.expire(k, ttl));
    }

    @Override
    public Map<String, String> getAll(Iterable<String> keys) {
        java.util.List<String> keyList = java.util.stream.StreamSupport.stream(keys.spliterator(), false).toList();
        java.util.List<String> values = redis.opsForValue().multiGet(keyList);
        java.util.Map<String, String> result = new java.util.HashMap<>();
        for (int i = 0; i < keyList.size(); i++) {
            String k = keyList.get(i);
            String v = values == null ? null : values.get(i);
            if (v != null) {
                result.put(k, v);
            }
        }
        return result;
    }
}