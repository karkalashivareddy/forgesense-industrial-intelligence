package com.forgesense.factory;

import com.forgesense.factory.domain.ProductionLine;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface ProductionLineRepository extends JpaRepository<ProductionLine, UUID> {

    List<ProductionLine> findByFactoryCodeOrderByOrderIndex(String factoryCode);
}