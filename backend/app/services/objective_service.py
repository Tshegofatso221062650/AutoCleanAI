from typing import Any
from dataclasses import dataclass, field
from enum import Enum


class CleaningObjective(str, Enum):
    """Predefined cleaning objectives based on use case."""
    ANALYTICS = "analytics"
    REPORTING = "reporting"
    MACHINE_LEARNING = "machine_learning"
    DATA_WAREHOUSE = "data_warehouse"
    REGULATORY = "regulatory"
    CUSTOM = "custom"


@dataclass
class ObjectiveConfig:
    """Configuration for cleaning objectives."""
    objective: CleaningObjective
    description: str
    priority_fields: list[str] = field(default_factory=list)
    quality_threshold: float = 80.0
    max_missing_pct: float = 50.0
    require_completeness: bool = False
    audit_trail: bool = True
    
    def get_cleaning_priorities(self) -> dict[str, Any]:
        """Return cleaning priorities based on objective."""
        priorities = {
            "remove_duplicates": True,
            "fix_missing": True,
            "coerce_types": True,
            "normalize_strings": True,
        }
        
        if self.objective == CleaningObjective.MACHINE_LEARNING:
            priorities.update({
                "missing_strategy": "knn",
                "add_missing_indicators": True,
                "clip_outliers": True,
                "distinguish_impossible": True,
                "cross_field_validation": True,
            })
        elif self.objective == CleaningObjective.REGULATORY:
            priorities.update({
                "missing_strategy": "median",
                "add_missing_indicators": True,
                "quarantine_failed": True,
                "use_placeholder": True,
                "cross_field_validation": True,
            })
        elif self.objective == CleaningObjective.ANALYTICS:
            priorities.update({
                "missing_strategy": "median",
                "clip_outliers": False,
                "distinguish_impossible": True,
            })
        elif self.objective == CleaningObjective.REPORTING:
            priorities.update({
                "missing_strategy": "mode",
                "use_placeholder": True,
                "normalize_strings": True,
            })
        elif self.objective == CleaningObjective.DATA_WAREHOUSE:
            priorities.update({
                "missing_strategy": "regression",
                "add_missing_indicators": True,
                "coerce_types": True,
                "cross_field_validation": True,
            })
        
        return priorities


# Predefined objective templates
OBJECTIVE_TEMPLATES = {
    CleaningObjective.ANALYTICS: ObjectiveConfig(
        objective=CleaningObjective.ANALYTICS,
        description="Prepare data for general analytics and business intelligence",
        quality_threshold=85.0,
        max_missing_pct=30.0,
    ),
    CleaningObjective.REPORTING: ObjectiveConfig(
        objective=CleaningObjective.REPORTING,
        description="Clean data for executive reporting and dashboards",
        quality_threshold=90.0,
        max_missing_pct=20.0,
        require_completeness=True,
    ),
    CleaningObjective.MACHINE_LEARNING: ObjectiveConfig(
        objective=CleaningObjective.MACHINE_LEARNING,
        description="Prepare data for ML model training with feature engineering",
        quality_threshold=95.0,
        max_missing_pct=40.0,
        audit_trail=True,
    ),
    CleaningObjective.DATA_WAREHOUSE: ObjectiveConfig(
        objective=CleaningObjective.DATA_WAREHOUSE,
        description="Clean and standardize data for data warehouse loading",
        quality_threshold=92.0,
        max_missing_pct=25.0,
    ),
    CleaningObjective.REGULATORY: ObjectiveConfig(
        objective=CleaningObjective.REGULATORY,
        description="Clean data for regulatory compliance with full audit trail",
        quality_threshold=98.0,
        max_missing_pct=10.0,
        require_completeness=True,
        audit_trail=True,
    ),
}


def get_objective_template(objective: CleaningObjective) -> ObjectiveConfig:
    """Get predefined objective template."""
    return OBJECTIVE_TEMPLATES.get(objective, OBJECTIVE_TEMPLATES[CleaningObjective.ANALYTICS])


def create_custom_objective(description: str, priorities: dict[str, Any]) -> ObjectiveConfig:
    """Create a custom cleaning objective."""
    return ObjectiveConfig(
        objective=CleaningObjective.CUSTOM,
        description=description,
        quality_threshold=priorities.get("quality_threshold", 80.0),
        max_missing_pct=priorities.get("max_missing_pct", 50.0),
        require_completeness=priorities.get("require_completeness", False),
        audit_trail=priorities.get("audit_trail", True),
    )
