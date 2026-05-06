from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from ..db import get_conn, _utc_now
from ..auth import require_auth

router = APIRouter()

class CustomFunctionCreate(BaseModel):
    name: str
    description: Optional[str] = None
    function_type: str  # 'transform', 'validate', 'aggregate'
    function_code: str
    language: str = 'python'
    parameters: Optional[str] = None

class CustomFunctionUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    function_type: Optional[str] = None
    function_code: Optional[str] = None
    language: Optional[str] = None
    parameters: Optional[str] = None

def get_custom_functions(created_by: str = None) -> list[dict]:
    with get_conn() as conn:
        if created_by:
            rows = conn.execute(
                "SELECT * FROM custom_functions WHERE created_by = ? ORDER BY created_at DESC",
                (created_by,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM custom_functions ORDER BY created_at DESC"
            ).fetchall()
        return [dict(row) for row in rows]

def get_custom_function(func_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM custom_functions WHERE id = ?",
            (func_id,)
        ).fetchone()
        return dict(row) if row else None

def create_custom_function(
    name: str,
    description: str,
    function_type: str,
    function_code: str,
    language: str,
    parameters: str,
    created_by: str = None,
) -> int:
    with get_conn() as conn:
        cursor = conn.execute(
            """
            INSERT INTO custom_functions 
            (name, description, function_type, function_code, language, parameters, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (name, description, function_type, function_code, language, parameters, created_by, _utc_now(), _utc_now())
        )
        return cursor.lastrowid

def update_custom_function(
    func_id: int,
    name: str = None,
    description: str = None,
    function_type: str = None,
    function_code: str = None,
    language: str = None,
    parameters: str = None,
) -> None:
    with get_conn() as conn:
        updates = []
        values = []
        
        if name is not None:
            updates.append("name = ?")
            values.append(name)
        if description is not None:
            updates.append("description = ?")
            values.append(description)
        if function_type is not None:
            updates.append("function_type = ?")
            values.append(function_type)
        if function_code is not None:
            updates.append("function_code = ?")
            values.append(function_code)
        if language is not None:
            updates.append("language = ?")
            values.append(language)
        if parameters is not None:
            updates.append("parameters = ?")
            values.append(parameters)
        
        updates.append("updated_at = ?")
        values.append(_utc_now())
        values.append(func_id)
        
        conn.execute(
            f"UPDATE custom_functions SET {', '.join(updates)} WHERE id = ?",
            values
        )

def delete_custom_function(func_id: int) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM custom_functions WHERE id = ?", (func_id,))

@router.get("/")
def list_functions(user: str = Depends(require_auth)):
    """List all custom functions."""
    functions = get_custom_functions(created_by=user)
    return {"functions": functions}

@router.get("/{func_id}")
def get_function(func_id: int, user: str = Depends(require_auth)):
    """Get a specific custom function."""
    func = get_custom_function(func_id)
    if not func:
        raise HTTPException(404, "Custom function not found")
    if func.get("created_by") != user and user != "owner":
        raise HTTPException(403, "Access denied")
    return func

@router.post("/")
def create_function(func: CustomFunctionCreate, user: str = Depends(require_auth)):
    """Create a new custom function."""
    func_id = create_custom_function(
        name=func.name,
        description=func.description,
        function_type=func.function_type,
        function_code=func.function_code,
        language=func.language,
        parameters=func.parameters,
        created_by=user,
    )
    created = get_custom_function(func_id)
    if not created:
        raise HTTPException(500, "Failed to create custom function")
    return {"id": func_id, **created}

@router.put("/{func_id}")
def update_function(func_id: int, update: CustomFunctionUpdate, user: str = Depends(require_auth)):
    """Update a custom function."""
    func = get_custom_function(func_id)
    if not func:
        raise HTTPException(404, "Custom function not found")
    if func.get("created_by") != user and user != "owner":
        raise HTTPException(403, "Access denied")
    
    update_custom_function(
        func_id,
        name=update.name,
        description=update.description,
        function_type=update.function_type,
        function_code=update.function_code,
        language=update.language,
        parameters=update.parameters,
    )
    
    updated = get_custom_function(func_id)
    return updated

@router.delete("/{func_id}")
def delete_function(func_id: int, user: str = Depends(require_auth)):
    """Delete a custom function."""
    func = get_custom_function(func_id)
    if not func:
        raise HTTPException(404, "Custom function not found")
    if func.get("created_by") != user and user != "owner":
        raise HTTPException(403, "Access denied")
    delete_custom_function(func_id)
    return {"message": "Custom function deleted successfully"}


class RunFunctionRequest(BaseModel):
    dataset_id: Optional[str] = None
    sample_data: Optional[list] = None
    parameters: Optional[dict] = None


@router.post("/{func_id}/run")
def run_function(func_id: int, body: RunFunctionRequest, user: str = Depends(require_auth)):
    """Execute a custom function against a dataset or sample data.

    The function code must define a callable named after the function_type:
      - transform:  def transform(df): ...  → returns modified DataFrame
      - validate:   def validate(df): ...   → returns list of issue dicts
      - aggregate:  def aggregate(df): ...  → returns dict of metrics
    """
    import io
    import threading
    import traceback
    import json as _json
    import pandas as pd
    import numpy as np

    func = get_custom_function(func_id)
    if not func:
        raise HTTPException(404, "Custom function not found")

    if func.get("language", "python").lower() != "python":
        raise HTTPException(400, "Only Python functions are supported for execution")

    # ── AST security scan BEFORE execution ───────────────────────────────────
    from app.services.security import audit_function_code
    violations = audit_function_code(func["function_code"])
    if violations:
        raise HTTPException(403, f"Security policy violation: {violations[0]}")

    # ── Load data ─────────────────────────────────────────────────────────────
    df: pd.DataFrame | None = None
    if body.dataset_id:
        from ..db import get_dataset
        from ..services.storage import resolve_original_path
        from pathlib import Path
        row = get_dataset(body.dataset_id)
        if not row:
            raise HTTPException(404, "Dataset not found")
        path = resolve_original_path(body.dataset_id)
        if not path:
            raise HTTPException(404, "Dataset file not found")
        fmt = (row.get("file_format") or "csv").lower()
        try:
            if fmt == "csv":
                df = pd.read_csv(path)
            elif fmt in ("xls", "xlsx"):
                df = pd.read_excel(path)
            elif fmt == "json":
                df = pd.read_json(path)
            elif fmt == "parquet":
                df = pd.read_parquet(path)
            else:
                df = pd.read_csv(path)
        except Exception as exc:
            raise HTTPException(400, f"Failed to load dataset: {exc}")
        df = df.head(500)
    elif body.sample_data:
        try:
            df = pd.DataFrame(body.sample_data)
        except Exception as exc:
            raise HTTPException(400, f"Invalid sample_data: {exc}")
    else:
        df = pd.DataFrame()

    # ── Build restricted execution namespace ──────────────────────────────────
    _SAFE_BUILTINS = {
        "abs": abs, "all": all, "any": any, "bool": bool, "dict": dict,
        "enumerate": enumerate, "filter": filter, "float": float, "format": format,
        "frozenset": frozenset, "hasattr": hasattr, "int": int, "isinstance": isinstance,
        "issubclass": issubclass, "iter": iter, "len": len, "list": list, "map": map,
        "max": max, "min": min, "next": next, "print": print, "range": range,
        "repr": repr, "reversed": reversed, "round": round, "set": set, "slice": slice,
        "sorted": sorted, "str": str, "sum": sum, "tuple": tuple, "type": type,
        "zip": zip, "None": None, "True": True, "False": False,
    }
    # Strip file I/O methods from pd/np to prevent data exfiltration via allowed names
    import types
    _pd_safe = types.ModuleType("pandas")
    _pd_safe.__dict__.update({
        k: v for k, v in pd.__dict__.items()
        if not k.startswith(("read_", "io")) and k not in ("HDFStore",)
    })
    # Remove DataFrame.to_* file sinks from the class copy
    _blocked_df_methods = {
        "to_csv", "to_excel", "to_json", "to_parquet", "to_pickle",
        "to_sql", "to_clipboard", "to_hdf", "to_feather", "to_stata",
    }

    namespace: dict = {
        "__builtins__": _SAFE_BUILTINS,
        "pd": _pd_safe,
        "np": np,
        "df": df,
    }
    if body.parameters:
        namespace["params"] = body.parameters

    # ── Execute with timeout ──────────────────────────────────────────────────
    result_holder: dict = {}
    error_holder:  dict = {}

    def _run():
        try:
            exec(func["function_code"], namespace)  # noqa: S102
            fn_name = func["function_type"]
            if fn_name not in namespace:
                error_holder["err"] = f"Function code must define a callable named '{fn_name}'"
                return
            fn = namespace[fn_name]
            output = fn(df)
            result_holder["output"] = output
        except Exception:
            error_holder["err"] = traceback.format_exc()

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    t.join(timeout=30)
    if t.is_alive():
        raise HTTPException(408, "Function execution timed out (30 s limit)")

    if error_holder:
        # Return only the last line of the traceback (no internal paths)
        last_line = error_holder["err"].strip().splitlines()[-1]
        raise HTTPException(400, f"Execution error: {last_line}")

    raw = result_holder.get("output")
    fn_type = func["function_type"]

    # ── Serialize output ──────────────────────────────────────────────────────
    if fn_type == "transform":
        if isinstance(raw, pd.DataFrame):
            preview = raw.head(100).where(pd.notnull(raw.head(100)), other=None).to_dict(orient="records")
            return {
                "function_type": "transform",
                "rows_in":  len(df),
                "rows_out": len(raw),
                "cols_in":  list(df.columns),
                "cols_out": list(raw.columns),
                "preview":  preview,
            }
        raise HTTPException(400, "transform function must return a DataFrame")

    if fn_type == "validate":
        issues = raw if isinstance(raw, list) else []
        return {"function_type": "validate", "issue_count": len(issues), "issues": issues[:200]}

    if fn_type == "aggregate":
        metrics = raw if isinstance(raw, dict) else {}
        return {"function_type": "aggregate", "metrics": metrics}

    return {"function_type": fn_type, "result": str(raw)}
