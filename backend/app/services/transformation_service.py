from typing import Any
import pandas as pd
import numpy as np


def pivot_dataframe(df: pd.DataFrame, index: str, columns: str, values: str) -> pd.DataFrame:
    """Pivot dataframe for analysis."""
    return df.pivot(index=index, columns=columns, values=values)


def melt_dataframe(df: pd.DataFrame, id_vars: list[str], value_vars: list[str] | None = None) -> pd.DataFrame:
    """Melt dataframe from wide to long format."""
    return pd.melt(df, id_vars=id_vars, value_vars=value_vars, var_name='variable', value_name='value')


def aggregate_dataframe(df: pd.DataFrame, group_by: list[str], 
                        aggregations: dict[str, str | list[str]]) -> pd.DataFrame:
    """
    Aggregate dataframe by specified columns.
    
    Args:
        df: Input dataframe
        group_by: Columns to group by
        aggregations: Dict mapping column to aggregation method(s)
                     e.g., {'column1': 'sum', 'column2': ['mean', 'std']}
    """
    return df.groupby(group_by).agg(aggregations).reset_index()


def filter_dataframe(df: pd.DataFrame, filters: dict[str, Any]) -> pd.DataFrame:
    """
    Filter dataframe based on conditions.
    
    Args:
        df: Input dataframe
        filters: Dict mapping column to filter condition
                e.g., {'age': {'min': 18, 'max': 65}, 'status': ['active', 'pending']}
    """
    result = df.copy()
    for column, condition in filters.items():
        if column not in result.columns:
            continue
        
        if isinstance(condition, dict):
            if 'min' in condition:
                result = result[result[column] >= condition['min']]
            if 'max' in condition:
                result = result[result[column] <= condition['max']]
            if 'gt' in condition:
                result = result[result[column] > condition['gt']]
            if 'lt' in condition:
                result = result[result[column] < condition['lt']]
            if 'eq' in condition:
                result = result[result[column] == condition['eq']]
            if 'ne' in condition:
                result = result[result[column] != condition['ne']]
            if 'contains' in condition:
                result = result[result[column].astype(str).str.contains(str(condition['contains']), case=False, na=False)]
            if 'not_contains' in condition:
                result = result[~result[column].astype(str).str.contains(str(condition['not_contains']), case=False, na=False)]
            if 'in' in condition:
                result = result[result[column].isin(condition['in'])]
            if 'not_in' in condition:
                result = result[~result[column].isin(condition['not_in'])]
        elif isinstance(condition, list):
            result = result[result[column].isin(condition)]
        else:
            result = result[result[column] == condition]
    
    return result.reset_index(drop=True)


def sort_dataframe(df: pd.DataFrame, sort_by: list[str], ascending: bool | list[bool] = True) -> pd.DataFrame:
    """Sort dataframe by specified columns."""
    return df.sort_values(by=sort_by, ascending=ascending).reset_index(drop=True)


def create_derived_column(df: pd.DataFrame, column_name: str, 
                          expression: str, dependencies: list[str] | None = None) -> pd.DataFrame:
    """
    Create a derived column using a pandas expression.
    
    Args:
        df: Input dataframe
        column_name: Name for the new column
        expression: Pandas expression (e.g., 'col1 + col2', 'col1 * 0.1')
        dependencies: List of columns the expression depends on
    """
    result = df.copy()
    try:
        # Safe evaluation of expression
        result[column_name] = result.eval(expression)
    except Exception:
        # Fallback to simple operations
        if '+' in expression:
            parts = expression.split('+')
            if len(parts) == 2 and all(p.strip() in result.columns for p in parts):
                result[column_name] = result[parts[0].strip()] + result[parts[1].strip()]
    
    return result


def bin_column(df: pd.DataFrame, column: str, bins: int = 5, labels: list[str] | None = None) -> pd.DataFrame:
    """Bin a numeric column into categories."""
    result = df.copy()
    if column in result.columns and pd.api.types.is_numeric_dtype(result[column]):
        result[f'{column}_binned'] = pd.cut(result[column], bins=bins, labels=labels)
    return result


def normalize_column(df: pd.DataFrame, column: str, method: str = 'minmax') -> pd.DataFrame:
    """
    Normalize a numeric column.
    
    Args:
        df: Input dataframe
        column: Column to normalize
        method: 'minmax' or 'zscore'
    """
    result = df.copy()
    if column in result.columns and pd.api.types.is_numeric_dtype(result[column]):
        if method == 'minmax':
            min_val = result[column].min()
            max_val = result[column].max()
            if max_val - min_val != 0:
                result[f'{column}_normalized'] = (result[column] - min_val) / (max_val - min_val)
        elif method == 'zscore':
            mean_val = result[column].mean()
            std_val = result[column].std()
            if std_val != 0:
                result[f'{column}_normalized'] = (result[column] - mean_val) / std_val
    return result


def join_dataframes(df1: pd.DataFrame, df2: pd.DataFrame, 
                    on: str | list[str], how: str = 'inner') -> pd.DataFrame:
    """
    Join two dataframes.
    
    Args:
        df1: Left dataframe
        df2: Right dataframe
        on: Column(s) to join on
        how: Type of join ('inner', 'left', 'right', 'outer')
    """
    return pd.merge(df1, df2, on=on, how=how)


