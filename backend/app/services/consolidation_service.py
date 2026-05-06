from typing import Any
import pandas as pd
from pathlib import Path
from app.services.cleaning_engine import load_dataframe
from app.db import get_conn, _utc_now


def create_consolidation_group(name: str, description: str | None = None) -> str:
    """Create a new consolidation group."""
    import uuid
    group_id = str(uuid.uuid4())
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO consolidation_groups (id, name, description, created_at, status)
            VALUES (?, ?, ?, ?, ?)
            """,
            (group_id, name, description, _utc_now(), 'pending')
        )
    return group_id


def add_dataset_to_group(group_id: str, dataset_id: str, join_key: str | None = None) -> bool:
    """Add a dataset to a consolidation group."""
    with get_conn() as conn:
        try:
            conn.execute(
                """
                INSERT INTO consolidation_members (group_id, dataset_id, join_key)
                VALUES (?, ?, ?)
                """,
                (group_id, dataset_id, join_key)
            )
            return True
        except Exception:
            return False


def get_group_datasets(group_id: str) -> list[dict]:
    """Get all datasets in a consolidation group."""
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT d.*, m.join_key
            FROM datasets d
            JOIN consolidation_members m ON d.id = m.dataset_id
            WHERE m.group_id = ?
            """,
            (group_id,)
        ).fetchall()
        return [dict(r) for r in rows]


def consolidate_datasets(group_id: str, merge_strategy: str = 'concat') -> tuple[pd.DataFrame, dict[str, Any]]:
    """
    Consolidate multiple datasets into one.
    
    Args:
        group_id: Consolidation group ID
        merge_strategy: 'concat' for vertical concatenation, 'merge' for horizontal merge
    """
    datasets = get_group_datasets(group_id)
    if not datasets:
        raise ValueError("No datasets found in consolidation group")
    
    dataframes = []
    metadata = []
    
    for ds in datasets:
        try:
            df = load_dataframe(Path(ds['stored_path']), ds['file_format'])
            df['_source_dataset'] = ds['id']
            df['_source_filename'] = ds['original_filename']
            dataframes.append(df)
            metadata.append({
                'dataset_id': ds['id'],
                'filename': ds['original_filename'],
                'row_count': len(df),
                'col_count': len(df.columns)
            })
        except Exception as e:
            metadata.append({
                'dataset_id': ds['id'],
                'filename': ds['original_filename'],
                'error': str(e)
            })
    
    if not dataframes:
        raise ValueError("No valid datasets could be loaded")
    
    if merge_strategy == 'concat':
        # Vertical concatenation (stack rows)
        result = pd.concat(dataframes, ignore_index=True)
        strategy_used = 'vertical_concatenation'
    elif merge_strategy == 'merge':
        # Horizontal merge (join on common columns)
        join_keys = [ds.get('join_key') for ds in datasets if ds.get('join_key')]
        if join_keys and join_keys[0]:
            result = dataframes[0]
            for df in dataframes[1:]:
                result = pd.merge(result, df, on=join_keys[0], how='outer', suffixes=('', '_dup'))
            strategy_used = f'horizontal_merge_on_{join_keys[0]}'
        else:
            # Merge on common columns
            common_cols = set(dataframes[0].columns)
            for df in dataframes[1:]:
                common_cols &= set(df.columns)
            
            if common_cols:
                result = dataframes[0]
                for df in dataframes[1:]:
                    result = pd.merge(result, df, on=list(common_cols), how='outer', suffixes=('', '_dup'))
                strategy_used = f'horizontal_merge_on_common_{list(common_cols)}'
            else:
                # Fallback to concatenation
                result = pd.concat(dataframes, ignore_index=True)
                strategy_used = 'fallback_concatenation'
    else:
        raise ValueError(f"Unknown merge strategy: {merge_strategy}")
    
    # Update group status
    with get_conn() as conn:
        conn.execute(
            "UPDATE consolidation_groups SET status = ? WHERE id = ?",
            ('completed', group_id)
        )
    
    log = {
        'strategy': strategy_used,
        'datasets_processed': len(dataframes),
        'total_rows': len(result),
        'total_columns': len(result.columns),
        'metadata': metadata
    }
    
    return result, log


def auto_detect_consolidation_strategy(datasets: list[dict]) -> str:
    """
    Automatically detect the best consolidation strategy.
    
    Returns: 'concat' or 'merge'
    """
    if len(datasets) < 2:
        return 'concat'
    
    # Check if datasets have similar schemas (good for concat)
    first_cols = set(datasets[0].get('columns', []))
    similar_schemas = all(
        set(ds.get('columns', [])) == first_cols 
        for ds in datasets[1:]
    )
    
    if similar_schemas:
        return 'concat'
    
    # Check if there are common columns (good for merge)
    common_cols = first_cols
    for ds in datasets[1:]:
        common_cols &= set(ds.get('columns', []))
    
    if len(common_cols) > 0:
        return 'merge'
    
    return 'concat'
