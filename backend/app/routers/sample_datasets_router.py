from fastapi import APIRouter, Depends
from ..db import get_conn, _utc_now
from ..auth import require_auth

router = APIRouter()

SAMPLE_DATASETS = [
    {
        "id": "sample_customers",
        "name": "Customer Data",
        "description": "Sample customer dataset with common data quality issues",
        "rows": 1000,
        "columns": ["id", "name", "email", "phone", "address", "city", "state", "zip", "country", "created_at"],
    },
    {
        "id": "sample_sales",
        "name": "Sales Transactions",
        "description": "Sample sales data with missing values and duplicates",
        "rows": 500,
        "columns": ["transaction_id", "customer_id", "product_id", "quantity", "price", "date", "status"],
    },
    {
        "id": "sample_products",
        "name": "Product Catalog",
        "description": "Sample product data with inconsistent formatting",
        "rows": 200,
        "columns": ["product_id", "name", "description", "price", "category", "sku", "stock"],
    },
]

@router.get("/")
def list_sample_datasets(user: str = Depends(require_auth)):
    """List all available sample datasets."""
    return {"datasets": SAMPLE_DATASETS}

@router.get("/{dataset_id}")
def get_sample_dataset(dataset_id: str, user: str = Depends(require_auth)):
    """Get a specific sample dataset details."""
    dataset = next((d for d in SAMPLE_DATASETS if d["id"] == dataset_id), None)
    if not dataset:
        from fastapi import HTTPException
        raise HTTPException(404, "Sample dataset not found")
    return dataset

@router.post("/{dataset_id}/load")
def load_sample_dataset(dataset_id: str, user: str = Depends(require_auth)):
    """Load a sample dataset for the user."""
    dataset = next((d for d in SAMPLE_DATASETS if d["id"] == dataset_id), None)
    if not dataset:
        from fastapi import HTTPException
        raise HTTPException(404, "Sample dataset not found")
    
    # Create a dataset entry in the database for the sample
    import pandas as pd
    import os
    import uuid
    
    # Generate sample data
    if dataset_id == "sample_customers":
        data = {
            "id": list(range(1, 1001)),
            "name": [f"Customer {i}" for i in range(1, 1001)],
            "email": [f"customer{i}@example.com" if i % 5 != 0 else None for i in range(1, 1001)],
            "phone": [f"555-{i:04d}" if i % 3 != 0 else None for i in range(1, 1001)],
            "address": [f"{i} Main St" for i in range(1, 1001)],
            "city": ["New York" if i % 4 != 0 else None for i in range(1, 1001)],
            "state": ["NY" for i in range(1, 1001)],
            "zip": [f"{10000 + i}" for i in range(1, 1001)],
            "country": ["USA" for i in range(1, 1001)],
            "created_at": ["2024-01-01" for i in range(1, 1001)],
        }
    elif dataset_id == "sample_sales":
        data = {
            "transaction_id": [f"TXN{i:06d}" for i in range(1, 501)],
            "customer_id": [f"CUST{100 + (i % 50):04d}" for i in range(1, 501)],
            "product_id": [f"PROD{200 + (i % 20):04d}" for i in range(1, 501)],
            "quantity": [i % 5 + 1 for i in range(1, 501)],
            "price": [10.0 + (i % 10) * 5.0 for i in range(1, 501)],
            "date": ["2024-01-01" for i in range(1, 501)],
            "status": ["completed" if i % 10 != 0 else None for i in range(1, 501)],
        }
    else:
        data = {
            "product_id": [f"PROD{i:04d}" for i in range(1, 201)],
            "name": [f"Product {i}" for i in range(1, 201)],
            "description": [f"Description for product {i}" if i % 3 != 0 else None for i in range(1, 201)],
            "price": [10.0 + i for i in range(1, 201)],
            "category": [f"Cat{(i % 5) + 1}" for i in range(1, 201)],
            "sku": [f"SKU-{i:04d}" for i in range(1, 201)],
            "stock": [i % 100 for i in range(1, 201)],
        }
    
    df = pd.DataFrame(data)
    
    # Save to file using the configured data directory (not a hardcoded relative path)
    from ..config import settings as _settings
    dataset_id_unique = str(uuid.uuid4())
    filename = f"{dataset['name'].replace(' ', '_')}_{dataset_id_unique[:8]}.csv"
    save_dir = _settings.data_dir / dataset_id_unique
    save_dir.mkdir(parents=True, exist_ok=True)
    filepath = str(save_dir / filename)
    df.to_csv(filepath, index=False)
    
    # Insert into database
    from ..db import insert_dataset
    insert_dataset(
        dataset_id=dataset_id_unique,
        original_filename=filename,
        stored_path=filepath,
        file_format="csv",
        row_count=len(df),
        col_count=len(df.columns),
        cleaning_objective="Sample dataset for testing",
        created_by=user,
    )
    
    return {
        "dataset_id": dataset_id_unique,
        "message": "Sample dataset loaded successfully",
        "rows": len(df),
        "columns": len(df.columns),
    }
