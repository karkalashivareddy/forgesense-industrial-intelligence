package com.forgesense.factory;

import com.forgesense.factory.domain.Zone;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface ZoneRepository extends JpaRepository<Zone, UUID> {

    List<Zone> findByFactoryCodeOrderByOrderIndex(String factoryCode);

    List<Zone> findByFactoryId(UUID factoryId);
}