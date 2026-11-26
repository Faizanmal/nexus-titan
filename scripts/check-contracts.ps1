$ErrorActionPreference = 'Stop'
python scripts/generate-contracts.py --check
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
uv run --project services/api pytest services/api/tests/test_contracts.py services/api/tests/test_api_contracts.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
