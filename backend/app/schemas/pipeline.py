"""Pipeline schemas for data cleaning workflows."""
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
from datetime import datetime


class PipelineStep(BaseModel):
    """Single step in a cleaning pipeline."""
    step_type: str = Field(..., description="Type of step: fix_missing, remove_duplicates, transformation_rule, consolidation, etc.")
    params: Dict[str, Any] = Field(default_factory=dict, description="Parameters for this step")
    enabled: bool = Field(default=True, description="Whether this step is enabled")
    order: int = Field(..., description="Order of execution")
    # For transformation rule step
    transformation_rule_id: Optional[int] = Field(None, description="ID of transformation rule set if step_type is 'transformation_rule'")
    # For consolidation step
    consolidation_group_id: Optional[int] = Field(None, description="ID of consolidation group if step_type is 'consolidation'")


class PipelineCreate(BaseModel):
    """Request to create a new pipeline."""
    name: str = Field(..., description="Pipeline name")
    description: Optional[str] = Field(None, description="Pipeline description")
    steps: List[PipelineStep] = Field(..., description="Pipeline steps")
    is_template: bool = Field(default=False, description="Whether this is a template pipeline")


class PipelineUpdate(BaseModel):
    """Request to update a pipeline."""
    name: Optional[str] = None
    description: Optional[str] = None
    steps: Optional[List[PipelineStep]] = None
    is_template: Optional[bool] = None


class PipelineResponse(BaseModel):
    """Response with pipeline details."""
    id: int
    name: str
    description: Optional[str]
    steps: List[PipelineStep]
    is_template: bool
    created_by: str
    created_at: datetime
    updated_at: datetime
    usage_count: int = Field(default=0, description="Number of times this pipeline was used")
