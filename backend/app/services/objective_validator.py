"""Service for validating cleaning objectives against data quality metrics."""
from app.db import (
    get_dataset,
    get_dataset_objectives,
    update_objective_status,
    get_cleaning_objective,
)


def validate_objectives(dataset_id: str, quality_score: float, profile: dict) -> list[dict]:
    """
    Validate all objectives assigned to a dataset against its quality metrics.
    
    Args:
        dataset_id: The dataset ID
        quality_score: The quality score of the dataset
        profile: The analysis profile containing column statistics
        
    Returns:
        List of validation results for each objective
    """
    objectives = get_dataset_objectives(dataset_id)
    results = []
    
    for obj_assignment in objectives:
        objective_id = obj_assignment["objective_id"]
        objective = get_cleaning_objective(objective_id)
        
        if not objective:
            continue
        
        objective_type = objective["objective_type"]
        target_value = objective.get("target_value")
        column_name = objective.get("column_name")
        validation_rule = objective.get("validation_rule")
        
        passed = False
        result_value = None
        message = ""
        
        if objective_type == "quality_target":
            # Validate quality score against target
            if target_value:
                target = float(target_value)
                passed = quality_score >= target
                result_value = str(quality_score)
                message = f"Quality score {quality_score}% {'meets' if passed else 'below'} target {target}%"
        
        elif objective_type == "data_requirement":
            # Validate data requirements (e.g., no nulls in critical columns)
            if column_name and column_name in profile.get("missing_per_column", {}):
                missing_pct = profile["missing_per_column"][column_name]
                if target_value:
                    target = float(target_value)
                    passed = missing_pct <= target
                    result_value = str(missing_pct)
                    message = f"Missing values {missing_pct}% {'within' if passed else 'exceeds'} target {target}%"
        
        elif objective_type == "business_rule":
            # Validate business rules (e.g., email format, age range)
            if validation_rule:
                # Parse and validate the rule
                passed = validate_business_rule(validation_rule, profile, column_name)
                result_value = "passed" if passed else "failed"
                _known = {"no_nulls", "max_5%_missing", "max_10%_missing"}
                if validation_rule not in _known and not passed:
                    message = f"Business rule '{validation_rule}' is not recognised — supported: {sorted(_known)}"
                else:
                    message = f"Business rule '{validation_rule}' {'passed' if passed else 'failed'}"
        
        # Update the objective status
        status = "completed" if passed else "failed"
        update_objective_status(dataset_id, objective_id, status, result_value)
        
        results.append({
            "objective_id": objective_id,
            "objective_name": objective["name"],
            "objective_type": objective_type,
            "target_value": target_value,
            "result_value": result_value,
            "passed": passed,
            "message": message,
        })
    
    return results


def validate_business_rule(rule: str, profile: dict, column_name: str | None = None) -> bool:
    """
    Validate a business rule against the data profile.
    
    Args:
        rule: The validation rule expression
        profile: The data profile
        column_name: Optional column name for column-specific rules
        
    Returns:
        True if the rule passes, False otherwise
    """
    # Simple rule validation examples
    if column_name and column_name in profile.get("missing_per_column", {}):
        missing_pct = profile["missing_per_column"][column_name]
        
        if rule == "no_nulls":
            return missing_pct == 0
        elif rule == "max_5%_missing":
            return missing_pct <= 5
        elif rule == "max_10%_missing":
            return missing_pct <= 10
    
    # Unrecognised rule — fail explicitly so users know it isn't enforced
    return False


def suggest_pipeline_steps_from_objectives(dataset_id: str) -> list[dict]:
    """
    Suggest pipeline steps based on assigned objectives.
    
    Args:
        dataset_id: The dataset ID
        
    Returns:
        List of suggested pipeline steps
    """
    objectives = get_dataset_objectives(dataset_id)
    suggestions = []
    
    for obj_assignment in objectives:
        objective = get_cleaning_objective(obj_assignment["objective_id"])
        if not objective:
            continue
        
        objective_type = objective["objective_type"]
        
        if objective_type == "quality_target":
            target = float(objective.get("target_value", 0))
            if target >= 90:
                # High quality target - suggest comprehensive cleaning
                suggestions.append({
                    "step_type": "fix_missing",
                    "params": {"strategy": "median"},
                    "reason": "To meet high quality target",
                })
                suggestions.append({
                    "step_type": "normalize_strings",
                    "params": {},
                    "reason": "To meet high quality target",
                })
        
        elif objective_type == "data_requirement":
            column_name = objective.get("column_name")
            if column_name:
                suggestions.append({
                    "step_type": "coerce_types",
                    "params": {"column": column_name},
                    "reason": f"To meet requirement for column {column_name}",
                })
        
        elif objective_type == "business_rule":
            validation_rule = objective.get("validation_rule")
            if validation_rule and "no_nulls" in validation_rule:
                suggestions.append({
                    "step_type": "fix_missing",
                    "params": {"strategy": "drop"},
                    "reason": "To satisfy no nulls requirement",
                })
    
    return suggestions
