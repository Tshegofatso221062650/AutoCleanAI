"""Transformation rules router for custom data transformations."""
import json
from fastapi import APIRouter, Depends, HTTPException

from app.auth import require_auth
from app.db import (
    create_transformation_rule,
    get_transformation_rule,
    list_transformation_rules,
    update_transformation_rule,
    delete_transformation_rule,
)
from app.schemas.transformation_rules import RuleSetCreate, RuleSetUpdate

router = APIRouter(tags=["transformation-rules"])


@router.post("/transformation-rules")
def create(rule_set: RuleSetCreate, user: str = Depends(require_auth)) -> dict:
    """Create a new transformation rule set."""
    rule_id = create_transformation_rule(
        name=rule_set.name,
        description=rule_set.description,
        rules=json.dumps([r.model_dump() for r in rule_set.rules]),
        created_by=user,
    )
    return {"rule_id": rule_id, "message": "Rule set created successfully"}


@router.get("/transformation-rules")
def list_all(user: str = Depends(require_auth)) -> list[dict]:
    """List all transformation rule sets for the user."""
    rules = list_transformation_rules(created_by=user)
    for rule in rules:
        rule["rules"] = json.loads(rule["rules"])
    return rules


@router.get("/transformation-rules/{rule_id}")
def get(rule_id: int, user: str = Depends(require_auth)) -> dict:
    """Get a specific transformation rule set."""
    rule = get_transformation_rule(rule_id)
    if not rule:
        raise HTTPException(404, "Rule set not found")
    if rule["created_by"] != user and user != "owner":
        raise HTTPException(403, "Access denied")
    rule["rules"] = json.loads(rule["rules"])
    return rule


@router.put("/transformation-rules/{rule_id}")
def update(rule_id: int, rule_set: RuleSetUpdate, user: str = Depends(require_auth)) -> dict:
    """Update a transformation rule set."""
    existing = get_transformation_rule(rule_id)
    if not existing:
        raise HTTPException(404, "Rule set not found")
    if existing["created_by"] != user and user != "owner":
        raise HTTPException(403, "Access denied")
    rules_json = None
    if rule_set.rules:
        rules_json = json.dumps([r.model_dump() for r in rule_set.rules])
    
    update_transformation_rule(
        rule_id=rule_id,
        name=rule_set.name,
        description=rule_set.description,
        rules=rules_json,
    )
    return {"message": "Rule set updated successfully"}


@router.delete("/transformation-rules/{rule_id}")
def delete(rule_id: int, user: str = Depends(require_auth)) -> dict:
    """Delete a transformation rule set."""
    existing = get_transformation_rule(rule_id)
    if not existing:
        raise HTTPException(404, "Rule set not found")
    if existing["created_by"] != user and user != "owner":
        raise HTTPException(403, "Access denied")
    delete_transformation_rule(rule_id)
    return {"message": "Rule set deleted successfully"}
