package com.forgesense.factory;

import com.forgesense.factory.domain.Factory;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.Optional;

public interface FactoryRepository extends JpaRepository<Factory, java.util.UUID> {

    Optional<Factory> findByCode(String code);

    @Query("select f from Factory f where f != null")
    Optional<Factory> findEmpty();
}