def calculate_time_diff(df: pd.DataFrame, start_col: str, end_col: str, 
                        unit: str = 'days', result_col: str | None = None) -> pd.DataFrame:
    """
    Calculate time difference between two datetime columns.
    
    Args:
        df: Input dataframe
        start_col: Start date column
        end_col: End date column
        unit: Time unit ('days', 'hours', 'minutes', 'seconds')
        result_col: Name for the result column
    """
    result = df.copy()
    if result_col is None:
        result_col = f'{start_col}_to_{end_col}_{unit}'
    
    if start_col in result.columns and end_col in result.columns:
        # Ensure columns are datetime
        result[start_col] = pd.to_datetime(result[start_col])
        result[end_col] = pd.to_datetime(result[end_col])
        
        diff = result[end_col] - result[start_col]
        
        if unit == 'days':
            result[result_col] = diff.dt.days
        elif unit == 'hours':
            result[result_col] = diff.dt.total_seconds() / 3600
        elif unit == 'minutes':
            result[result_col] = diff.dt.total_seconds() / 60
        elif unit == 'seconds':
            result[result_col] = diff.dt.total_seconds()
    
    return result


def apply_transformation_pipeline(df: pd.DataFrame, pipeline: list[dict[str, Any]]) -> tuple[pd.DataFrame, dict[str, Any]]:
    """
    Apply a series of transformations to a dataframe.
    
    Args:
        df: Input dataframe
        pipeline: List of transformation steps
                 Each step should have 'type' and relevant parameters
    """
    result = df.copy()
    log = []
    
    for step in pipeline:
        step_type = step.get('type')
        try:
            if step_type == 'filter':
                # Support flat {column, operator, value} from UI as well as legacy {filters: {...}}
                filters = step.get('filters') or {}
                col = step.get('column')
                op = step.get('operator', 'eq')
                val = step.get('value')
                if col and not filters:
                    if op == 'is_null':
                        result = result[result[col].isna()] if col in result.columns else result
                    elif op == 'not_null':
                        result = result[result[col].notna()] if col in result.columns else result
                    else:
                        op_map = {'eq': 'eq', 'ne': 'ne', 'gt': 'gt', 'gte': 'gte', 'lt': 'lt', 'lte': 'lte', 'contains': 'contains', 'not_contains': 'not_contains'}
                        filters = {col: {op_map.get(op, 'eq'): val}}
                if filters:
                    # Resolve gte/lte/gt/lt/contains into filter_dataframe's format
                    resolved: dict = {}
                    for c, cond in filters.items():
                        if isinstance(cond, dict):
                            new_cond: dict = {}
                            for k, v in cond.items():
                                if k == 'gte': new_cond['min'] = v
                                elif k == 'lte': new_cond['max'] = v
                                elif k == 'gt': new_cond['gt'] = v
                                elif k == 'lt': new_cond['lt'] = v
                                elif k == 'contains': new_cond['contains'] = v
                                elif k == 'not_contains': new_cond['not_contains'] = v
                                else: new_cond[k] = v
                            resolved[c] = new_cond
                        else:
                            resolved[c] = cond
                    result = filter_dataframe(result, resolved)
                log.append({'type': 'filter', 'status': 'success', 'rows_after': len(result)})
            elif step_type == 'aggregate':
                result = aggregate_dataframe(result, step.get('group_by', []), step.get('aggregations', {}))
                log.append({'type': 'aggregate', 'status': 'success', 'rows_after': len(result)})
            elif step_type == 'pivot':
                result = pivot_dataframe(result, step['index'], step['columns'], step['values'])
                log.append({'type': 'pivot', 'status': 'success', 'rows_after': len(result)})
            elif step_type == 'melt':
                result = melt_dataframe(result, step['id_vars'], step.get('value_vars'))
                log.append({'type': 'melt', 'status': 'success', 'rows_after': len(result)})
            elif step_type == 'sort':
                result = sort_dataframe(result, step.get('sort_by', []), step.get('ascending', True))
                log.append({'type': 'sort', 'status': 'success'})
            elif step_type == 'derive':
                result = create_derived_column(result, step['column_name'], step['expression'], step.get('dependencies'))
                log.append({'type': 'derive', 'status': 'success', 'column': step['column_name']})
            elif step_type == 'bin':
                result = bin_column(result, step['column'], step.get('bins', 5), step.get('labels'))
                log.append({'type': 'bin', 'status': 'success'})
            elif step_type == 'normalize':
                result = normalize_column(result, step['column'], step.get('method', 'minmax'))
                log.append({'type': 'normalize', 'status': 'success'})
            elif step_type == 'join':
                # Note: This would require access to another dataframe, not implemented here
                log.append({'type': 'join', 'status': 'skipped', 'reason': 'Requires external dataframe'})
            elif step_type == 'time_diff':
                result = calculate_time_diff(result, step['start_col'], step['end_col'], step.get('unit', 'days'), step.get('result_col'))
                log.append({'type': 'time_diff', 'status': 'success'})
        except Exception as e:
            log.append({'type': step_type, 'status': 'error', 'error': str(e)})
    
    return result, {'steps': log, 'row_count_before': len(df), 'row_count_after': len(result)}
