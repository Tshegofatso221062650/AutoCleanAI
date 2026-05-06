"""Transformation engine for applying custom transformation rules."""
import pandas as pd
import numpy as np
from typing import Any, Dict, List


def apply_transformation_rules(df: pd.DataFrame, rules: List[Dict[str, Any]]) -> pd.DataFrame:
    """Apply transformation rules to a dataframe."""
    result = df.copy()
    
    for rule in rules:
        rule_type = rule.get("rule_type")
        column = rule.get("column")
        condition = rule.get("condition")
        operation = rule.get("operation")
        value = rule.get("value")
        new_column = rule.get("new_column")
        
        if not column or not operation:
            continue
        
        # Apply condition filter if specified
        if condition:
            try:
                mask = result.eval(condition)
                subset = result[mask]
            except Exception as e:
                print(f"Failed to evaluate condition '{condition}': {e}")
                continue
        else:
            subset = result
        
        try:
            if rule_type == "filter":
                result = _apply_filter(result, column, operation, value)
            elif rule_type == "map":
                result = _apply_map(result, column, operation, value, condition)
            elif rule_type == "calculate":
                result = _apply_calculate(result, column, operation, value, new_column)
            elif rule_type == "format":
                result = _apply_format(result, column, operation, value)
            elif rule_type == "validate":
                result = _apply_validate(result, column, operation, value)
        except Exception as e:
            print(f"Failed to apply rule {rule_type} on column {column}: {e}")
            continue
    
    return result


def _apply_filter(df: pd.DataFrame, column: str, operation: str, value: Any) -> pd.DataFrame:
    """Apply filter operation."""
    if operation == "equals":
        return df[df[column] == value]
    elif operation == "not_equals":
        return df[df[column] != value]
    elif operation == "greater_than":
        return df[df[column] > value]
    elif operation == "less_than":
        return df[df[column] < value]
    elif operation == "contains":
        return df[df[column].astype(str).str.contains(str(value), na=False)]
    elif operation == "not_null":
        return df[df[column].notna()]
    elif operation == "is_null":
        return df[df[column].isna()]
    return df


def _apply_map(df: pd.DataFrame, column: str, operation: str, value: Any, condition: str | None) -> pd.DataFrame:
    """Apply mapping operation."""
    if operation == "replace":
        if condition:
            mask = df.eval(condition)
            df.loc[mask, column] = value
        else:
            df[column] = df[column].replace(value)
    elif operation == "upper":
        df[column] = df[column].astype(str).str.upper()
    elif operation == "lower":
        df[column] = df[column].astype(str).str.lower()
    elif operation == "strip":
        df[column] = df[column].astype(str).str.strip()
    elif operation == "trim":
        df[column] = df[column].astype(str).str.strip()
    return df


def _apply_calculate(df: pd.DataFrame, column: str, operation: str, value: Any, new_column: str | None) -> pd.DataFrame:
    """Apply calculation operation."""
    target_col = new_column if new_column else column
    
    if operation == "add":
        df[target_col] = df[column] + value
    elif operation == "subtract":
        df[target_col] = df[column] - value
    elif operation == "multiply":
        df[target_col] = df[column] * value
    elif operation == "divide":
        df[target_col] = df[column] / value
    elif operation == "power":
        df[target_col] = df[column] ** value
    elif operation == "abs":
        df[target_col] = df[column].abs()
    elif operation == "log":
        df[target_col] = np.log(df[column])
    elif operation == "sqrt":
        df[target_col] = np.sqrt(df[column])
    
    return df


def _apply_format(df: pd.DataFrame, column: str, operation: str, value: Any) -> pd.DataFrame:
    """Apply formatting operation."""
    if operation == "date_format":
        df[column] = pd.to_datetime(df[column], errors="coerce").dt.strftime(str(value))
    elif operation == "number_format":
        df[column] = df[column].astype(str)
    elif operation == "round":
        df[column] = df[column].round(int(value) if value else 0)
    elif operation == "pad":
        df[column] = df[column].astype(str).str.zfill(int(value) if value else 2)
    
    return df


def _apply_validate(df: pd.DataFrame, column: str, operation: str, value: Any) -> pd.DataFrame:
    """Apply validation and flag invalid rows."""
    validation_col = f"{column}_valid"
    
    if operation == "email":
        import re
        email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        df[validation_col] = df[column].astype(str).str.match(email_pattern, na=False)
    elif operation == "phone":
        df[validation_col] = df[column].astype(str).str.match(r'^\+?[\d\s-()]+$', na=False)
    elif operation == "range":
        min_val, max_val = value if isinstance(value, (list, tuple)) else (0, value)
        df[validation_col] = (df[column] >= min_val) & (df[column] <= max_val)
    elif operation == "regex":
        import re
        df[validation_col] = df[column].astype(str).str.match(str(value), na=False)
    
    return df
