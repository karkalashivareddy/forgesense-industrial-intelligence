"""Regression tests for trajectory-isolated synthetic evaluation."""

import numpy as np

from app.models import _evaluate, _group_holdout


def test_group_holdout_is_deterministic_and_keeps_trajectories_intact():
    groups = np.repeat(np.arange(40), 10)

    train_a, test_a = _group_holdout(groups)
    train_b, test_b = _group_holdout(groups)

    assert np.array_equal(train_a, train_b)
    assert np.array_equal(test_a, test_b)
    assert not set(groups[train_a]).intersection(groups[test_a])
    assert len(np.unique(groups[test_a])) == 8


def test_rul_metrics_use_only_the_failure_risk_positive_target_cohort():
    class IsolationModel:
        def decision_function(self, features):
            return np.zeros(len(features))

    class RiskModel:
        def predict_proba(self, features):
            positive = np.array([0.1, 0.9, 0.2, 0.8])[:len(features)]
            return np.column_stack((1 - positive, positive))

    class RulModel:
        def predict(self, features):
            return np.zeros(len(features))

    x_test = np.zeros((4, 1))
    y_risk = np.array([0, 1, 0, 1])
    y_rul = np.array([60.0, 55.0, 40.0, 5.0])
    clean = np.array([True, False, True, False])
    metrics = _evaluate(
        IsolationModel(), RiskModel(), RulModel(), x_test, y_risk, y_rul,
        clean, np.arange(4), np.zeros((20, 1)), np.ones(20, dtype=bool),
    )

    # Positive rows have targets 55 and 5: MAE is 30 and RMSE is sqrt(1525).
    # Including the two risk-negative RUL labels would produce different errors.
    assert metrics["rul_mae_steps"] == 30.0
    assert metrics["rul_rmse_steps"] == 39.051
