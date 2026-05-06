from typing import Any

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class AnalyzeRequest(BaseModel):
    dataset_id: str


class MissingValueStrategy(BaseModel):
    column: str | None = None
    strategy: str = "median"  # mean | median | mode | drop | ai


class CleanRequest(BaseModel):
    dataset_id: str
    fix_missing: bool = True
    missing_strategy: str = "median"  # mean | median | most_frequent | ffill | bfill | drop | knn | regression
    remove_duplicates: bool = True
    coerce_types: bool = True
    normalize_strings: bool = True
    fix_typos: bool = True
    clip_outliers: bool = False
    outlier_method: str = "iqr"  # iqr | zscore
    outlier_z_threshold: float = 3.0
    validate_emails: bool = True
    validate_age_min: int | None = 0
    validate_age_max: int | None = 120
    custom_rules: list[dict[str, Any]] = Field(default_factory=list)
    safe_mode: bool = True
    transformation_rule_ids: list[int] = Field(default_factory=list)  # IDs of transformation rule sets to apply
    # New advanced options
    uniqueness_cols: list[str] | None = None
    survivorship: str = "first"  # first | last | most_complete
    fuzzy_threshold: float = 0.0  # 0 = disabled; set > 0 to enable O(n²) fuzzy dedup
    distinguish_impossible: bool = True
    cross_field_validation: bool = True
    quarantine_failed: bool = False
    add_missing_indicators: bool = False
    use_placeholder: bool = False
    placeholder_value: str = "Unknown"
    timezone: str | None = None
    normalize_special_chars: bool = True
    auto_standardize: bool = True      # boolean/currency/pct find-and-replace
    split_columns: bool = True          # split compound columns (full names, delimiters)
    reconcile_categories: bool = True   # fuzzy-merge near-duplicate category labels
    normalize_column_names: bool = True # lowercase + underscore column names
    drop_constant_columns: bool = False # remove columns with only 1 unique value
    min_transform_confidence: float = 0.0  # 0 disables confidence gate; e.g. 0.8 blocks low-confidence steps
    fail_on_schema_error: bool = False
    quarantine_on_schema_failure: bool = True
    strict_schema: dict[str, Any] = Field(default_factory=dict)
    performance_mode: bool = False  # faster run: reduced profiling/preview overhead


class ChatRequest(BaseModel):
    dataset_id: str
    message: str


class ChatResponse(BaseModel):
    reply: str
    provider: str


class CustomRulePayload(BaseModel):
    rules: list[dict[str, Any]]


class SettingsPayload(BaseModel):
    ai_provider: str | None = None
    ollama_model: str | None = None
    ollama_base_url: str | None = None
    openai_model: str | None = None
    ollama_timeout: float | None = None
    allow_registration: bool | None = None


class CleaningObjectiveCreate(BaseModel):
    name: str = Field(..., description="Objective name")
    description: str | None = Field(None, description="Objective description")
    objective_type: str = Field(..., description="Type: quality_target, data_requirement, business_rule")
    target_value: float | str | None = Field(None, description="Target value (e.g., 90 for 90% quality)")
    column_name: str | None = Field(None, description="Column name if objective is column-specific")
    validation_rule: str | None = Field(None, description="Validation rule expression")
    is_template: bool = Field(default=False, description="Whether this is a template objective")


class CleaningObjectiveUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    objective_type: str | None = None
    target_value: float | str | None = None
    column_name: str | None = None
    validation_rule: str | None = None
    is_template: bool | None = None


class CleaningObjectiveResponse(BaseModel):
    id: int
    name: str
    description: str | None
    objective_type: str
    target_value: float | str | None
    column_name: str | None
    validation_rule: str | None
    is_template: bool
    created_by: str
    created_at: Any
    updated_at: Any
