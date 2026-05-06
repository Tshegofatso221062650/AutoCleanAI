"""Transformation rules schemas for custom data transformations."""
from pydantic import BaseModel, Field
from typing import Optional, Any, Literal
from datetime import datetime


class TransformationRule(BaseModel):
    """Single transformation rule."""
    rule_type: Literal["filter", "map", "calculate", "format", "validate"] = Field(
        ..., description="Type of transformation"
    )
    column: str = Field(..., description="Column to apply rule to")
    condition: Optional[str] = Field(None, description="Condition for when to apply (e.g., 'age > 18')")
    operation: str = Field(..., description="Operation to perform")
    value: Optional[Any] = Field(None, description="Value for the operation")
    new_column: Optional[str] = Field(None, description="Name of new column if creating one")


class RuleSetCreate(BaseModel):
    """Request to create a new rule set."""
    name: str = Field(..., description="Rule set name")
    description: Optional[str] = Field(None, description="Rule set description")
    rules: list[TransformationRule] = Field(..., description="List of transformation rules")


class RuleSetUpdate(BaseModel):
    """Request to update a rule set."""
    name: Optional[str] = None
    description: Optional[str] = None
    rules: Optional[list[TransformationRule]] = None


class RuleSetResponse(BaseModel):
    """Response with rule set details."""
    id: int
    name: str
    description: Optional[str]
    rules: list[TransformationRule]
    created_by: str
    created_at: datetime
    updated_at: datetime
