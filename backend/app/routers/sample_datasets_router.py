from fastapi import APIRouter, Depends
from ..db import get_conn, _utc_now
from ..auth import require_auth

router = APIRouter()

SAMPLE_DATASETS = [
    {
        "id": "sample_customers",
        "name": "Customer Data",
        "description": "Messy CRM export — typos, invalid emails, mixed date formats, null-like strings, duplicate IDs",
        "rows": 1000,
        "columns": ["id", "name", "email", "phone", "address", "city", "state", "zip", "country", "age", "created_at"],
    },
    {
        "id": "sample_sales",
        "name": "Sales Transactions",
        "description": "POS export — missing prices, quantity outliers, inconsistent status casing, mixed date formats",
        "rows": 500,
        "columns": ["transaction_id", "customer_id", "product_id", "quantity", "price", "date", "status"],
    },
    {
        "id": "sample_products",
        "name": "Product Catalog",
        "description": "Inventory dump — negative prices, truncated categories, empty SKUs, description nulls",
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
    
    import random
    random.seed(42)

    # Realistic messy data with typos, nulls, mixed formats, duplicates, outliers
    if dataset_id == "sample_customers":
        first_names = ["Alice", "Bob", "Charlie", "Diana", "Eve", "Frank", "Grace", "Hank", "Ivy", "Jack",
                       "Karen", "Leo", "Mia", "Noah", "Olivia", "Paul", "Quinn", "Rita", "Sam", "Tina"]
        last_names = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez"]
        cities = ["New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "Philadelphia", "San Antonio",
                  "San Diego", "Dallas", "San Jose"]
        states = ["NY", "CA", "IL", "TX", "AZ", "PA", "TX", "CA", "TX", "CA"]
        date_formats = ["%Y-%m-%d", "%m/%d/%Y", "%d-%b-%Y", "%Y/%m/%d"]

        rows_data = []
        for i in range(1, 1001):
            fn = random.choice(first_names)
            ln = random.choice(last_names)
            # Typos in names (5% chance)
            name = f"{fn} {ln}" if i % 20 != 0 else f"{fn[::-1]} {ln}"
            # Inconsistent casing
            name = name.upper() if i % 15 == 0 else (name.lower() if i % 25 == 0 else name)
            # Messy emails: missing, null-like strings, invalid formats
            if i % 7 == 0:
                email = None
            elif i % 11 == 0:
                email = "N/A"
            elif i % 13 == 0:
                email = "not available"
            elif i % 17 == 0:
                email = f"{fn.lower()}@"  # invalid — no domain
            else:
                email = f"{fn.lower()}.{ln.lower()}@example.com"
            # Messy phones
            if i % 5 == 0:
                phone = None
            elif i % 9 == 0:
                phone = f"({random.randint(200,999)}) {random.randint(100,999)}-{random.randint(1000,9999)}"
            else:
                phone = f"{random.randint(200,999)}-{random.randint(100,999)}-{random.randint(1000,9999)}"
            ci = (i - 1) % len(cities)
            city = cities[ci] if i % 8 != 0 else None
            state = states[ci] if i % 8 != 0 else ("n/a" if i % 16 == 0 else None)
            zipcode = f"{10000 + random.randint(0, 89999)}" if i % 12 != 0 else "???"
            country = random.choice(["USA", "US", "United States", "usa", "U.S.A."])
            fmt = random.choice(date_formats)
            month = random.randint(1, 12)
            day = random.randint(1, 28)
            from datetime import date as _date
            created = _date(random.randint(2020, 2024), month, day).strftime(fmt) if i % 10 != 0 else ""
            age = random.randint(18, 85) if i % 6 != 0 else (random.choice([-5, 200, None]) if i % 30 == 0 else random.randint(18, 85))

            rows_data.append({
                "id": i if i % 50 != 0 else rows_data[-1]["id"],  # duplicate id
                "name": name,
                "email": email,
                "phone": phone,
                "address": f"{random.randint(1, 9999)} {random.choice(['Main', 'Oak', 'Elm', 'Pine', 'Maple'])} {random.choice(['St', 'Ave', 'Blvd', 'Dr'])}",
                "city": city,
                "state": state,
                "zip": zipcode,
                "country": country,
                "age": age,
                "created_at": created,
            })
        data = {k: [r[k] for r in rows_data] for k in rows_data[0]}

    elif dataset_id == "sample_sales":
        statuses = ["completed", "pending", "shipped", "cancelled", "refunded"]
        rows_data = []
        for i in range(1, 501):
            txn_id = f"TXN{i:06d}" if i % 40 != 0 else f"TXN{(i - 1):06d}"  # duplicate
            cust_id = f"CUST{100 + (i % 50):04d}"
            prod_id = f"PROD{200 + (i % 20):04d}"
            qty = random.randint(1, 10) if i % 15 != 0 else random.choice([-1, 0, 999])  # outliers
            price = round(random.uniform(5.0, 500.0), 2)
            if i % 12 == 0:
                price = None  # missing price
            elif i % 25 == 0:
                price = round(random.uniform(5000, 50000), 2)  # outlier
            # Mixed date formats
            month = random.randint(1, 12)
            day = random.randint(1, 28)
            yr = random.randint(2022, 2024)
            from datetime import date as _date
            date_val = _date(yr, month, day)
            if i % 6 == 0:
                date_str = date_val.strftime("%m/%d/%Y")
            elif i % 9 == 0:
                date_str = date_val.strftime("%d-%b-%Y")
            elif i % 14 == 0:
                date_str = ""
            else:
                date_str = date_val.strftime("%Y-%m-%d")
            status = random.choice(statuses) if i % 8 != 0 else random.choice(["  completed ", "COMPLETED", "Completd", None])

            rows_data.append({
                "transaction_id": txn_id, "customer_id": cust_id, "product_id": prod_id,
                "quantity": qty, "price": price, "date": date_str, "status": status,
            })
        data = {k: [r[k] for r in rows_data] for k in rows_data[0]}

    else:
        categories_clean = ["Electronics", "Clothing", "Home & Garden", "Sports", "Books"]
        rows_data = []
        for i in range(1, 201):
            pid = f"PROD{i:04d}" if i % 30 != 0 else f"PROD{(i - 1):04d}"  # duplicate
            # Inconsistent naming
            name = f"Product {i}"
            if i % 10 == 0:
                name = name.upper()
            elif i % 18 == 0:
                name = name.lower()
            desc = f"High quality {random.choice(['widget','gadget','tool','accessory'])} for daily use"
            if i % 4 == 0:
                desc = None
            elif i % 22 == 0:
                desc = "N/A"
            price = round(random.uniform(1.0, 500.0), 2)
            if i % 20 == 0:
                price = round(random.uniform(5000, 99999), 2)  # outlier
            elif i % 15 == 0:
                price = -abs(price)  # negative price
            cat = random.choice(categories_clean)
            if i % 7 == 0:
                cat = cat.upper()
            elif i % 11 == 0:
                cat = cat.lower()
            elif i % 19 == 0:
                cat = cat[:3]  # truncated
            sku = f"SKU-{i:04d}" if i % 16 != 0 else ""
            stock = random.randint(0, 500) if i % 9 != 0 else None

            rows_data.append({
                "product_id": pid, "name": name, "description": desc,
                "price": price, "category": cat, "sku": sku, "stock": stock,
            })
        data = {k: [r[k] for r in rows_data] for k in rows_data[0]}
    
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
