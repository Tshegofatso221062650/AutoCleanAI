from fastapi import APIRouter, HTTPException

router = APIRouter(tags=["objectives"])


@router.api_route("/objectives/templates", methods=["GET"])
@router.api_route("/objectives/{objective_key}", methods=["GET"])
@router.api_route("/objectives/custom", methods=["POST"])
@router.api_route("/datasets/{dataset_id}/objective", methods=["POST"])
def legacy_objectives_disabled(*_args, **_kwargs):
    raise HTTPException(410, "Legacy objectives endpoints are disabled. Use the DB-backed /objectives API.")
