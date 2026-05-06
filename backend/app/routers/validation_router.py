from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from ..db import get_conn, _utc_now
from ..auth import require_auth

router = APIRouter()

class ValidationRuleCreate(BaseModel):
    name: str
    rule_type: str  # 'regex', 'range', 'enum', 'email', 'phone', 'required'
    column_name: str
    pattern: Optional[str] = None
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    allowed_values: Optional[str] = None  # JSON string
    is_required: bool = False
    error_message: Optional[str] = None

class ValidationRuleUpdate(BaseModel):
    name: Optional[str] = None
    rule_type: Optional[str] = None
    column_name: Optional[str] = None
    pattern: Optional[str] = None
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    allowed_values: Optional[str] = None
    is_required: Optional[bool] = None
    error_message: Optional[str] = None

def get_validation_rules(created_by: str = None) -> list[dict]:
    with get_conn() as conn:
        if created_by:
            rows = conn.execute(
                "SELECT * FROM validation_rules WHERE created_by = ? ORDER BY created_at DESC",
                (created_by,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM validation_rules ORDER BY created_at DESC"
            ).fetchall()
        return [dict(row) for row in rows]

def get_validation_rule(rule_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM validation_rules WHERE id = ?",
            (rule_id,)
        ).fetchone()
        return dict(row) if row else None

def create_validation_rule(
    name: str,
    rule_type: str,
    column_name: str,
    pattern: str = None,
    min_value: float = None,
    max_value: float = None,
    allowed_values: str = None,
    is_required: bool = False,
    error_message: str = None,
    created_by: str = None,
) -> int:
    with get_conn() as conn:
        cursor = conn.execute(
            """
            INSERT INTO validation_rules 
            (name, rule_type, column_name, pattern, min_value, max_value, allowed_values, is_required, error_message, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (name, rule_type, column_name, pattern, min_value, max_value, allowed_values, is_required, error_message, created_by, _utc_now(), _utc_now())
        )
        return cursor.lastrowid

def update_validation_rule(
    rule_id: int,
    name: str = None,
    rule_type: str = None,
    column_name: str = None,
    pattern: str = None,
    min_value: float = None,
    max_value: float = None,
    allowed_values: str = None,
    is_required: bool = None,
    error_message: str = None,
) -> None:
    with get_conn() as conn:
        updates = []
        values = []
        if name is not None:
            updates.append("name = ?")
            values.append(name)
        if rule_type is not None:
            updates.append("rule_type = ?")
            values.append(rule_type)
        if column_name is not None:
            updates.append("column_name = ?")
            values.append(column_name)
        if pattern is not None:
            updates.append("pattern = ?")
            values.append(pattern)
        if min_value is not None:
            updates.append("min_value = ?")
            values.append(min_value)
        if max_value is not None:
            updates.append("max_value = ?")
            values.append(max_value)
        if allowed_values is not None:
            updates.append("allowed_values = ?")
            values.append(allowed_values)
        if is_required is not None:
            updates.append("is_required = ?")
            values.append(is_required)
        if error_message is not None:
            updates.append("error_message = ?")
            values.append(error_message)
        
        updates.append("updated_at = ?")
        values.append(_utc_now())
        values.append(rule_id)
        
        conn.execute(
            f"UPDATE validation_rules SET {', '.join(updates)} WHERE id = ?",
            values
        )

def delete_validation_rule(rule_id: int) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM validation_rules WHERE id = ?", (rule_id,))

@router.get("/")
def list_rules(user: str = Depends(require_auth)):
    """List all validation rules for the user."""
    rules = get_validation_rules(created_by=user)
    return {"rules": rules}

@router.get("/{rule_id}")
def get_rule(rule_id: int, user: str = Depends(require_auth)):
    """Get a specific validation rule."""
    rule = get_validation_rule(rule_id)
    if not rule:
        raise HTTPException(404, "Validation rule not found")
    if rule.get("created_by") != user and user != "owner":
        raise HTTPException(403, "Access denied")
    return rule

@router.post("/")
def create_rule(rule: ValidationRuleCreate, user: str = Depends(require_auth)):
    """Create a new validation rule."""
    rule_id = create_validation_rule(
        name=rule.name,
        rule_type=rule.rule_type,
        column_name=rule.column_name,
        pattern=rule.pattern,
        min_value=rule.min_value,
        max_value=rule.max_value,
        allowed_values=rule.allowed_values,
        is_required=rule.is_required,
        error_message=rule.error_message,
        created_by=user,
    )
    created = get_validation_rule(rule_id)
    if not created:
        raise HTTPException(500, "Failed to create validation rule")
    return {"id": rule_id, **created}

@router.put("/{rule_id}")
def update_rule(rule_id: int, update: ValidationRuleUpdate, user: str = Depends(require_auth)):
    """Update a validation rule."""
    rule = get_validation_rule(rule_id)
    if not rule:
        raise HTTPException(404, "Validation rule not found")
    if rule.get("created_by") != user and user != "owner":
        raise HTTPException(403, "Access denied")
    update_validation_rule(
        rule_id,
        name=update.name,
        rule_type=update.rule_type,
        column_name=update.column_name,
        pattern=update.pattern,
        min_value=update.min_value,
        max_value=update.max_value,
        allowed_values=update.allowed_values,
        is_required=update.is_required,
        error_message=update.error_message,
    )
    
    updated = get_validation_rule(rule_id)
    return updated

@router.delete("/{rule_id}")
def delete_rule(rule_id: int, user: str = Depends(require_auth)):
    """Delete a validation rule."""
    rule = get_validation_rule(rule_id)
    if not rule:
        raise HTTPException(404, "Validation rule not found")
    if rule.get("created_by") != user and user != "owner":
        raise HTTPException(403, "Access denied")
    delete_validation_rule(rule_id)
    return {"message": "Validation rule deleted successfully"}
