package com.forgesense.prediction;

import com.forgesense.prediction.domain.Prediction;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface PredictionRepository extends JpaRepository<Prediction, UUID> {

    List<Prediction> findTop50ByMachineIdOrderByTimestampDesc(String machineId);

    Prediction findFirstByMachineIdOrderByTimestampDesc(String machineId);

    long countByTimestampAfter(Instant after);
}