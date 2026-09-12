package com.forgesense.actions;

import com.forgesense.actions.domain.OperatorAction;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface OperatorActionRepository extends JpaRepository<OperatorAction, UUID> {

    List<OperatorAction> findTop50ByOrderByPerformedAtDesc();
}